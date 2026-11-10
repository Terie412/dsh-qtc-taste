/**
 * Per-process and whole-application memory, the way the OS task manager reports
 * it.
 *
 * The monitor's own process is only one of the pieces a user sees in Task
 * Manager: a desktop DSH is a main process, an Electron renderer per window, a
 * GPU process, a network service, and every Node subprocess the harness spawned.
 * Reporting only `process.memoryUsage()` therefore understates the footprint by
 * roughly half, and a user comparing the two numbers concludes the panel is
 * wrong.
 *
 * This module collects the whole set AND the breakdown, because a single total
 * raises the obvious next question — "which one is eating it". Two constraints
 * shape how:
 *
 * - **Cost.** Asking the OS costs a few hundred milliseconds, which can never
 *   sit in a one-second poll. Reads are cached and refreshed in the background,
 *   and a caller always gets the last good reading.
 * - **Attribution.** The OS lists processes by executable name, so summing by
 *   name is only safe when the name identifies this app. A packaged desktop
 *   build runs as its own executable and the sum is exact; a dev build runs as
 *   `node`, where the same name belongs to unrelated programs on the machine.
 *   In that case the reader reports `supported: false` rather than inventing a
 *   number that mixes in other people's processes.
 *
 * @module dsh-qtc-taste/host/metrics/processes
 */
import { execFile } from 'node:child_process'
import { basename, join } from 'node:path'

/**
 * Executable names that do NOT identify one application.
 *
 * Summing every `node.exe` on a developer's machine would fold in editors,
 * language servers, and unrelated CLIs, so those names are refused.
 */
const GENERIC_EXECUTABLES = new Set([
  'node',
  'node.exe',
  'electron',
  'electron.exe',
  'bun',
  'bun.exe',
  'deno',
  'deno.exe',
])

/** How long one reading stays fresh. */
const CACHE_TTL_MS = 5000

/** Bound on the OS query, so a hung shell cannot wedge the refresh. */
const QUERY_TIMEOUT_MS = 5000

/** How many process rows the panel receives; the tail is folded into "others". */
const MAX_ROWS = 12

/**
 * The roles a desktop Harness process can play, keyed by the switch that
 * identifies it.
 *
 * Electron tags each helper with `--type=<role>`; the main process carries no
 * such switch. A role is what the user recognizes in Task Manager, so it leads
 * each row instead of a bare PID.
 */
const ROLE_MARKERS = [
  ['--type=renderer', 'renderer'],
  ['--type=gpu-process', 'gpu'],
  ['--type=utility', 'utility'],
  ['--type=zygote', 'zygote'],
  ['--type=crashpad-handler', 'crashpad'],
]

/**
 * Parse a Windows `tasklist` CSV memory cell such as `"192,108 K"`.
 * @param cell - the raw cell.
 * @returns bytes, or null.
 */
function parseMemoryCell (cell) {
  const digits = String(cell ?? '').replace(/[^\d]/g, '')
  if (digits === '') return null
  const kilobytes = Number(digits)
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : null
}

/**
 * Classify one process by its command line.
 *
 * `--utility-sub-type=network.mojom.NetworkService` is more specific than the
 * generic `utility` role and is what Task Manager shows, so it is matched
 * first.
 * @param commandLine - the process command line.
 * @returns `{ role, subType }`.
 */
export function classifyRole (commandLine) {
  const line = String(commandLine ?? '')
  const subType = /--utility-sub-type=([^\s"]+)/.exec(line)?.[1] ?? null
  if (subType !== null) {
    const short = subType.split('.').pop() ?? subType
    return { role: 'utility', subType: short }
  }
  for (const [marker, role] of ROLE_MARKERS) {
    if (line.includes(marker)) return { role, subType: null }
  }
  return { role: 'main', subType: null }
}

/**
 * Read every process of one image on Windows, with its command line.
 *
 * `Get-CimInstance` is used in preference to `tasklist` because it returns the
 * command line and the parent pid in the same call — the two facts needed to
 * name each row — for about the same cost as `tasklist` alone. The bare
 * PowerShell name is tried first, then the absolute path under `SystemRoot`:
 * a packaged desktop build can run with a PATH that omits `System32`.
 * @param executable - the bare executable name.
 * @returns a promise of `[{ pid, parentPid, bytes, commandLine }]`.
 */
function readWindows (executable) {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const absolute = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // A filter keeps the result small; `ConvertTo-Json` gives a shape that needs
  // no CSV quoting rules (command lines contain commas and quotes). Statements
  // are joined with `;` because `-Command` evaluates one line.
  const escaped = executable.replace(/'/g, "''")
  const script = [
    `$ErrorActionPreference='Stop'`,
    `$rows = @(Get-CimInstance Win32_Process -Filter "Name='${escaped}'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine)`,
    `ConvertTo-Json -InputObject $rows -Compress -Depth 3`,
  ].join('; ')
  const run = (command) => new Promise((resolve, reject) => {
    execFile(
      command,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 << 20 },
      (error, stdout) => {
        if (error !== null) {
          reject(error)
          return
        }
        try {
          const parsed = JSON.parse(String(stdout).trim() || '[]')
          const list = Array.isArray(parsed) ? parsed : [parsed]
          resolve(list.map((row) => ({
            pid: row.ProcessId,
            parentPid: row.ParentProcessId,
            bytes: typeof row.WorkingSetSize === 'number' ? row.WorkingSetSize : null,
            commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : '',
          })))
        } catch (parseError) {
          reject(parseError)
        }
      },
    )
  })
  return run('powershell').catch(() => run(absolute))
}

/**
 * Read every process of one image on POSIX, with its command line.
 *
 * `rss=` is kilobytes, `command=` is the full command line. Rows are matched by
 * the first field so a command line containing spaces stays intact.
 * @param executable - the bare executable name.
 * @returns a promise of `[{ pid, parentPid, bytes, commandLine }]`.
 */
function readPosix (executable) {
  const name = executable.replace(/\.(exe|app)$/i, '')
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-C', name, '-o', 'pid=,ppid=,rss=,command='],
      { timeout: QUERY_TIMEOUT_MS, maxBuffer: 4 << 20 },
      (error, stdout) => {
        if (error !== null) {
          reject(error)
          return
        }
        const rows = []
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
          if (match === null) continue
          rows.push({
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            bytes: Number(match[3]) * 1024,
            commandLine: match[4],
          })
        }
        resolve(rows)
      },
    )
  })
}

/**
 * Build the per-process rows, largest first.
 *
 * The detail is capped: a harness with many subprocesses would otherwise push
 * the memory card off the screen, and the small ones carry no actionable
 * information. Whatever is dropped is summed into one `others` row so the rows
 * always add up to the total the panel shows.
 * @param processes - raw rows from the OS reader.
 * @param hostPid - this process's pid, flagged so the panel can mark it.
 * @returns `{ rows, others, totalBytes, processCount }`.
 */
export function buildBreakdown (processes, hostPid) {
  const sorted = [...processes].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0))
  let totalBytes = 0
  for (const row of sorted) totalBytes += row.bytes ?? 0

  const named = sorted.slice(0, MAX_ROWS).map((row) => {
    const { role, subType } = classifyRole(row.commandLine)
    return {
      pid: row.pid,
      parentPid: row.parentPid ?? null,
      role,
      subType,
      bytes: row.bytes ?? 0,
      mib: Math.round(((row.bytes ?? 0) / (1024 * 1024)) * 10) / 10,
      host: row.pid === hostPid,
    }
  })

  const rest = sorted.slice(MAX_ROWS)
  let others = null
  if (rest.length > 0) {
    const bytes = rest.reduce((sum, row) => sum + (row.bytes ?? 0), 0)
    others = {
      count: rest.length,
      bytes,
      mib: Math.round((bytes / (1024 * 1024)) * 10) / 10,
    }
  }

  return { rows: named, others, totalBytes, processCount: sorted.length }
}

/**
 * Create the whole-application reader.
 * @param options - `{ execPath, hostPid }`, defaulting to this process.
 * @returns `{ read, supported, label, dispose }`.
 */
export function createAppMemoryReader (options = {}) {
  const execPath = options.execPath ?? process.execPath
  const hostPid = options.hostPid ?? process.pid
  const executable = basename(execPath ?? '')
  const lower = executable.toLowerCase()
  const supported = executable !== '' && !GENERIC_EXECUTABLES.has(lower)
  const platform = process.platform

  /** Last successful reading, already broken down. */
  let latest = null
  /** Timestamp of the last read attempt. */
  let lastAttempt = 0
  /** Last failure, kept so the panel can say what went wrong. */
  let failure = null
  /** In-flight query, or null. */
  let inFlight = null
  let disposed = false

  /**
   * Run one query, recording the outcome either way.
   * @returns the query promise.
   */
  function query () {
    if (inFlight !== null) return inFlight
    const runner = platform === 'win32' ? readWindows : readPosix
    inFlight = runner(executable)
      .then((processes) => {
        if (disposed) return
        const breakdown = buildBreakdown(processes, hostPid)
        latest = { ...breakdown, at: Date.now() }
        failure = null
      })
      .catch((error) => {
        if (disposed) return
        // A failure must never look like "still loading": the previous total is
        // kept for display, and the reason is recorded so the panel can state
        // it instead of spinning forever.
        failure = String(error?.code ?? error?.message ?? error)
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  return {
    /** Whether summing by executable name describes this app. */
    supported,
    /** The executable whose processes are summed. */
    label: executable,
    /**
     * The last reading, refreshing in the background when stale.
     *
     * `loading` is true only while the FIRST query is still running. Once a
     * query has failed, `failed` carries the reason and `loading` is false, so
     * the panel can stop spinning and say something true.
     * @returns the breakdown plus `{ supported, at, loading, failed }`.
     */
    read () {
      if (disposed || !supported) {
        return {
          supported: false,
          processCount: null,
          totalBytes: null,
          rows: [],
          others: null,
          at: null,
          loading: false,
          failed: null,
        }
      }
      const now = Date.now()
      const stale = latest === null || now - latest.at > CACHE_TTL_MS
      // Throttle retries too: a broken query must not be re-run every poll.
      if (stale && now - lastAttempt > CACHE_TTL_MS) {
        lastAttempt = now
        void query()
      }
      return {
        supported: true,
        processCount: latest?.processCount ?? null,
        totalBytes: latest?.totalBytes ?? null,
        rows: latest?.rows ?? [],
        others: latest?.others ?? null,
        at: latest?.at ?? null,
        loading: latest === null && failure === null && (lastAttempt !== 0 || inFlight !== null),
        failed: latest === null ? failure : null,
      }
    },
    /**
     * Force a refresh and wait for it.
     *
     * The panel's manual refresh uses this: the user asked, so the cost is
     * justified and the rows must be current rather than up to five seconds old.
     * @returns a promise settling after the query.
     */
    async refresh () {
      if (!supported || disposed) return
      lastAttempt = Date.now()
      await query()
    },
    dispose () {
      disposed = true
      latest = null
      failure = null
    },
  }
}
