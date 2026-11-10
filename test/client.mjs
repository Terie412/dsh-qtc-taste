/**
 * Client-half tests for the dsh-qtc-taste toolkit.
 *
 * The browser half is plain JavaScript registered into the host's slot system,
 * so there is no type checker to catch the three failures that actually blank a
 * plugin's UI:
 *
 * 1. a slot registration the shell cannot resolve (wrong id, or a `main` key
 *    that does not match the sidebar entry that selects it);
 * 2. a missing translation key, which renders as the raw key;
 * 3. a component that throws, which blanks its slot entry.
 *
 * This file loads the real `client.js` through a stand-in module loader with a
 * minimal React, asserts the registrations, checks dictionary coverage, renders
 * every panel state, and audits the stylesheet for token and class drift.
 *
 * Usage: node test/client.mjs   (from the package root)
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let failures = 0
function check (name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ══ Load the module through a stand-in loader ══════════════════════════════
/** Hook state queue for the next render, consumed in call order. */
let stateQueue = {}
let stateIndex = 0

const React = {
  createElement (type, props, ...children) {
    // Invoke function components eagerly, as React would, so a throw surfaces.
    if (typeof type === 'function') {
      return type({ ...props, children: children.length <= 1 ? children[0] : children })
    }
    return { type, props: props ?? {}, children }
  },
  useState (initial) {
    const index = stateIndex
    stateIndex += 1
    const value = Object.hasOwn(stateQueue, index)
      ? stateQueue[index]
      : (typeof initial === 'function' ? initial() : initial)
    return [value, () => {}]
  },
  useEffect () {},
  useCallback (fn) { return fn },
  useMemo (fn) { return fn() },
  useRef (value) { return { current: value } },
  useSyncExternalStore () { return 0 },
}

globalThis.window = {
  setTimeout: () => 0,
  clearTimeout: () => {},
  __ModuleLoader__: { load: (mod) => { globalThis.__loaded = mod } },
}
await import('../client.js')

const registered = []
const dictionaries = []
const effects = []
const tabTypes = []
const plugin = globalThis.__loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module: ${name}`)
})

const ctx = {
  effect (fn, label) {
    const dispose = fn()
    const wrapped = typeof dispose === 'function' ? dispose : () => {}
    effects.push({ label, dispose: wrapped })
    return wrapped
  },
  inject (_names, callback) {
    callback({
      ...ctx,
      // The right column's registry: optional, so it is provided here to
      // exercise the tab path, and omitted in the second pass below.
      sidebarRightTabs: {
        register (definition) {
          tabTypes.push(definition)
          return () => {}
        },
      },
    })
  },
  slots: {
    inject (_owner, callback) { callback() },
    register (options, component) {
      registered.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register (ns, locale, dict) {
      dictionaries.push({ locale, dict })
      return () => {}
    },
    bind () { return (key) => key },
    subscribe () { return () => {} },
  },
  get () { return undefined },
  on () { return () => {} },
}

// ══ Composition ════════════════════════════════════════════════════════════
console.log('composition')
check('the module registers under the package name', globalThis.__loaded.id === 'dsh-qtc-taste')
check('apply does not throw', (() => { plugin.apply(ctx); return true })())
check('inject declares slots and locale', plugin.inject?.includes('slots') && plugin.inject?.includes('locale'))
check('both dictionaries are registered', dictionaries.length === 2)

const bySlot = (name) => registered.filter((entry) => (entry.options.name ?? entry.options.key) === name)

// ══ Registrations ══════════════════════════════════════════════════════════
console.log('\nregistrations')
check('one settings icon', bySlot('settings.section.icon').length === 1)
check('one settings page', bySlot('settings.section').length === 1)
check('one sidebar panel icon', bySlot('sidebar.panellist').length === 1)
check('one main panel', bySlot('main').length === 1)
check('settings icon and page share an id',
  bySlot('settings.section.icon')[0]?.options.id === bySlot('settings.section')[0]?.options.id)
check('the sidebar entry id keys the main panel',
  bySlot('sidebar.panellist')[0]?.options.id === bySlot('main')[0]?.options.key,
  `${bySlot('sidebar.panellist')[0]?.options.id} vs ${bySlot('main')[0]?.options.key}`)
check('the sidebar label is a thunk', typeof bySlot('sidebar.panellist')[0]?.options.label === 'function')
check('every registration supplies a component', registered.every((entry) => typeof entry.component === 'function'))
// The chip title is a bare label like the shipped ones (`FilesTitle`,
// `GuideTitle` register no locale either); every other surface renders
// translated copy and must declare the namespace so it re-renders on switch.
const localized = registered.filter((entry) => (entry.options.name ?? entry.options.key) !== 'sidebar.right.pane.tab.title')
check('every localized registration names the plugin namespace',
  localized.every((entry) => entry.options.locale === 'qtcTaste'),
  localized.filter((entry) => entry.options.locale !== 'qtcTaste').map((entry) => entry.options.name ?? entry.options.key).join(', '))
check('no registration is duplicated', new Set(registered.map((entry) =>
  `${entry.options.name ?? entry.options.key}:${entry.options.id ?? entry.options.key}`)).size === registered.length)

// ══ Right column tab ═══════════════════════════════════════════════════════
console.log('\nright column tab')
check('one tab type is registered', tabTypes.length === 1)
const tabType = tabTypes[0] ?? {}
check('the tab type declares a kind', typeof tabType.kind === 'string' && tabType.kind !== '')
check('the tab type declares an id', typeof tabType.id === 'string' && tabType.id !== '')
check('the tab type is in the builtin band', tabType.priority === 'builtin')
check('the tab type title is a thunk', typeof tabType.title === 'function')
check('the tab type contributes exactly one guide entry', (tabType.guide ?? []).length === 1)

const guideEntry = (tabType.guide ?? [])[0] ?? {}
check('the guide entry orders itself among the shipped entries', typeof guideEntry.order === 'number')
check('the guide entry has a title thunk', typeof guideEntry.title === 'function')
check('the guide entry has a description thunk', typeof guideEntry.description === 'function')
check('the guide entry has an icon component', typeof guideEntry.icon === 'function')

// The column dispatches a tab to the slot entry whose key equals the TYPE id.
const bodies = registered.filter((entry) => (entry.options.name ?? entry.options.key) === 'sidebar.right.pane.tab')
const titles = registered.filter((entry) => (entry.options.name ?? entry.options.key) === 'sidebar.right.pane.tab.title')
check('one right-column body', bodies.length === 1)
check('one right-column chip title', titles.length === 1)
check('the body is keyed by the tab type id', bodies[0]?.options.key === tabType.id, `${bodies[0]?.options.key} vs ${tabType.id}`)
check('the chip title is keyed by the tab type id', titles[0]?.options.key === tabType.id)
check('the body renders the monitor panel', typeof bodies[0]?.component === 'function')

// ══ Dictionaries ═══════════════════════════════════════════════════════════
console.log('\ndictionaries')
const zh = dictionaries.find((entry) => entry.locale === 'zh')?.dict ?? {}
const en = dictionaries.find((entry) => entry.locale === 'en')?.dict ?? {}
check('zh and en declare the same keys',
  JSON.stringify(Object.keys(zh).sort()) === JSON.stringify(Object.keys(en).sort()))

/** Every literal key the module translates. */
const literalKeys = new Set()
for (const match of source.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) literalKeys.add(match[1])
// Keys completed by a template expression.
for (const kind of ['data', 'install']) literalKeys.add(`monitor.treeKind.${kind}`)
// Process roles are addressed by template too (`monitor.role.${role}`).
for (const role of ['main', 'renderer', 'gpu', 'utility', 'zygote', 'crashpad', 'other']) {
  literalKeys.add(`monitor.role.${role}`)
}

const missing = [...literalKeys].filter((key) => !(key in zh) || !(key in en))
check('every translated key exists in both dictionaries', missing.length === 0, missing.join(', '))

// A placeholder with no argument renders the literal "{count}" to the user.
// Catch it statically as well as in the rendered output, so the check names the
// key rather than only pointing at the page.
const placeholderless = []
for (const key of literalKeys) {
  const template = zh[key]
  if (typeof template !== 'string') continue
  const needed = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
  if (needed.length === 0) continue
  // The call site must pass at least those names.
  const callPattern = new RegExp(`t\\('${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'\\s*,\\s*\\{([^}]*)\\}`)
  const call = callPattern.exec(source)
  if (call === null) {
    placeholderless.push(`${key} (no arguments passed)`)
    continue
  }
  const passed = call[1]
  const absent = needed.filter((name) => !new RegExp(`\\b${name}\\s*:`).test(passed))
  if (absent.length > 0) placeholderless.push(`${key} (missing ${absent.join(', ')})`)
}
check('no call site omits a placeholder argument', placeholderless.length === 0, placeholderless.join('; '))

const unreferenced = Object.keys(zh).filter((key) =>
  !literalKeys.has(key) && key !== 'taste.label' && key !== 'monitor.label')
check('no dictionary key is dead weight', unreferenced.length === 0, unreferenced.join(', '))

// ══ Rendering ══════════════════════════════════════════════════════════════
console.log('\nrendering')
const now = Date.now()
const snapshot = {
  at: now,
  cpu: {
    windowMs: 1000,
    cores: 20,
    model: 'AMD Ryzen 9 3950X 16-Core Processor',
    system: { percent: 12.4 },
    process: { percentOfCore: 8.2, percentOfMachine: 0.41, userMs: 40, systemMs: 22 },
  },
  loop: { p50: 10.01, p99: 16.02, max: 25.5, count: 100 },
  memory: {
    rssMib: 476.8,
    heapTotalMib: 76.3,
    heapUsedMib: 40.1,
    externalMib: 1.9,
    machine: { totalBytes: 68570427392, usedBytes: 29370427392, usedPercent: 42.8 },
    app: {
      supported: true,
      executable: 'DeepSeek Harness.exe',
      processCount: 8,
      totalBytes: 2206191616,
      mib: 2104,
      hostSharePercent: 22.7,
      at: now,
      loading: false,
    },
  },
  runtime: { pid: 2036, nodeVersion: 'v22.22.2', platform: 'win32', arch: 'x64', uptimeSeconds: 7325, load: null },
  disk: {
    volumePath: 'C:\\',
    volume: { totalBytes: 500070084608, availableBytes: 124869009408 },
    volumeUsedPercent: 75,
    tree: {
      home: 'C:\\Users\\pc\\.dsh',
      bytes: 642000000,
      mib: 612.4,
      files: 20729,
      dirs: 1600,
      at: now,
      roots: [
        { name: 'profiles', kind: 'install', bytes: 271546896, files: 14177, at: now, mib: 259 },
        { name: 'attachments', kind: 'data', bytes: 74998335, files: 265, at: now, mib: 71.5 },
      ],
    },
    scanning: false,
    stale: false,
  },
}

/** Flatten a rendered tree to its visible text. */
function flatten (node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join('')
  if (typeof node !== 'object') return ''
  const props = node.props ?? {}
  const own = props.children !== undefined ? flatten(props.children) : ''
  return `${own}${flatten(node.children)}`
}

/** Render one page with a given hook-state queue. */
function render (page, states) {
  stateQueue = states
  stateIndex = 0
  try {
    return flatten(page({}))
  } catch (error) {
    failures += 1
    console.log(`  FAIL render threw — ${error.message}`)
    return ''
  }
}

const monitor = bySlot('main')[0].component
const taste = bySlot('settings.section')[0].component

/** The states a panel can be in, in hook order. */
const loadedState = { 0: snapshot, 1: [12.4, 9.1, 15.6], 2: true, 3: false, 4: false, 5: false, 6: null }
const firstSampleState = {
  0: { ...snapshot, cpu: null, loop: null, disk: { ...snapshot.disk, tree: null } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
}

const populated = render(monitor, loadedState)
check('the populated panel renders', populated.length > 200, String(populated.length))
check('the populated panel shows every section',
  ['monitor.section.cpu', 'monitor.section.memory', 'monitor.section.disk', 'monitor.section.health']
    .every((key) => populated.includes(key)))
check('formatted figures reach the page', /\d+(\.\d+)?%/.test(populated) && /\d+(\.\d+)? MB/.test(populated))
check('the trend strip is drawn when samples exist', populated.includes('monitor.trend'))
check('a directory row is drawn per root', populated.includes('profiles') && populated.includes('attachments'))
check('the loading state renders and says so', render(monitor, {}).includes('monitor.loading'))

const offline = render(monitor, {
  0: null, 1: [], 2: true, 3: false, 4: false, 5: false, 6: { kind: 'error', text: 'down' },
})
check('the offline state renders the failure text', offline.includes('down'))

// The first reading has no CPU delta and no tree walk result yet: every read
// of those must be null-safe, or the very first paint blanks the slot.
const firstSample = render(monitor, firstSampleState)
check('a first sample without CPU or tree renders', firstSample.includes('monitor.waiting'))
check('a missing tree does not render a directory list', !firstSample.includes('install'))

// A saturated machine must reach the warning colours rather than clipping.
const saturated = render(monitor, {
  0: {
    ...snapshot,
    cpu: { ...snapshot.cpu, system: { percent: 96.2 }, process: { ...snapshot.cpu.process, percentOfMachine: 62 } },
    loop: { p50: 40, p99: 180.5, max: 320.2, count: 10 },
    memory: { ...snapshot.memory, machine: { ...snapshot.memory.machine, usedPercent: 97.1 } },
    disk: { ...snapshot.disk, volumeUsedPercent: 94.2 },
  },
  1: [96, 92, 88], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('a saturated machine renders', saturated.includes('96.2%'), saturated.slice(0, 80))
check('a stalled event loop is labelled', saturated.includes('monitor.eventLoopBad'), saturated.slice(0, 80))

// The Settings page must still render: it shares this stylesheet and locale.
check('the personalization page renders',
  render(taste, { 0: { enabled: true, blocks: [], path: 'x' }, 1: '', 2: false, 3: false, 4: null, 5: true }).length > 0)

// The right column's body must render the same figures in its compact layout.
const rightBody = bodies[0].component
const compactTree = render(rightBody, loadedState)
check('the right-column body renders', compactTree.length > 200, String(compactTree.length))
check('the right-column body keeps every section',
  ['monitor.section.cpu', 'monitor.section.memory', 'monitor.section.disk', 'monitor.section.health']
    .every((key) => compactTree.includes(key)))
check('the right-column chip title renders', (() => {
  stateIndex = 0
  stateQueue = {}
  return flatten(titles[0].component({})) .includes('monitor.label')
})())

// A profile without the right column must not lose the rest of the plugin.
console.log('\nwithout the right column')
const fallbackRegistered = []
const fallbackCtx = {
  ...ctx,
  inject (_names, callback) { callback({ ...fallbackCtx, sidebarRightTabs: undefined }) },
  slots: {
    inject (_owner, callback) { callback() },
    register (options, component) { fallbackRegistered.push({ options, component }); return () => {} },
  },
  locale: { ...ctx.locale, register: () => () => {} },
}
check('apply survives a profile with no tab registry',
  (() => { plugin.apply(fallbackCtx); return true })())
check('the left column still registers',
  fallbackRegistered.some((entry) => (entry.options.name ?? entry.options.key) === 'sidebar.panellist'))
check('no right-column entry is registered',
  !fallbackRegistered.some((entry) => (entry.options.name ?? entry.options.key) === 'sidebar.right.pane.tab'))

// ══ Layout contract ════════════════════════════════════════════════════════
console.log('\nlayout')
/** The plugin's stylesheet text, extracted once for the layout and style blocks. */
const cssStartIndex = source.indexOf('const CSS = `')
const css = source.slice(cssStartIndex, source.indexOf('\n`', cssStartIndex))
// A main-slot occupant must claim the centre column's height: the column is
// flex:1 / overflow:hidden, so a page that only wraps its content leaves the
// frame background showing below the last card.
const panelTree = render(monitor, loadedState)
const scrollRule = /\.qtt-scroll\{[^}]*overflow:auto/.test(css) && /\.qtt-scroll\{[^}]*flex:1/.test(css)
check('the panel provides its own scroll container', scrollRule)
check('the panel shell claims the full width', /\.qtt-page--panel\{[^}]*width:100%/.test(css))
check('the panel shell keeps a page gutter', /\.qtt-page--panel\{[^}]*padding:0 clamp\(24px,4vw,48px\)/.test(css))
check('the panel title has host-sized type', /\.qtt-page--panel \.qtt-page-title\{[^}]*font-size:20px/.test(css))
check('a max-width cap does not re-create the empty right margin',
  !/\.qtt-page\{[^}]*max-width:820px/.test(css))

// The settings page renders inside the settings frame, which already pads and
// scrolls: it must not add a second set of gutters or its own scroller.
const settingsPageCss = /\.qtt-page\{([^}]*)\}/.exec(css)?.[1] ?? ''
check('the shared shell adds no gutter of its own', !/padding:0 clamp/.test(settingsPageCss))
check('the shared shell never claims the viewport height', !/height:100%/.test(settingsPageCss))
void panelTree

// ══ Data formatting ════════════════════════════════════════════════════════
console.log('\nformatting')
// An untranslated placeholder means a `t()` call missed a parameter; the user
// sees literal "{count}".
check('no rendered placeholder survives', !/\{[a-zA-Z]+\}/.test(populated), (/\{[a-zA-Z]+\}/.exec(populated) ?? [''])[0])
check('no rendered placeholder survives in the compact body', !/\{[a-zA-Z]+\}/.test(compactTree))
check('a stalled loop still renders a number', /\d/.test(populated))

// The trend axis must stay useful at idle: a fixed 0–100 scale flattens a 1%
// machine into stubs, so the ceiling adapts with a readable floor.
const trendSource = source.slice(source.indexOf('function trendCeiling'), source.indexOf('function Trend'))
check('the trend ceiling has a floor above zero idle noise',
  /TREND_MIN_CEILING\s*=\s*4/.test(source))
check('the trend ceiling follows the peak', /peak <= step/.test(trendSource))
check('the trend label states the ceiling', /monitor\.trendScale/.test(source))

// ══ Memory attribution ═════════════════════════════════════════════════════
console.log('\nmemory attribution')
// A user comparing this panel against the OS task manager compares the WHOLE
// app, so the aggregate must lead and the host's own share must be explained
// beside it rather than presented as "the memory usage".
check('the whole-application figure is rendered', populated.includes('2.1 GB'), populated.slice(0, 200))
check('the process count is shown beside it', populated.includes('monitor.appHint'))
check('the host process is labelled as the host, not the app', populated.includes('monitor.rss'))
check('the host share explains the difference', populated.includes('monitor.rssHint'))

// A launch mode where the executable name cannot identify the app (a dev build
// running as `node`) must say so instead of showing a number that folds in
// unrelated processes.
const unsupported = render(monitor, {
  0: { ...snapshot, memory: { ...snapshot.memory, app: { supported: false, processCount: null, totalBytes: null, mib: null } } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('an unattributable launch mode is stated, not faked', unsupported.includes('monitor.appUnsupported'))

// While the first aggregate read is in flight the panel must not claim zero.
const pending = render(monitor, {
  0: { ...snapshot, memory: { ...snapshot.memory, app: { supported: true, processCount: null, totalBytes: null, mib: null, loading: true } } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('a pending aggregate read reads as waiting', pending.includes('monitor.waiting'))

// A Host half that predates the aggregate omits `memory.app` entirely. That is
// not "still loading": it will never resolve until DSH restarts, so the panel
// must say so instead of spinning forever.
const hostWithoutApp = render(monitor, {
  0: { ...snapshot, memory: { rssMib: 476.8, heapTotalMib: 76.3, heapUsedMib: 40.1, externalMib: 1.9, machine: snapshot.memory.machine } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('a Host without the aggregate states the restart', hostWithoutApp.includes('monitor.appReload'))
check('a Host without the aggregate does not spin', !hostWithoutApp.includes('monitor.waiting'))

// A query that failed for good must resolve to a stated failure too.
const failedRead = render(monitor, {
  0: { ...snapshot, memory: { ...snapshot.memory, app: { supported: true, processCount: null, totalBytes: null, mib: null, loading: false, failed: 'ENOENT' } } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('a failed aggregate read states the failure', failedRead.includes('monitor.appFailed'))
check('a failed aggregate read does not spin', !failedRead.includes('monitor.waiting'))

// The total answers "how much"; the rows answer "what is using it".
const breakdownRows = [
  { pid: 84780, role: 'main', subType: null, bytes: 413138944, mib: 394.1, host: true },
  { pid: 33148, role: 'renderer', subType: null, bytes: 280145920, mib: 267.1, host: false },
  { pid: 30164, role: 'gpu', subType: null, bytes: 181141504, mib: 172.7, host: false },
  { pid: 99784, role: 'utility', subType: 'NetworkService', bytes: 55150592, mib: 52.6, host: false },
]
const withRows = render(monitor, {
  0: {
    ...snapshot,
    memory: {
      ...snapshot.memory,
      app: { ...snapshot.memory.app, processes: breakdownRows, others: { count: 2, bytes: 31457280, mib: 30 } },
    },
  },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('the breakdown is rendered', withRows.includes('monitor.processes'))
check('a row is labelled by role', withRows.includes('monitor.role.renderer') && withRows.includes('monitor.role.gpu'))
check('a service row adds its subtype', withRows.includes('NetworkService'))
check('the host row is marked', withRows.includes('monitor.hostTag'))
check('the folded tail is rendered', withRows.includes('monitor.othersRow'))

// Without rows the card must not render an empty list heading.
const noRows = render(monitor, {
  0: { ...snapshot, memory: { ...snapshot.memory, app: { ...snapshot.memory.app, processes: [] } } },
  1: [], 2: true, 3: false, 4: false, 5: false, 6: null,
})
check('no rows means no empty list', !noRows.includes('monitor.processes'))

// ══ Stylesheet ═════════════════════════════════════════════════════════════
console.log('\nstylesheet')
const cssStart = source.indexOf('const CSS = `')
void cssStart

const used = new Set()
for (const match of source.matchAll(/className: (?:'([^']+)'|`([^`]+)`)/g)) {
  const staticPart = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, ' ')
  for (const name of staticPart.split(/\s+/)) {
    // A template prefix such as `qtm-level--` is not a class; its concrete
    // forms are listed below.
    if (name === '' || name.endsWith('--')) continue
    used.add(name)
  }
}
for (const [prefix, suffixes] of [
  ['qtm-pill--', ['live', 'paused']],
  ['qtm-level--', ['ok', 'warn', 'bad', 'idle']],
  ['qtm-fill--', ['ok', 'warn', 'bad', 'idle']],
  ['qtm-root-kind--', ['data', 'install']],
  ['qtt-notice--', ['ok', 'error']],
  ['qtm-trend-col', ['--gap']],
  ['qtm-metric', ['--lead']],
]) {
  for (const suffix of suffixes) used.add(`${prefix}${suffix}`)
}
const defined = new Set()
for (const match of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) defined.add(match[1])

const undefinedClass = [...used].filter((name) => !defined.has(name))
check('every class the module writes is defined', undefinedClass.length === 0, undefinedClass.join(', '))
const unusedMonitorClass = [...defined].filter((name) => name.startsWith('qtm-') && !used.has(name))
check('no monitor rule is dead code', unusedMonitorClass.length === 0, unusedMonitorClass.join(', '))

// Tokens: only the theme's published aliases, plus geometry tokens that carry
// a fallback, one interactive token with a legible literal fallback, and the
// frame geometry the shell sets on `:root` (always read with a `0px` fallback,
// exactly as the shipped pages do it).
const PUBLISHED = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay', '--dsw-alias-border-l1', '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill', '--dsw-radius-md', '--dsw-radius-sm', '--dsw-radius-lg',
  '--dsw-alias-interactive-bg-hover', '--dsh-frame-top-clearance',
])
const referenced = new Set()
for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) referenced.add(match[1])
const unknownTokens = [...referenced].filter((token) => !PUBLISHED.has(token))
check('every token is one the theme publishes', unknownTokens.length === 0, unknownTokens.join(', '))

// A literal colour is only acceptable as a `var()` fallback.
const bareColours = [...css.matchAll(/(?:^|[;{])\s*(?:color|background|border-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)]
check('no bare literal colour', bareColours.length === 0, bareColours.map((m) => m[0]).join(', '))

// ══ Disposal ═══════════════════════════════════════════════════════════════
console.log('\ndisposal')
const primaryEffects = effects.filter((effect) => effect.label.startsWith('dsh-qtc-taste: dictionaries') ||
  effect.label.startsWith('dsh-qtc-taste: locale') ||
  effect.label.startsWith('dsh-qtc-taste: styles'))
for (const effect of [...effects].reverse()) {
  if (effect.label.startsWith('dsh-qtc-taste:')) effect.dispose()
}
check('every effect has a label', effects.every((effect) => typeof effect.label === 'string' && effect.label !== ''))
check('the owned resources are named', primaryEffects.length >= 3, String(primaryEffects.length))

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
