/**
 * Host-half tests for the dsh-qtc-taste toolkit.
 *
 * Runs the real `index.js` and every feature module against a fabricated
 * Cordis-like context, so document handling, the prompt section, and the fenced
 * route are exercised without a running Harness. It creates its own temporary
 * DSH home and removes it afterwards.
 *
 * Usage: node test/host.mjs   (from the package root)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(join(tmpdir(), 'qtt-home-'))
process.env.DSH_HOME = home

const plugin = await import('../index.js')
const { renderSection } = await import('../src/host/features/personalization.js')
const { documentPath, clip } = await import('../src/host/storage.js')

let failures = 0
function check (name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Minimal context: effect/inject/on/get/emit plus the services features use. */
function makeContext () {
  const sections = new Map()
  const routes = new Map()
  const listeners = new Map()
  const systemPrompt = {
    section (section) {
      sections.set(section.name, section)
      return () => { sections.delete(section.name) }
    },
  }
  const webServer = {
    register (route) {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }
  const st = {
    sections,
    routes,
    listeners,
    ctx: {
      // Cordis exposes injected services both through `get()` and as context
      // properties; the features read the property form.
      systemPrompt,
      webServer,
      effect (fn) {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      inject (_names, callback) {
        callback(st.ctx)
      },
      on (name, handler) {
        listeners.set(name, handler)
        return () => { listeners.delete(name) }
      },
      get (name) {
        if (name === 'systemPrompt') return systemPrompt
        if (name === 'webServer') return webServer
        return undefined
      },
      emit () {},
    },
  }
  return st
}

/** Call the registered route the way the browser half does. */
async function call (routes, path, payload) {
  const route = routes.get(path)
  if (route === undefined) throw new Error(`route not registered: ${path}`)
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const req = Readable.from([body])
  req.method = 'POST'
  req.headers = {}
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead (status, headers) { this.status = status; this.headers = headers },
    end (text) { this.body = text ?? '' },
  }
  await route.handler(req, res)
  return { status: res.status, body: res.body === '' ? null : JSON.parse(res.body) }
}

const st = makeContext()
plugin.apply(st.ctx)

const TASTE_API = '/qtc-taste/api'
const tastePath = documentPath('taste')
const section = st.sections.get('dsh-qtc-taste:personalization')

// ══ Composition ════════════════════════════════════════════════════════════
console.log('composition')
check('one apply registers the prompt section', section !== undefined)
check('the feature route is registered', st.routes.has(TASTE_API))
check('no image-anchor listener remains', st.listeners.has('agent/pre-step') === false)
check('no image-anchor route remains', st.routes.has('/qtc-inline-images/api') === false)
check('inject declares the route carrier', plugin.inject?.includes('webServer'))

// ══ Registration ═══════════════════════════════════════════════════════════
console.log('\nregistration')
check('section interpolates nothing', section?.interpolate === false)
check('section order sits before the persona suffix', section?.order === 9800)
check('empty prompt adds nothing', section.text() === '')

// ══ Save and render ════════════════════════════════════════════════════════
console.log('\nsave and render')
const text = 'Always answer in Chinese.\nPrefer short paragraphs.'
const saved = await call(st.routes, TASTE_API, {
  method: 'save',
  enabled: true,
  blocks: [{ id: 'b1', title: 'Language', text, enabled: true }],
})
check('save answers 200', saved.status === 200, JSON.stringify(saved.body))
check('document written', readFileSync(tastePath, 'utf8').includes('Always answer in Chinese'))
const rendered = section.text()
check('section renders the heading', rendered.includes('## Personal preferences'), rendered)
check('section renders the title', rendered.includes('### Language'))
check('section renders the body verbatim', rendered.includes(text))

// ══ Live edits ═════════════════════════════════════════════════════════════
console.log('\nlive edits')
writeFileSync(tastePath, JSON.stringify({
  version: 1,
  enabled: true,
  blocks: [{ id: 'b1', title: 'Tone', text: 'Be terse.', enabled: true }],
}), 'utf8')
const reloaded = section.text()
check('hand edit is picked up', reloaded.includes('Be terse.'), reloaded)
check('stale text is gone', !reloaded.includes('Always answer in Chinese'))

// ══ Switches and blank bodies ══════════════════════════════════════════════
console.log('\nswitches and blank bodies')
await call(st.routes, TASTE_API, { method: 'save', enabled: false, blocks: [{ title: 'T', text: 'x', enabled: true }] })
check('master off renders nothing', section.text() === '')
await call(st.routes, TASTE_API, { method: 'save', enabled: true, blocks: [{ title: 'T', text: 'x', enabled: false }] })
check('disabled block renders nothing', section.text() === '')
await call(st.routes, TASTE_API, { method: 'save', enabled: true, blocks: [{ title: 'T', text: '  \n ', enabled: true }] })
check('blank block renders nothing', section.text() === '')

// ══ Normalization ══════════════════════════════════════════════════════════
console.log('\nnormalization')
const normalized = await call(st.routes, TASTE_API, {
  method: 'save',
  enabled: true,
  blocks: [
    { id: 'dup', title: 42, text: '{{not_a_variable}} and $HOME', enabled: 'yes' },
    { id: 'dup', title: 'second', text: 'x'.repeat(30000), enabled: false },
    'not-an-object',
    { text: 'no id here' },
  ],
})
const blocks = normalized.body?.value?.blocks ?? []
check('non-string title becomes empty', blocks[0]?.title === '')
check('duplicate ids are re-issued', blocks[0]?.id !== blocks[1]?.id)
check('oversized text is clipped', blocks[1]?.text?.length === 20000, String(blocks[1]?.text?.length))
check('non-boolean enabled means on', blocks[0]?.enabled === true)
check('non-object entries are dropped', blocks.length === 3, String(blocks.length))
check('a generated id is supplied', (blocks[2]?.id ?? '').length > 0)
check('template braces survive verbatim', section.text().includes('{{not_a_variable}}'))

// ══ Limits and recovery ════════════════════════════════════════════════════
console.log('\nlimits and recovery')
const many = Array.from({ length: 80 }, (_, index) => ({ id: `m${index}`, title: '', text: 'x', enabled: true }))
const capped = await call(st.routes, TASTE_API, { method: 'save', enabled: true, blocks: many })
check('block count is capped at 50', (capped.body?.value?.blocks?.length ?? 0) === 50)

writeFileSync(tastePath, '{ this is not json', 'utf8')
check('malformed document does not throw', typeof section.text() === 'string')
check('last good document keeps injecting', section.text().includes('## Personal preferences'))
const beforeSave = await call(st.routes, TASTE_API, { method: 'state' })
check('state still answers over a malformed file', beforeSave.status === 200)
await call(st.routes, TASTE_API, { method: 'save', enabled: true, blocks: [{ title: 'after', text: 'recovered', enabled: true }] })
check('malformed document is preserved as .broken', readFileSync(`${tastePath}.broken`, 'utf8').includes('not json'))
check('save over a malformed file works', section.text().includes('recovered'))

// ══ Route hygiene ══════════════════════════════════════════════════════════
console.log('\nroutes')
check('unknown method answers 404', (await call(st.routes, TASTE_API, { method: 'nope' })).status === 404)
check('a removed feature method answers 404', (await call(st.routes, TASTE_API, { method: 'preview' })).status === 404)

// ══ Pure render and helpers ════════════════════════════════════════════════
console.log('\nrenderSection')
check('empty document renders nothing', renderSection(undefined) === '')
check('disabled document renders nothing', renderSection({ enabled: false, blocks: [{ text: 'x', enabled: true }] }) === '')
check('blocks without text render nothing', renderSection({ enabled: true, blocks: [{ text: '   ', enabled: true }] }) === '')

console.log('\nstorage helpers')
check('clip bounds a long string', clip('abcdef', 3) === 'abc')
check('clip passes a short string through', clip('ab', 3) === 'ab')
check('clip rejects a non-string', clip(42, 3) === '')
check('documentPath nests under storages/dsh-qtc-taste', documentPath('taste').endsWith(join('storages', 'dsh-qtc-taste', 'taste.json')))

rmSync(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
