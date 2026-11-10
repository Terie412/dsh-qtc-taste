/**
 * Process and runtime figures for the performance monitor.
 *
 * Everything here is a single synchronous read, so it needs no sampler, no
 * cache, and no background work: memory counters, the machine's own memory, and
 * the Node runtime identity. The expensive parts of the monitor (CPU deltas,
 * directory walks) live in their own modules.
 *
 * @module dsh-qtc-taste/host/metrics/process
 */
import { freemem, loadavg, totalmem } from 'node:os'

/** Bytes to MiB. */
const MIB = 1024 * 1024

/**
 * Round a byte count to MiB.
 * @param value - bytes.
 * @returns MiB, rounded to one decimal.
 */
export function toMib (value) {
  return Math.round((value / MIB) * 10) / 10
}

/**
 * This process's memory, split the way V8 splits it, beside the machine's own.
 * @returns the memory block.
 */
export function readMemory () {
  const usage = process.memoryUsage()
  const total = totalmem()
  const free = freemem()
  return {
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    rssMib: toMib(usage.rss),
    heapTotalMib: toMib(usage.heapTotal),
    heapUsedMib: toMib(usage.heapUsed),
    externalMib: toMib(usage.external),
    machine: {
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
      usedPercent: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : null,
    },
  }
}

/**
 * Node runtime identity, plus load average where the platform provides one.
 *
 * Windows reports 0/0/0 for `loadavg()`. A machine serving a browser UI never
 * has all three windows exactly zero, so zero means "not available" and the
 * figure is omitted rather than shown as a real idle reading.
 * @returns the runtime block.
 */
export function readRuntime () {
  let load = null
  try {
    const [one, five, fifteen] = loadavg()
    load = one === 0 && five === 0 && fifteen === 0 ? null : { one, five, fifteen }
  } catch {
    load = null
  }
  return {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    load,
  }
}
