/**
 * dsh-qtc-taste — Host half.
 *
 * A toolkit of personal quality-of-life features for DeepSeek Harness, shipped
 * as ONE plugin. Each feature owns its own document, prompt contribution, and
 * HTTP route; this entry only composes them.
 *
 * Adding a feature is meant to be local work: write the module, add one line to
 * {@link FEATURES}, and give it a settings page or a panel in the Client half.
 * No existing feature has to change, and the profile keeps growing by one
 * plugin rather than one plugin per capability.
 *
 * | Feature | What it does |
 * |---|---|
 * | personalization | user-authored blocks injected into the system prompt |
 * | monitor | live CPU, memory, disk and event-loop figures in a sidebar panel |
 *
 * The module layout (`src/host/storage.js`, `src/host/features/*`) is kept even
 * while one feature ships: it is what makes the next feature a local change
 * rather than a refactor.
 *
 * @module dsh-qtc-taste
 */
import { register as registerPersonalization } from './src/host/features/personalization.js'
import { register as registerMonitor } from './src/host/features/monitor.js'

/**
 * Every feature this plugin ships, in registration order.
 *
 * A feature is `{ id, register(ctx) }`. `id` is documentation and diagnostic
 * only; behaviour belongs to `register`, which must own everything it creates
 * through `ctx.effect`.
 */
const FEATURES = [
  { id: 'personalization', register: registerPersonalization },
  { id: 'monitor', register: registerMonitor },
]

/** Hard dependencies: the route carrier every feature serves through. */
export const inject = ['webServer']

/**
 * Host half: compose the features.
 * @param ctx - Host plugin context.
 */
export function apply (ctx) {
  for (const feature of FEATURES) {
    try {
      feature.register(ctx)
    } catch (error) {
      // One broken feature must not take the whole toolkit offline: the others
      // keep working and the failure is visible in the host log.
      console.error(`[dsh-qtc-taste] feature "${feature.id}" failed to register:`, error)
    }
  }
}
