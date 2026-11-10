/**
 * Shared Host plumbing for every dsh-qtc-taste feature.
 *
 * Two concerns live here so no feature re-implements them:
 *
 * - **Documents**: each feature owns one JSON file under the DSH home
 *   (`<home>/storages/dsh-qtc-taste/<name>.json`). Reads are pure — they never
 *   rename or write, so a read taken during prompt assembly can never disturb a
 *   concurrent save. Writes are atomic (temp file + rename in the same
 *   directory), so a crash mid-write cannot leave a half document.
 * - **HTTP**: one bounded JSON request reader and one response writer, plus the
 *   Connection fence that keeps plugin routes on the authenticated browser
 *   channel instead of the open one.
 *
 * Plugin-owned data belongs here rather than in `cordis.patch.yml`: the user's
 * profile patch is theirs, and a settings toggle must never rewrite it.
 *
 * @module dsh-qtc-taste/host/storage
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** How much JSON body one call may carry. */
const BODY_LIMIT = 1 << 20

/**
 * The DSH home directory owning `storages/`.
 * @returns the absolute home path.
 */
export function resolveHome () {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * Absolute path of one feature's document.
 * @param name - document name without the extension (for example `taste`).
 * @returns the file path.
 */
export function documentPath (name) {
  return join(resolveHome(), 'storages', 'dsh-qtc-taste', `${name}.json`)
}

/**
 * Trim a value to a string of at most `limit` UTF-16 units.
 * @param value - candidate value.
 * @param limit - maximum length.
 * @returns the trimmed string (empty for a non-string).
 */
export function clip (value, limit) {
  if (typeof value !== 'string') return ''
  return value.length > limit ? value.slice(0, limit) : value
}

/**
 * Read and parse one document.
 *
 * Pure with respect to the filesystem: it never renames or writes anything.
 * Malformed content is reported as `source: 'malformed'` and the caller decides
 * when to preserve the broken bytes (see {@link quarantine}).
 * @param path - document path.
 * @param normalize - coerces parsed JSON into the feature's shape.
 * @param fallback - the value used when the file is absent or unreadable.
 * @returns the value plus how it was obtained.
 */
export function readDocument (path, normalize, fallback) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: fallback, source: 'default' }
    return { value: fallback, source: 'unreadable' }
  }
  try {
    return { value: normalize(JSON.parse(text)), source: 'file' }
  } catch {
    return { value: fallback, source: 'malformed' }
  }
}

/**
 * Move a malformed document aside, best effort.
 *
 * Called only from load and save paths, never from a read taken during
 * assembly: renaming inside a read could race a concurrent save.
 * @param path - document path.
 */
export function quarantine (path) {
  try {
    renameSync(path, `${path}.broken`)
  } catch {
    // Nothing to preserve, or the rename is refused; saving still works.
  }
}

/**
 * Persist one document atomically.
 * @param path - document path.
 * @param value - the JSON-serializable value to write.
 */
export function writeDocument (path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  const temp = `${path}.${process.pid}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, body, 'utf8')
  renameSync(temp, path)
}

/**
 * Read the request body as JSON, bounded.
 * @param req - the HTTP request.
 * @returns the parsed body (an empty object for an empty body).
 */
export async function readJson (req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Answer one call.
 * @param res - the HTTP response.
 * @param status - HTTP status code.
 * @param value - JSON value.
 */
export function writeJson (res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Build the Connection trust check for one route.
 *
 * A profile without the Connection service has no browser channel to protect,
 * so every request is admitted; otherwise only authenticated browser requests
 * pass.
 * @param ctx - Host plugin context.
 * @returns a predicate: true when the request may proceed.
 */
export function createFence (ctx) {
  return (req) => {
    const connection = ctx.get('connection')
    if (connection === undefined) return true
    try {
      return connection.requestRejection(req) === undefined
    } catch {
      return false
    }
  }
}

/**
 * Register one fenced POST route that dispatches on `payload.method`.
 *
 * Every feature route answers the same envelope: `{ ok: true, value }` or
 * `{ ok: false, error: { code, message } }`. A handler returns `undefined` for a
 * method it does not own, which becomes a 404, so one feature can never answer
 * another feature's call.
 * @param ctx - Host plugin context.
 * @param path - exact route path.
 * @param label - effect label for diagnostics.
 * @param handlers - method name → async handler returning the `value`.
 * @returns the effect disposer.
 */
export function registerFeatureRoute (ctx, path, label, handlers) {
  const fence = createFence(ctx)
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method', message: 'POST only' } })
        return
      }
      let payload
      try {
        payload = await readJson(req)
      } catch (error) {
        writeJson(res, 400, {
          ok: false,
          error: { code: 'bad-request', message: String(error?.message ?? error) },
        })
        return
      }
      const handler = handlers[String(payload?.method)]
      if (typeof handler !== 'function') {
        writeJson(res, 404, {
          ok: false,
          error: { code: 'unknown-method', message: String(payload?.method) },
        })
        return
      }
      try {
        const value = await handler(payload)
        writeJson(res, 200, { ok: true, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = typeof error?.status === 'number' ? error.status : 500
        const code = typeof error?.code === 'string' ? error.code : 'internal'
        writeJson(res, status, { ok: false, error: { code, message } })
      }
    },
  }), label)
}

/**
 * Build a rejection a route handler can throw to answer with a specific status.
 * @param status - HTTP status code.
 * @param code - stable machine-readable code.
 * @param message - human-readable message.
 * @returns the throwable error.
 */
export function routeError (status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}
