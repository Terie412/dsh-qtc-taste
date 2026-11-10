/**
 * Storage accounting for the performance monitor.
 *
 * Two different questions get two different answers, and the difference is the
 * whole design of this module:
 *
 * - **Volume usage** is one `statfs` call (tens of microseconds). It is read on
 *   every snapshot because it is free and it is the number users actually care
 *   about ("am I about to run out of disk").
 * - **Directory usage** is a full tree walk. On this profile that is ~20k files
 *   and roughly a second of syscalls, so it can never sit in a request path.
 *
 * The scanner therefore answers immediately from its last result and refreshes
 * in the background. The tree is split into two classes with very different
 * churn: DSH's own data directories change constantly and are cheap to walk,
 * while `profiles/` and `dsh-runtimes/` hold installed packages that only ever
 * change on install, are expensive to walk, and are cached for much longer.
 *
 * Symlinks are counted but never followed. A profile's `node_modules` links to
 * package checkouts elsewhere on disk (this plugin's own checkout among them),
 * so following them would walk unrelated trees and could loop.
 *
 * @module dsh-qtc-taste/host/metrics/storage
 */
import { statfsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Directories that change while the app runs. Cheap to walk, so refreshed
 * often.
 */
const DYNAMIC_ROOTS = [
  'sessions',
  'attachments',
  'storages',
  'cache',
  'bot',
  'llm-deepseek',
  'workbuddy-vault',
  'dsh-ops',
]

/**
 * Directories that only change when something is installed. Expensive to walk,
 * so refreshed rarely.
 */
const STATIC_ROOTS = ['profiles', 'dsh-runtimes']

/** How long a cheap-directory result stays fresh. */
const DYNAMIC_TTL_MS = 5000

/** How long an installed-package result stays fresh. */
const STATIC_TTL_MS = 10 * 60 * 1000

/** Hard bounds so one pathological tree cannot stall the refresh. */
const MAX_DEPTH = 24
const MAX_ENTRIES = 400000

/**
 * Sum the size of one directory tree.
 *
 * Never throws: an unreadable subdirectory is skipped and counted, so a locked
 * file degrades the figure instead of failing the snapshot.
 * @param root - absolute directory path.
 * @returns `{ bytes, files, dirs, links, skipped }`.
 */
async function measureTree (root) {
  const result = { bytes: 0, files: 0, dirs: 0, links: 0, skipped: 0 }
  const stack = [{ path: root, depth: 0 }]
  while (stack.length > 0) {
    const { path, depth } = stack.pop()
    let entries
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch {
      result.skipped += 1
      continue
    }
    result.dirs += 1
    for (const entry of entries) {
      if (result.files + result.dirs + result.links >= MAX_ENTRIES) return result
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) {
        result.links += 1
        continue
      }
      if (entry.isDirectory()) {
        if (depth + 1 <= MAX_DEPTH) stack.push({ path: child, depth: depth + 1 })
        else result.skipped += 1
        continue
      }
      if (!entry.isFile()) continue
      try {
        result.bytes += (await stat(child)).size
        result.files += 1
      } catch {
        result.skipped += 1
      }
    }
  }
  return result
}

/**
 * Read the volume holding one path.
 * @param path - any path on the volume.
 * @returns `{ totalBytes, freeBytes, availableBytes }`, or null.
 */
export function readVolume (path) {
  try {
    const stats = statfsSync(path)
    const blockSize = stats.bsize
    return {
      totalBytes: stats.blocks * blockSize,
      freeBytes: stats.bfree * blockSize,
      availableBytes: stats.bavail * blockSize,
    }
  } catch {
    return null
  }
}

/**
 * Create a background-refreshing directory scanner.
 * @param options - `{ home }`: absolute DSH home directory.
 * @returns `{ current, volume, refresh, dispose }`.
 */
export function createStorageScanner ({ home }) {
  /** Per-root last result, keyed by directory name. */
  const roots = new Map()
  /** The in-flight refresh, or null when idle. */
  let inFlight = null
  /** Whether a further refresh was requested while one was already running. */
  let pending = false
  /** Serialized snapshot handed to the panel. */
  let snapshot = null
  let disposed = false

  /**
   * Walk one class of roots whose cached results are older than `ttl`.
   * @param names - directory names.
   * @param ttl - freshness bound in milliseconds.
   */
  async function ensureFresh (names, ttl) {
    const now = Date.now()
    for (const name of names) {
      const cached = roots.get(name)
      if (cached !== undefined && now - cached.at < ttl) continue
      const measured = await measureTree(join(home, name))
      roots.set(name, { at: Date.now(), ...measured })
    }
  }

  /** Rebuild {@link snapshot} from the cached per-root results. */
  function publish () {
    let bytes = 0
    let files = 0
    let dirs = 0
    let links = 0
    let skipped = 0
    const rows = []
    /** Oldest DYNAMIC root; the clock that decides whether the panel is stale. */
    let oldestDynamic = null
    for (const name of [...DYNAMIC_ROOTS, ...STATIC_ROOTS]) {
      const entry = roots.get(name)
      if (entry === undefined) continue
      const dynamic = DYNAMIC_ROOTS.includes(name)
      bytes += entry.bytes
      files += entry.files
      dirs += entry.dirs
      links += entry.links
      skipped += entry.skipped
      if (dynamic && (oldestDynamic === null || entry.at < oldestDynamic)) oldestDynamic = entry.at
      rows.push({
        name,
        kind: dynamic ? 'data' : 'install',
        bytes: entry.bytes,
        files: entry.files,
        at: entry.at,
      })
    }
    rows.sort((left, right) => right.bytes - left.bytes)
    snapshot = {
      home,
      // The age that decides staleness is the DATA roots': the install roots
      // are deliberately cached for ten minutes, so folding them in would make
      // every snapshot look expired and warn forever.
      at: oldestDynamic,
      bytes,
      files,
      dirs,
      links,
      skipped,
      roots: rows,
    }
  }

  /**
   * Refresh what is stale, then publish.
   *
   * Dynamic roots are re-walked whenever they expired; static roots only when
   * their own long TTL expired, which keeps the common case at a few
   * milliseconds.
   *
   * A caller always gets a promise that settles only once the requested work
   * has been done: when a refresh is already running, this joins it and asks
   * for one more pass, rather than resolving early against a half-built cache.
   * @param force - re-walk every root regardless of its cache age.
   * @returns a promise settling after the refresh that includes this request.
   */
  function refresh (force = false) {
    if (disposed) return Promise.resolve()
    if (inFlight !== null) {
      pending = true
      // The running pass may predate this caller's `force`, so follow it with
      // one more pass rather than letting the caller observe stale numbers.
      const requestedForce = force
      return inFlight.then(() => {
        if (requestedForce) return refresh(true)
        return undefined
      })
    }
    inFlight = (async () => {
      try {
        const dynamicTtl = force ? 0 : DYNAMIC_TTL_MS
        const staticTtl = force ? 0 : STATIC_TTL_MS
        await ensureFresh(DYNAMIC_ROOTS, dynamicTtl)
        await ensureFresh(STATIC_ROOTS, staticTtl)
        publish()
      } finally {
        inFlight = null
        if (pending) {
          pending = false
          // The follow-up pass owns its own promise; it is intentionally not
          // awaited here, because the caller only asked for a refresh to
          // happen, and the collapsed `pending` flag already merged requests.
          void refresh(force)
        }
      }
    })()
    return inFlight
  }

  /**
   * The last published snapshot, kicking off a background refresh when stale.
   * @param force - re-walk in the background even if the cache is fresh.
   * @returns `{ snapshot, stale, scanning }`.
   */
  function current (force = false) {
    if (disposed) return { snapshot, stale: false, scanning: false }
    const now = Date.now()
    const stale =
      force ||
      snapshot === null ||
      now - snapshot.at > DYNAMIC_TTL_MS ||
      DYNAMIC_ROOTS.some((name) => {
        const entry = roots.get(name)
        return entry === undefined || now - entry.at > DYNAMIC_TTL_MS
      })
    if (stale) void refresh(force)
    return { snapshot, stale, scanning: inFlight !== null }
  }

  return {
    current,
    refresh,
    dispose () {
      disposed = true
    },
  }
}
