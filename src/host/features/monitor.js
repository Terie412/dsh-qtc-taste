/**
 * Feature: performance monitor (「性能监控」).
 *
 * Answers one question — "is the harness healthy right now" — from figures the
 * Host can read without a privileged native module:
 *
 * | Figure | Source | Cost |
 * |---|---|---|
 * | system and process CPU | `os.cpus()` deltas | two map walks, cached 500 ms |
 * | event-loop delay | `perf_hooks` histogram | one reset per snapshot |
 * | process memory | `process.memoryUsage()` | one call |
 * | machine memory | `os.totalmem`/`freemem` | one call |
 * | volume usage | `statfs` | ~50 µs |
 * | data and install directories | background tree walk | never in the request path |
 *
 * The split matters: the directory walk is the only expensive figure and it is
 * published from a cache while a background task refreshes it, so the panel's
 * poll interval never turns into filesystem load. Everything else is cheap
 * enough to read on demand.
 *
 * The route takes a `since` cursor: the panel sends the timestamp it last saw
 * and gets only the deltas it has not collected yet, which keeps one browser
 * poll from resetting the event-loop histogram of a second one.
 *
 * @module dsh-qtc-taste/host/features/monitor
 */
import { join } from 'node:path'
import { createSampler } from '../metrics/sampler.js'
import { createStorageScanner, readVolume } from '../metrics/storage.js'
import { createAppMemoryReader } from '../metrics/processes.js'
import { readMemory, readRuntime, toMib } from '../metrics/process.js'
import { registerFeatureRoute, resolveHome } from '../storage.js'

/** Route the panel polls. */
const API_PATH = '/qtc-monitor/api'

/** How many recent samples the Host keeps for the panel's sparkline. */
const HISTORY_LIMIT = 180

/** Snapshot age under which a new poll reuses the newest sample. */
const SAMPLE_FLOOR_MS = 400

/**
 * The volume label for a directory, on the platform's own terms.
 *
 * The panel shows "where is the disk going", so the drive root is what the
 * user recognizes: `C:\` on Windows, `/` elsewhere. A UNC path keeps its share
 * prefix, because its root is the share rather than the host.
 * @param home - the DSH home directory.
 * @returns the volume label used for `statfs`.
 */
function volumeRootOf (home) {
  const drive = /^([A-Za-z]:)[\\/]/.exec(home)
  if (drive !== null) return `${drive[1]}\\`
  if (home.startsWith('\\\\')) {
    // \\server\share\... → \\server\share
    const parts = home.split(/[\\/]+/).filter((part) => part !== '')
    return parts.length >= 2 ? `\\\\${parts[0]}\\${parts[1]}` : home
  }
  return '/'
}

/**
 * Register the performance-monitor feature.
 * @param ctx - Host plugin context.
 * @returns the retained feature surface (for tests and diagnostics).
 */
export function register (ctx) {
  const home = resolveHome()
  const sampler = createSampler()
  const storage = createStorageScanner({ home })
  const appMemory = createAppMemoryReader()
  const volumePath = volumeRootOf(home)

  /** Recent samples, oldest first; the panel draws its history from here. */
  const history = []

  ctx.effect(() => () => {
    sampler.dispose()
    storage.dispose()
    appMemory.dispose()
  }, 'dsh-qtc-taste: monitor resources')

  /**
   * Build one complete snapshot from every source, cheap reads included.
   *
   * The directory walk is never awaited here: `storage.current()` publishes
   * what it has and asks for a background pass when that is stale.
   * @param force - re-walk the directory tree in the background regardless.
   * @returns the snapshot object.
   */
  function snapshot (force = false) {
    const sampled = sampler.sample()
    const storageState = storage.current(force)
    const tree = storageState.snapshot
    const volume = readVolume(volumePath)
    const memory = readMemory()
    const app = appMemory.read()
    const at = Date.now()
    return {
      at,
      cpu: sampled.cpu,
      loop: sampled.loop,
      memory: {
        ...memory,
        // The whole application, matching what the OS task manager shows for
        // this app. Reading only `process.memoryUsage()` reports the Node host
        // and misses the renderer, GPU, network, and every subprocess.
        app: {
          supported: app.supported,
          executable: appMemory.label,
          processCount: app.processCount,
          totalBytes: app.totalBytes,
          mib: app.totalBytes === null ? null : toMib(app.totalBytes),
          // How much of the application this Host process accounts for.
          hostSharePercent:
            app.totalBytes === null || app.totalBytes === 0
              ? null
              : Math.round((memory.rssBytes / app.totalBytes) * 1000) / 10,
          // Per-process detail, largest first: the total alone raises the
          // obvious next question, "which one is eating it".
          processes: (app.rows ?? []).map((row) => ({ ...row, mib: row.mib })),
          others: app.others ?? null,
          at: app.at,
          loading: app.loading,
          // A failed OS query is reported, not retried forever behind a
          // spinner: the panel shows the reason instead.
          failed: app.failed ?? null,
        },
      },
      runtime: readRuntime(),
      disk: {
        volumePath,
        volume,
        volumeUsedPercent:
          volume === null || volume.totalBytes === 0
            ? null
            : Math.round(((volume.totalBytes - volume.availableBytes) / volume.totalBytes) * 1000) / 10,
        tree:
          tree === null
            ? null
            : {
                home: tree.home,
                bytes: tree.bytes,
                mib: toMib(tree.bytes),
                files: tree.files,
                dirs: tree.dirs,
                links: tree.links,
                skipped: tree.skipped,
                at: tree.at,
                roots: tree.roots.map((row) => ({ ...row, mib: toMib(row.bytes) })),
              },
        scanning: storageState.scanning,
        stale: storageState.stale,
      },
    }
  }

  /**
   * Take the sample the panel will see, recording it in {@link history}.
   *
   * A snapshot younger than {@link SAMPLE_FLOOR_MS} is reused, so two panels
   * polling at once, or a re-render, cannot manufacture a zero-length CPU
   * window or reset the event-loop histogram twice.
   * @returns the snapshot.
   */
  function sample () {
    const newest = history[history.length - 1]
    if (newest !== undefined && Date.now() - newest.at < SAMPLE_FLOOR_MS) return newest
    return record(snapshot())
  }

  /**
   * Append one snapshot to {@link history}, trimming the oldest entries.
   * @param next - the snapshot.
   * @returns the same snapshot.
   */
  function record (next) {
    history.push(next)
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
    return next
  }

  registerFeatureRoute(ctx, API_PATH, 'dsh-qtc-taste: monitor API', {
    /**
     * Current figures plus whatever history the panel has not seen.
     *
     * Never waits for the directory walk: that number comes from the last
     * published result while a background pass refreshes it.
     * @param payload - `{ since?: number, history?: boolean }`.
     * @returns `{ snapshot, history, limits }`.
     */
    snapshot: (payload) => {
      const current = sample()
      const since = typeof payload?.since === 'number' && Number.isFinite(payload.since)
        ? payload.since
        : 0
      const unread = payload?.history === false
        ? []
        : history.filter((row) => row.at > since).map((row) => ({
            at: row.at,
            cpu: row.cpu?.system?.percent ?? null,
            process: row.cpu?.process?.percentOfCore ?? null,
            rss: row.memory.rssMib,
            loop: row.loop?.p99 ?? null,
          }))
      return {
        snapshot: current,
        history: unread,
        limits: {
          historyLimit: HISTORY_LIMIT,
          sampleFloorMs: SAMPLE_FLOOR_MS,
        },
      }
    },
    /**
     * Re-measure the DSH home directory now.
     *
     * This one DOES wait: the user asked for it, the panel shows a busy state,
     * and a response carrying the previous numbers would make the control look
     * broken. It is the only path that touches the filesystem from a request.
     * @returns `{ disk }`.
     */
    refreshStorage: async () => {
      await storage.refresh(true)
      const current = record(snapshot())
      return { disk: current.disk }
    },
    /**
     * Re-read the process table now.
     *
     * The OS query costs a few hundred milliseconds, so the polled path serves
     * a cache. The user pressing refresh is a different intent and gets current
     * rows.
     * @returns `{ app }`.
     */
    refreshProcesses: async () => {
      await appMemory.refresh()
      return { app: snapshot().memory.app }
    },
    /** The paths behind the figures, so the panel can label them. */
    paths: () => ({
      home,
      volume: volumePath,
      storages: join(home, 'storages', 'dsh-qtc-taste'),
      sessions: join(home, 'sessions'),
      attachments: join(home, 'attachments'),
    }),
  })

  return { sample, history }
}
