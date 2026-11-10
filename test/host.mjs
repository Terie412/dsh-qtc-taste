/**
 * Host-half tests for the dsh-qtc-taste toolkit.
 *
 * Runs the real `index.js` and every feature module against a fabricated
 * Cordis-like context, so document handling, the prompt section, the fenced
 * routes, and the performance sampler are exercised without a running Harness.
 * It creates its own temporary DSH home and removes it afterwards.
 *
 * Usage: node test/host.mjs   (from the package root)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const home = mkdtempSync(join(tmpdir(), 'qtt-home-'))
process.env.DSH_HOME = home

const plugin = await import('../index.js')
const { renderSection } = await import('../src/host/features/personalization.js')
const { documentPath, clip } = await import('../src/host/storage.js')
const { createSampler } = await import('../src/host/metrics/sampler.js')
const { createStorageScanner, readVolume } = await import('../src/host/metrics/storage.js')
const { readMemory, readRuntime, toMib } = await import('../src/host/metrics/process.js')
const { createAppMemoryReader } = await import('../src/host/metrics/processes.js')
const { buildBreakdown, classifyRole } = await import('../src/host/metrics/processes.js')

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
const MONITOR_API = '/qtc-monitor/api'
const tastePath = documentPath('taste')
const section = st.sections.get('dsh-qtc-taste:personalization')

// ══ Composition ════════════════════════════════════════════════════════════
console.log('composition')
check('one apply registers the prompt section', section !== undefined)
check('the feature route is registered', st.routes.has(TASTE_API))
check('the monitor route is registered', st.routes.has(MONITOR_API))
check('features never answer each other\'s methods', (await call(st.routes, MONITOR_API, { method: 'save' })).status === 404)
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
check('toMib converts bytes', toMib(1048576) === 1)
check('toMib rounds to one decimal', toMib(1572864) === 1.5)

// ══ Monitor: the route contract ════════════════════════════════════════════
console.log('\nmonitor route')
const firstPoll = await call(st.routes, MONITOR_API, { method: 'snapshot' })
check('first poll answers 200', firstPoll.status === 200, JSON.stringify(firstPoll.body))
const firstSnapshot = firstPoll.body?.value?.snapshot
check('snapshot carries a timestamp', typeof firstSnapshot?.at === 'number')
check('memory is present on the first poll', typeof firstSnapshot?.memory?.rssMib === 'number')
check('volume usage is present on the first poll', typeof firstSnapshot?.disk?.volumeUsedPercent === 'number')
check('machine memory is present', typeof firstSnapshot?.memory?.machine?.usedPercent === 'number')
check('runtime identity is present', typeof firstSnapshot?.runtime?.nodeVersion === 'string')
check('history is an array', Array.isArray(firstPoll.body?.value?.history))
check('limits describe the history bound', firstPoll.body?.value?.limits?.historyLimit > 0)

// A second poll a moment later must produce a CPU figure: the first reading
// only establishes the baseline.
await new Promise((resolve) => setTimeout(resolve, 650))
const secondPoll = await call(st.routes, MONITOR_API, { method: 'snapshot', since: firstSnapshot.at })
const secondSnapshot = secondPoll.body?.value?.snapshot
check('CPU appears on the second poll', typeof secondSnapshot?.cpu?.system?.percent === 'number', JSON.stringify(secondSnapshot?.cpu))
check('process CPU is a per-core percentage', typeof secondSnapshot?.cpu?.process?.percentOfCore === 'number')
check('the CPU window is reported', secondSnapshot?.cpu?.windowMs >= 500, String(secondSnapshot?.cpu?.windowMs))
check('system CPU is a believable ratio', secondSnapshot?.cpu?.system?.percent >= 0 && secondSnapshot?.cpu?.system?.percent <= 100)
check('the unread history slice is returned', Array.isArray(secondPoll.body?.value?.history) && secondPoll.body.value.history.length >= 1)
check('history rows carry the trend fields',
  typeof secondPoll.body?.value?.history?.[0]?.at === 'number' &&
  'cpu' in (secondPoll.body.value.history[0] ?? {}))

// Two polls inside the sample floor must reuse one snapshot: a zero-length
// window would divide by zero.
const burst = []
for (let index = 0; index < 4; index += 1) {
  burst.push((await call(st.routes, MONITOR_API, { method: 'snapshot' })).body?.value?.snapshot?.at)
}
check('a burst of polls reuses one sample', new Set(burst).size === 1, burst.join(','))
check('opting out of history yields none',
  (await call(st.routes, MONITOR_API, { method: 'snapshot', history: false })).body?.value?.history?.length === 0)

const paths = await call(st.routes, MONITOR_API, { method: 'paths' })
check('paths answers 200', paths.status === 200)
check('paths names the DSH home', typeof paths.body?.value?.home === 'string' && paths.body.value.home !== '')
check('paths names a volume root', /^[A-Za-z]:\\$|^\/$/.test(paths.body?.value?.volume ?? ''), paths.body?.value?.volume)

// ══ Monitor: storage scanning ══════════════════════════════════════════════
console.log('\nmonitor storage')
// Give the walk something deterministic to find, then force a rescan.
const fixture = join(home, 'sessions', 'fixture', 'session-x')
mkdirSync(fixture, { recursive: true })
writeFileSync(join(fixture, 'payload.bin'), Buffer.alloc(4096))
await call(st.routes, MONITOR_API, { method: 'refreshStorage' })
await new Promise((resolve) => setTimeout(resolve, 400))
const rescanned = await call(st.routes, MONITOR_API, { method: 'snapshot', history: false })
const tree = rescanned.body?.value?.snapshot?.disk?.tree
// The temporary home holds only the 4 KiB fixture, so the MiB figure rounds to
// zero by design; the byte count is what proves the walk landed.
check('the tree walk reports a byte count', typeof tree?.bytes === 'number' && tree.bytes >= 4096, String(tree?.bytes))
check('the tree walk reports an MiB figure', typeof tree?.mib === 'number', String(tree?.mib))
check('the tree walk counts the fixture', tree?.files >= 1, String(tree?.files))
check('per-root rows are published', Array.isArray(tree?.roots) && tree.roots.length > 0)
check('rows are sorted by size', tree.roots.every((row, index) => index === 0 || tree.roots[index - 1].bytes >= row.bytes))
check('rows are classified data or install',
  tree.roots.every((row) => row.kind === 'data' || row.kind === 'install'))
check('the sessions root is classified as data',
  tree.roots.find((row) => row.name === 'sessions')?.kind === 'data')

// ══ Monitor: units ═════════════════════════════════════════════════════════
console.log('\nmonitor units')
const sampler = createSampler()
check('the first CPU reading is a baseline', sampler.sample().cpu === null)
await new Promise((resolve) => setTimeout(resolve, 650))
const sampled = sampler.sample()
check('the second CPU reading exists', sampled.cpu !== null, JSON.stringify(sampled.cpu))
check('the sampler reports its window', sampled.windowMs >= 500)
check('the sampler reports core count', sampled.cpu.cores > 0)
check('no reading is NaN or infinite',
  [sampled.cpu.system.percent, sampled.cpu.process.percentOfCore, sampled.cpu.process.percentOfMachine]
    .every((value) => Number.isFinite(value)))
sampler.dispose()

check('volume read returns bytes', (() => {
  const volume = readVolume(home)
  return volume !== null && volume.totalBytes > 0 && volume.availableBytes >= 0
})())
check('volume read tolerates a bogus path', readVolume(join(home, 'no-such-directory', 'x')) !== null || true)

const scanner = createStorageScanner({ home })
check('a cold scanner has no snapshot yet', scanner.current().snapshot === null)
check('a cold scanner reports itself stale', scanner.current().stale === true)
await scanner.refresh()
check('refresh publishes a snapshot', scanner.current().snapshot !== null)
check('a fresh scanner is not stale', scanner.current().stale === false)
check('the published tree covers the fixture', scanner.current().snapshot.files >= 1)
scanner.dispose()

const memory = readMemory()
check('readMemory reports RSS', typeof memory.rssMib === 'number' && memory.rssMib > 0)
check('readMemory reports machine memory', memory.machine.totalBytes > 0)
check('readMemory machine usage is a percentage',
  memory.machine.usedPercent >= 0 && memory.machine.usedPercent <= 100)
const runtime = readRuntime()
check('readRuntime reports the pid', runtime.pid === process.pid)
check('readRuntime reports the Node version', runtime.nodeVersion === process.version)
check('readRuntime tolerates a missing load average', runtime.load === null || typeof runtime.load.one === 'number')

// ══ Whole-application memory ═══════════════════════════════════════════════
console.log('\napp memory attribution')
// A generic executable name cannot identify one application: summing every
// `node.exe` would fold in editors and unrelated CLIs, so the reader must
// refuse rather than invent a number.
const generic = createAppMemoryReader({ execPath: '/usr/bin/node' })
check('a generic executable is refused', generic.supported === false)
check('a refused reader reports no total', generic.read().totalBytes === null)
check('a refused reader says why', generic.read().supported === false)
generic.dispose()

const namedNode = createAppMemoryReader({ execPath: 'C:\\tools\\node.exe' })
check('node.exe is refused on Windows too', namedNode.supported === false)
namedNode.dispose()

// A packaged build runs under its own name, where summing is exact.
const appReader = createAppMemoryReader({ execPath: '/Apps/DeepSeek Harness.app' })
check('an app-specific executable is attributed', appReader.supported === true)
check('the reader names the executable it sums', appReader.label === 'DeepSeek Harness.app')
check('the first read reports loading, not zero', appReader.read().loading === true)
check('the first read reports no total yet', appReader.read().totalBytes === null)
appReader.dispose()
check('a disposed reader stops reporting', appReader.read().totalBytes === null)

const electronReader = createAppMemoryReader({ execPath: '/usr/lib/electron/electron' })
check('a bare electron is refused', electronReader.supported === false)
electronReader.dispose()

// ══ Per-process breakdown ══════════════════════════════════════════════════
console.log('\nprocess breakdown')
// A role is what a user recognizes in Task Manager, so the command line has to
// map to one reliably.
check('an unmarked process is the main one', classifyRole('app.exe').role === 'main')
check('a renderer is recognized', classifyRole('app.exe --type=renderer --x').role === 'renderer')
check('a GPU process is recognized', classifyRole('app.exe --type=gpu-process').role === 'gpu')
check('a utility process is recognized', classifyRole('app.exe --type=utility').role === 'utility')
check('a network service keeps its subtype',
  classifyRole('app.exe --type=utility --utility-sub-type=network.mojom.NetworkService').subType === 'NetworkService')
check('a missing command line is handled', classifyRole(undefined).role === 'main')

const fakeProcesses = [
  { pid: 1, parentPid: 0, bytes: 300, commandLine: 'app.exe' },
  { pid: 2, parentPid: 1, bytes: 500, commandLine: 'app.exe --type=renderer' },
  { pid: 3, parentPid: 1, bytes: 100, commandLine: 'app.exe --type=gpu-process' },
  { pid: 4, parentPid: 1, bytes: 50, commandLine: 'app.exe --type=utility' },
]
const breakdown = buildBreakdown(fakeProcesses, 1)
check('rows are sorted by size', breakdown.rows[0].pid === 2 && breakdown.rows[1].pid === 1)
check('the total sums every process', breakdown.totalBytes === 950)
check('the process count is reported', breakdown.processCount === 4)
check('the host process is flagged', breakdown.rows.find((row) => row.pid === 1).host === true)
check('foreign processes are not flagged', breakdown.rows.filter((row) => row.pid !== 1).every((row) => row.host === false))
check('each row carries a MiB figure', breakdown.rows.every((row) => typeof row.mib === 'number'))
check('no tail is folded when everything fits', breakdown.others === null)

// A harness with many subprocesses must not push the card off screen.
const manyProcesses = Array.from({ length: 20 }, (_, index) => ({
  pid: index + 1,
  parentPid: 1,
  bytes: (20 - index) * 1024 * 1024,
  commandLine: index === 0 ? 'app.exe' : 'app.exe --type=renderer',
}))
const cappedBreakdown = buildBreakdown(manyProcesses, 1)
check('the row list is capped', cappedBreakdown.rows.length === 12)
check('the folded tail is summarized',
  cappedBreakdown.others !== null && cappedBreakdown.others.count === 8 && cappedBreakdown.others.bytes > 0)
check('rows plus the tail still equal the total',
  cappedBreakdown.rows.reduce((sum, row) => sum + row.bytes, 0) + cappedBreakdown.others.bytes === cappedBreakdown.totalBytes)

rmSync(home, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
