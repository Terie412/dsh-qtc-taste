/**
 * CPU and event-loop sampling for the performance monitor.
 *
 * One sampler owns the only state that cannot be read instantaneously: a CPU
 * counter is cumulative, so a utilization figure is always "busy time divided
 * by elapsed time" between two readings. The sampler keeps the previous
 * reading and computes the delta on demand.
 *
 * Sampling is lazy on purpose. The Host does no work until the panel asks for a
 * snapshot, and a burst of requests inside {@link MIN_WINDOW_MS} reuses the
 * last figure instead of producing a meaningless sub-millisecond window. That
 * keeps an idle monitor at exactly zero cost, which matters because this plugin
 * is loaded into every session of the profile.
 *
 * @module dsh-qtc-taste/host/metrics/sampler
 */
import { cpus } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'

/**
 * Shortest window worth reporting. Below this, a scheduler hiccup in the
 * measurement itself dominates the ratio.
 */
const MIN_WINDOW_MS = 500

/**
 * Longest window still called "current". A panel that was closed for an hour
 * would otherwise come back showing an hour-long average as the CPU load right
 * now; past this bound the sampler re-baselines and reports nothing until the
 * next reading.
 */
const MAX_WINDOW_MS = 15000

/** Event-loop histogram bucket width in milliseconds. */
const LOOP_RESOLUTION_MS = 10

/**
 * Read the machine-wide CPU counters.
 *
 * `os.cpus()` reports monotonically growing milliseconds per core, so only the
 * delta between two reads is meaningful.
 * @returns `{ idle, total, cores, model }` in milliseconds.
 */
function readCpuTimes () {
  const cores = cpus()
  let idle = 0
  let total = 0
  for (const core of cores) {
    const times = core.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return {
    idle,
    total,
    cores: cores.length,
    model: (cores[0]?.model ?? '').trim(),
  }
}

/**
 * Round to a fixed number of decimals, tolerating non-finite input.
 * @param value - number or null.
 * @param decimals - decimal places.
 * @returns the rounded number, or null.
 */
function round (value, decimals) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Create the sampler.
 * @returns `{ sample, dispose }`.
 */
export function createSampler () {
  /** Event-loop delay histogram, created on first use, or null if refused. */
  let histogram

  /** Previous cumulative reading, or null before the first one. */
  let previous = null
  /** Last computed CPU block, reused inside the minimum window. */
  let lastCpu = null
  /** Last computed window length, so the panel can label the average. */
  let lastWindowMs = null

  /**
   * The event-loop histogram, enabled on first access.
   *
   * The histogram is process-global and accumulates from the moment it is
   * enabled, so it is created lazily: a profile that never opens the monitor
   * pays nothing for it.
   * @returns the enabled histogram, or null when the runtime refuses one.
   */
  function histogramOf () {
    if (histogram !== undefined) return histogram
    try {
      histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })
      histogram.enable()
    } catch {
      histogram = null
    }
    return histogram
  }

  /**
   * Drain the event-loop histogram.
   *
   * The histogram accumulates between calls and is reset here, so each
   * snapshot describes the interval since the previous one. A count of zero
   * means the histogram has not observed a loop turn yet, which is a "no data"
   * state rather than a perfectly smooth loop.
   * @returns `{ p50, p99, max, count }` in milliseconds, or null.
   */
  function readLoop () {
    const current = histogramOf()
    if (current === null) return null
    try {
      const count = current.count
      const loop = count === 0
        ? null
        : {
            p50: round(current.percentile(50) / 1e6, 2),
            p99: round(current.percentile(99) / 1e6, 2),
            max: round(current.max / 1e6, 2),
            count,
          }
      current.reset()
      return loop
    } catch {
      return null
    }
  }

  /**
   * Take one reading of the cumulative counters.
   * @returns `{ at, cpu, process }`.
   */
  function read () {
    return { at: Date.now(), cpu: readCpuTimes(), process: process.cpuUsage() }
  }

  /**
   * Current CPU figures.
   * @returns `{ system, process, cores, model, windowMs }`.
   */
  function sampleCpu () {
    const current = read()
    if (previous === null) {
      previous = current
      return null
    }
    const windowMs = current.at - previous.at
    if (windowMs < MIN_WINDOW_MS) return lastCpu
    if (windowMs > MAX_WINDOW_MS) {
      // Re-baseline: the machine was probably asleep or the panel closed.
      previous = current
      lastCpu = null
      lastWindowMs = null
      return null
    }

    const totalDelta = current.cpu.total - previous.cpu.total
    const idleDelta = current.cpu.idle - previous.cpu.idle
    const busy = totalDelta > 0 ? 1 - idleDelta / totalDelta : null

    const processMicros =
      current.process.user - previous.process.user +
      current.process.system - previous.process.system
    const processCore = processMicros > 0 ? (processMicros / (windowMs * 1000)) * 100 : 0

    lastWindowMs = windowMs
    lastCpu = {
      windowMs,
      cores: current.cpu.cores,
      model: current.cpu.model,
      system: {
        percent: round(busy === null ? null : busy * 100, 1),
      },
      process: {
        percentOfCore: round(processCore, 2),
        percentOfMachine: round(processCore / Math.max(1, current.cpu.cores), 2),
        userMs: round((current.process.user - previous.process.user) / 1000, 1),
        systemMs: round((current.process.system - previous.process.system) / 1000, 1),
      },
    }
    previous = current
    return lastCpu
  }

  return {
    /**
     * One snapshot of CPU and event-loop health.
     * @returns `{ cpu, loop, windowMs }`; `cpu` is null until a second reading exists.
     */
    sample () {
      return { cpu: sampleCpu(), loop: readLoop(), windowMs: lastWindowMs }
    },
    /** Release the histogram. */
    dispose () {
      const current = histogram
      histogram = null
      if (current === null || current === undefined) return
      try {
        current.disable()
      } catch {
        // The histogram is process-global; a failed disable is harmless.
      }
    },
  }
}
