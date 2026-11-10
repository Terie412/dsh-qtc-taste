/**
 * dsh-qtc-taste — Client half.
 *
 * Every feature contributes one surface: a Settings page, a sidebar panel, or
 * both.
 *
 * | Surface | Feature | What it shows |
 * |---|---|---|
 * | 设置 → 个性化 | personalization | user-authored blocks injected into the system prompt |
 * | 侧边栏 → 性能监控 | monitor | live CPU, memory, disk and event-loop figures |
 *
 * A Settings feature contributes a `settings.section` registration plus a
 * matching `settings.section.icon`; their ids must match or the shell keeps its
 * default gear. A sidebar panel contributes the same id to two slots — an icon
 * to `sidebar.panellist` and a page to `main` — because the shell resolves the
 * main key from the panel id. Adding a surface means writing one page function
 * and one entry in {@link SETTINGS_PAGES} or {@link PANELS}; the shared
 * primitives below already cover its chrome.
 */
window.__ModuleLoader__.load({
  id: 'dsh-qtc-taste',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'qtcTaste'

    const zh = {
      // ── Personalization ──
      'taste.label': '个性化',
      'taste.title': '个性化',
      'taste.section': '偏好条目',
      'taste.intro': '把你自己的偏好写进系统提示词。启用的条目会在每一步请求前注入，改写后下一条消息即刻生效，不需要重启。',
      'taste.empty': '还没有偏好条目。新建一条，写下你希望模型始终遵守的要求。',
      'taste.add': '新建条目',
      'taste.save': '保存',
      'taste.saved': '已保存',
      'taste.dirty': '有未保存的修改',
      'taste.reload': '还原',
      'taste.saving': '保存中…',
      'taste.master': '启用个性化提示词',
      'taste.masterHint': '关闭后所有条目都停止注入，内容仍会保留。',
      'taste.count': '共 {count} 条，启用 {active} 条',
      'taste.chars': '{count} 字符',
      'taste.untitled': '未命名条目',
      'taste.titlePlaceholder': '标题（例如：回答语言）',
      'taste.textPlaceholder': '写下要求。支持多行，会原样注入，不会解析 {{ }} 变量。',
      'taste.remove': '删除条目',
      'taste.removeConfirm': '删除这条偏好？点保存后不可恢复。',
      'taste.cancel': '取消',
      'taste.moveUp': '上移',
      'taste.moveDown': '下移',
      'taste.toggle': '启用或停用',
      'taste.where': '存储位置',
      'taste.loading': '加载中…',
      'taste.limitNote': '最多 50 条，单条 20000 字符，合计 120000 字符。',
      // ── Monitor ──
      'monitor.label': '性能监控',
      'monitor.title': '性能监控',
      'monitor.intro': '实时查看 DSH 当前的 CPU、内存、存储占用，以及事件循环是否被阻塞。数据由本机进程直接读取，只在面板打开时采样。',
      'monitor.guideDescription': 'CPU、内存与存储占用',
      'monitor.live': '实时刷新',
      'monitor.paused': '已暂停',
      'monitor.pause': '暂停',
      'monitor.resume': '继续',
      'monitor.refresh': '立即刷新',
      'monitor.rescan': '重新测量存储',
      'monitor.rescanning': '测量中…',
      'monitor.loading': '正在读取第一组数据…',
      'monitor.waiting': '采样中…',
      'monitor.updated': '{time} 更新',
      'monitor.section.cpu': 'CPU',
      'monitor.section.memory': '内存',
      'monitor.section.disk': '存储',
      'monitor.section.health': '运行状态',
      'monitor.system': '整机 CPU',
      'monitor.process': 'DSH 进程 CPU',
      'monitor.systemHint': '全部核心的平均占用',
      'monitor.processHint': '单个核心为 100%，占整机的 {share}',
      'monitor.window': '{ms} ms',
      'monitor.cores': '{count} 核',
      'monitor.load': '系统负载',
      'monitor.loadHint': '1 / 5 / 15 分钟平均',
      'monitor.rss': '宿主进程 RSS',
      'monitor.rssHint': 'DSH 主进程本身，约占整个应用的 {share}',
      'monitor.app': '整个应用',
      'monitor.appHint': '{count} 个进程合计，与任务管理器一致',
      'monitor.appUnsupported': '当前启动方式下无法按进程名归集',
      'monitor.appFailed': '无法读取进程列表，已重试',
      'monitor.appReload': '宿主尚未提供该数据，重启 DSH 后生效',
      'monitor.processes': '按进程',
      'monitor.role.main': '主进程',
      'monitor.role.renderer': '渲染进程',
      'monitor.role.gpu': 'GPU 进程',
      'monitor.role.utility': '服务进程',
      'monitor.role.zygote': 'Zygote',
      'monitor.role.crashpad': '崩溃报告',
      'monitor.role.other': '其他进程',
      'monitor.hostTag': '宿主',
      'monitor.othersRow': '其余 {count} 个进程',
      'monitor.processesEmpty': '暂无进程明细',
      'monitor.heap': 'JS 堆',
      'monitor.heapUsed': '已用 {used} / {total}',
      'monitor.external': '堆外内存',
      'monitor.machine': '整机内存',
      'monitor.machineHint': '已用 {used} / {total}',
      'monitor.volume': '磁盘 {path}',
      'monitor.volumeHint': '剩余 {free} / 共 {total}',
      'monitor.tree': 'DSH 数据目录',
      'monitor.treeHint': '{files} 个文件，{dirs} 个目录',
      'monitor.treeStale': '后台重新测量中，显示的是上一次结果',
      'monitor.treeKind.data': '数据',
      'monitor.treeKind.install': '安装包',
      'monitor.eventLoop': '事件循环延迟',
      'monitor.eventLoopHint': 'P99 {p99} ms，最大 {max} ms',
      'monitor.eventLoopOk': '正常',
      'monitor.eventLoopWarn': '偏高',
      'monitor.eventLoopBad': '阻塞',
      'monitor.uptime': '进程运行时长',
      'monitor.pid': '进程 {pid}',
      'monitor.trend': '最近 {count} 次采样',
      'monitor.trendScale': '上限 {ceiling}',
      'monitor.trendEmpty': '还在积累采样点…',
      'monitor.unavailable': '不可用',
      'monitor.barTip': '{value}',
      // ── Shared ──
      'common.offline': '无法连接本地服务',
      'common.reload': '重试',
    }

    const en = {
      'taste.label': 'Personalization',
      'taste.title': 'Personalization',
      'taste.section': 'Preference blocks',
      'taste.intro': 'Write your own preferences into the system prompt. Enabled blocks are injected before every step, and an edit applies to the next message — no restart.',
      'taste.empty': 'No preferences yet. Add one and write down what the model should always honour.',
      'taste.add': 'Add block',
      'taste.save': 'Save',
      'taste.saved': 'Saved',
      'taste.dirty': 'Unsaved changes',
      'taste.reload': 'Revert',
      'taste.saving': 'Saving…',
      'taste.master': 'Inject personal preferences',
      'taste.masterHint': 'Turned off, no block is injected; the text is kept.',
      'taste.count': '{count} blocks, {active} enabled',
      'taste.chars': '{count} characters',
      'taste.untitled': 'Untitled block',
      'taste.titlePlaceholder': 'Title (for example: Response language)',
      'taste.textPlaceholder': 'Write the requirement. Multi-line, injected verbatim, {{ }} is not interpolated.',
      'taste.remove': 'Delete block',
      'taste.removeConfirm': 'Delete this preference? Saving is irreversible.',
      'taste.cancel': 'Cancel',
      'taste.moveUp': 'Move up',
      'taste.moveDown': 'Move down',
      'taste.toggle': 'Enable or disable',
      'taste.where': 'Stored at',
      'taste.loading': 'Loading…',
      'taste.limitNote': 'Up to 50 blocks, 20000 characters each, 120000 in total.',
      // ── Monitor ──
      'monitor.label': 'Performance',
      'monitor.title': 'Performance',
      'monitor.intro': 'Live CPU, memory and storage figures for this DSH process, plus whether the event loop is keeping up. Everything is read from the local process and only sampled while the panel is open.',
      'monitor.guideDescription': 'CPU, memory and storage in use',
      'monitor.live': 'Live',
      'monitor.paused': 'Paused',
      'monitor.pause': 'Pause',
      'monitor.resume': 'Resume',
      'monitor.refresh': 'Refresh now',
      'monitor.rescan': 'Re-measure storage',
      'monitor.rescanning': 'Measuring…',
      'monitor.loading': 'Reading the first sample…',
      'monitor.waiting': 'Sampling…',
      'monitor.updated': 'Updated {time}',
      'monitor.section.cpu': 'CPU',
      'monitor.section.memory': 'Memory',
      'monitor.section.disk': 'Storage',
      'monitor.section.health': 'Health',
      'monitor.system': 'Machine CPU',
      'monitor.process': 'DSH process CPU',
      'monitor.systemHint': 'Average across every core',
      'monitor.processHint': '100% is one core; {share} of the machine',
      'monitor.window': '{ms} ms',
      'monitor.cores': '{count} cores',
      'monitor.load': 'Load average',
      'monitor.loadHint': '1 / 5 / 15 minutes',
      'monitor.rss': 'Host process RSS',
      'monitor.rssHint': 'The DSH main process alone — about {share} of the app',
      'monitor.app': 'Whole application',
      'monitor.appHint': '{count} processes combined, matching Task Manager',
      'monitor.appUnsupported': 'Processes cannot be grouped by name in this launch mode',
      'monitor.appFailed': 'Cannot read the process list; retrying',
      'monitor.appReload': 'The Host does not provide this yet — restart DSH to apply',
      'monitor.processes': 'By process',
      'monitor.role.main': 'Main',
      'monitor.role.renderer': 'Renderer',
      'monitor.role.gpu': 'GPU',
      'monitor.role.utility': 'Service',
      'monitor.role.zygote': 'Zygote',
      'monitor.role.crashpad': 'Crash handler',
      'monitor.role.other': 'Other',
      'monitor.hostTag': 'host',
      'monitor.othersRow': '{count} more processes',
      'monitor.processesEmpty': 'No process detail available',
      'monitor.heap': 'JS heap',
      'monitor.heapUsed': '{used} of {total} used',
      'monitor.external': 'Off-heap memory',
      'monitor.machine': 'Machine memory',
      'monitor.machineHint': '{used} of {total} used',
      'monitor.volume': 'Disk {path}',
      'monitor.volumeHint': '{free} free of {total}',
      'monitor.tree': 'DSH data directory',
      'monitor.treeHint': '{files} files across {dirs} directories',
      'monitor.treeStale': 'Re-measuring in the background; showing the previous result',
      'monitor.treeKind.data': 'Data',
      'monitor.treeKind.install': 'Packages',
      'monitor.eventLoop': 'Event loop delay',
      'monitor.eventLoopHint': 'P99 {p99} ms, max {max} ms',
      'monitor.eventLoopOk': 'Healthy',
      'monitor.eventLoopWarn': 'Elevated',
      'monitor.eventLoopBad': 'Blocked',
      'monitor.uptime': 'Process uptime',
      'monitor.pid': 'pid {pid}',
      'monitor.trend': 'Last {count} samples',
      'monitor.trendScale': 'Max {ceiling}',
      'monitor.trendEmpty': 'Collecting samples…',
      'monitor.unavailable': 'Unavailable',
      'monitor.barTip': '{value}',
      'common.offline': 'Cannot reach the local service',
      'common.reload': 'Retry',
    }

    let translate = (key) => key

    /**
     * Bumped whenever the active locale changes. Mounted page text calls `t()`
     * during render, so each page subscribes to this counter to re-render with
     * the new dictionary instead of waiting for a remount.
     */
    let revision = 0
    const revisionListeners = new Set()

    function bumpRevision () {
      revision += 1
      for (const listener of [...revisionListeners]) listener()
    }

    function subscribeRevision (listener) {
      revisionListeners.add(listener)
      return () => { revisionListeners.delete(listener) }
    }

    /** Interpolate `{name}` placeholders. */
    function fmt (text, values) {
      if (!values) return String(text)
      return String(text).replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all))
    }

    const t = (key, values) => fmt(translate(key), values)

    // ── Host transport ─────────────────────────────────────────────────────
    /**
     * Resolve one of the plugin's own host routes against the page base, so a
     * reverse-proxy prefix and the desktop shell both keep working.
     * @param path - route below the page directory.
     * @returns an absolute URL.
     */
    function hostUrl (path) {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : 'http://dsh.internal/'
      return new URL(path.replace(/^\/+/, ''), new URL(base, 'http://dsh.internal/')).href
    }

    /**
     * Call one feature route on the Host half.
     * @param path - the feature's route path.
     * @param method - route method name.
     * @param payload - extra request fields.
     * @returns the route's `value`.
     */
    async function callHost (path, method, payload) {
      const response = await fetch(hostUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, ...payload }),
      })
      const body = await response.json().catch(() => null)
      if (body === null || body.ok !== true) {
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      }
      return body.value
    }

    // ── Shared controls ────────────────────────────────────────────────────
    /** A small inline SVG built from path data, on the host's stroke contract. */
    function icon (paths, size, extra) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size ?? 14,
        height: size ?? 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
        ...extra,
      }, paths.map((d, index) => h('path', { key: index, d })))
    }

    const ICON_UP = ['M12 19V5', 'M6 11l6-6 6 6']
    const ICON_DOWN = ['M12 5v14', 'M6 13l6 6 6-6']
    const ICON_TRASH = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3']
    const ICON_PLUS = ['M12 5v14', 'M5 12h14']

    /**
     * The shared feature switch.
     * @param props - `{ checked, label, disabled, onChange }`.
     * @returns the switch button.
     */
    function Switch (props) {
      const { checked, label, disabled, onChange } = props
      return h('button', {
        type: 'button',
        className: `qtt-switch${checked ? ' qtt-switch--on' : ''}`,
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        title: label,
        disabled,
        onClick: onChange,
      }, h('span', { className: 'qtt-switch-knob' }))
    }

    /**
     * The shared master row: a switch beside a title and a hint.
     * @param props - `{ checked, title, hint, disabled, onChange }`.
     * @returns the row.
     */
    function MasterRow (props) {
      const { checked, title, hint, disabled, onChange } = props
      return h('div', { className: 'qtt-master' },
        h(Switch, { checked, label: title, disabled, onChange }),
        h('div', { className: 'qtt-master-text' },
          h('div', { className: 'qtt-master-title' }, title),
          h('div', { className: 'qtt-master-hint' }, hint),
        ),
      )
    }

    /**
     * The shared transient notice.
     * @param notice - `{ kind, text }` or null.
     * @returns the notice, or null.
     */
    function Notice (notice) {
      if (notice === null || notice === undefined) return null
      return h('div', {
        className: `qtt-notice qtt-notice--${notice.kind}`,
        role: 'status',
      }, notice.text)
    }

    /**
     * Page scaffolding shared by every surface.
     *
     * The two hosts this plugin renders into have opposite geometry, so the
     * shell adapts rather than forcing one shape on both:
     *
     * - **Main panel** (`surface: 'panel'`): it OWNS the centre column, which is
     *   `flex:1; overflow:hidden`. The shell therefore claims the full height,
     *   scrolls its own body, and supplies the page gutters itself — the same
     *   structure the shipped Schedules page uses. Without the height the column
     *   would show the frame background below the last card.
     * - **Settings section** (`surface: 'settings'`, the default): it renders
     *   inside the settings frame, which already scrolls and already pads. The
     *   shell therefore stays a plain block with no gutters of its own.
     * - **Right column tab** (`compact`): a fraction of the width; it tightens
     *   padding and drops the intro instead of wrapping into a ribbon.
     * @param props - `{ title, intro, surface, compact, children }`.
     * @returns the page shell.
     */
    function Page (props) {
      const compact = props.compact === true
      const panel = props.surface === 'panel'
      const className = `qtt-page${panel ? ' qtt-page--panel' : ''}${compact ? ' qtt-page--compact' : ''}`
      const body = [
        h('h2', { className: 'qtt-page-title' }, props.title),
        props.intro === undefined ? null : h('p', { className: 'qtt-page-intro' }, props.intro),
        props.children,
      ]
      // The panel splits scroll container and content box so the gutters stay
      // on the content: padding on the scroller itself would clip the scrollbar
      // gutter on Windows.
      if (panel && !compact) {
        return h('div', { className: 'qtt-scroll' },
          h('div', { className }, body))
      }
      return h('div', { className }, body)
    }

    /**
     * Shared "cannot load" state: editing an unread document would overwrite
     * data the page never saw, so it offers a retry instead of the editor.
     * @param props - `{ title, intro, text, busy, onRetry, compact }`.
     * @returns the fallback page.
     */
    function OfflinePage (props) {
      return h(Page, { title: props.title, intro: props.intro, compact: props.compact, surface: props.surface },
        h('div', { className: 'qtt-notice qtt-notice--error', role: 'status' }, props.text),
        h('div', { className: 'qtt-actions' },
          h('button', {
            type: 'button',
            className: 'qtt-btn',
            disabled: props.busy,
            onClick: props.onRetry,
          }, t('common.reload'))),
      )
    }

    // ── Feature icon ───────────────────────────────────────────────────────
    /**
     * The 个性化 navigation glyph: a smiley star with a spark, drawn to the
     * host's 16-unit stroke contract (no fill, `currentColor`, 1.3 stroke,
     * round joins) so it sits level with the built-in settings rows.
     *
     * The composition is normalized so its ink — stroke included — spans about
     * 10.4 of the 16 units, which is the footprint the shipped settings icons
     * occupy; that is what keeps the visual weight consistent rather than the
     * nominal box size.
     * @param props - `{ size }` from the settings nav row.
     * @returns the inline SVG.
     */
    function TasteIcon (props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      // Rounded five-point star.
      h('path', {
        d: 'M7.48 4.32 L8.26 5.89 Q8.51 6.38 9.05 6.46 L10.78 6.72 Q11.21 6.79 10.9 7.09 L9.65 8.32 Q9.27 8.71 9.35 9.25 L9.64 10.97 Q9.71 11.41 9.32 11.2 L7.77 10.4 Q7.28 10.15 6.8 10.4 L5.24 11.2 Q4.85 11.41 4.92 10.97 L5.21 9.25 Q5.3 8.71 4.91 8.32 L3.66 7.09 Q3.35 6.79 3.79 6.72 L5.51 6.46 Q6.06 6.38 6.3 5.89 L7.09 4.32 Q7.28 3.93 7.48 4.32Z',
      }),
      // Two eyes, the right one higher, so the face reads as a wink.
      h('path', { d: 'M6.41 7.64h0' }),
      h('path', { d: 'M7.72 7.28h0' }),
      // Smile.
      h('path', { d: 'M6.58 8.37a1.11 1.11 0 0 0 1.84 0.2' }),
      // Spark, outside the star at the lower right.
      h('path', { d: 'M11.5 10.92L12.65 12.07' }),
      )
    }

    // ══ Page: 个性化 ═══════════════════════════════════════════════════════
    /** Host route mounted by the personalization feature. */
    const TASTE_API = 'qtc-taste/api'

    /** Limits mirrored from the host half. */
    const MAX_BLOCKS = 50
    const MAX_TEXT = 20000
    const MAX_TOTAL = 120000

    /** @returns a fresh block with a locally unique id. */
    let localId = 0
    function newBlock () {
      localId += 1
      return {
        id: `new-${Date.now().toString(36)}-${localId.toString(36)}`,
        title: '',
        text: '',
        enabled: true,
      }
    }

    /**
     * Normalize a server view into page state.
     * @param value - the route's returned value.
     * @returns `{ enabled, blocks, path }`.
     */
    function tasteFromView (value) {
      const blocks = Array.isArray(value?.blocks) ? value.blocks : []
      return {
        enabled: value?.enabled !== false,
        blocks: blocks.map((block) => ({
          id: typeof block?.id === 'string' ? block.id : newBlock().id,
          title: typeof block?.title === 'string' ? block.title : '',
          text: typeof block?.text === 'string' ? block.text : '',
          enabled: block?.enabled !== false,
        })),
        path: typeof value?.path === 'string' ? value.path : '',
      }
    }

    /**
     * Canonical serialization used for the dirty check: string comparison is
     * exact, cheap, and survives block reordering.
     * @param state - page state.
     * @returns the comparable string.
     */
    function tasteSerialize (state) {
      return JSON.stringify({
        enabled: state.enabled,
        blocks: state.blocks.map(block => ({
          id: block.id,
          title: block.title,
          text: block.text,
          enabled: block.enabled,
        })),
      })
    }

    /**
     * One preference block row: switch, title, body, order and delete.
     * @param props - row props.
     * @returns the row element.
     */
    function BlockRow (props) {
      const { block, index, total, busy, onChange, onToggle, onMove, onRemove } = props
      // Deleting is only committed by the page-level save, but a stray click
      // would still cost the user their text: ask inside the row first.
      const [confirming, setConfirming] = useState(false)
      const label = block.title.trim() === '' ? t('taste.untitled') : block.title.trim()
      if (confirming) {
        return h('div', { className: 'qtt-row qtt-row--confirm' },
          h('div', { className: 'qtt-confirm-text' }, t('taste.removeConfirm')),
          h('div', { className: 'qtt-confirm-actions' },
            h('button', {
              type: 'button', className: 'qtt-btn qtt-btn--ghost', disabled: busy,
              onClick: () => setConfirming(false),
            }, t('taste.cancel')),
            h('button', {
              type: 'button', className: 'qtt-btn qtt-btn--danger', disabled: busy,
              onClick: () => {
                setConfirming(false)
                onRemove(index)
              },
            }, t('taste.remove')),
          ),
        )
      }
      return h('div', { className: `qtt-row${block.enabled ? '' : ' qtt-row--off'}` },
        h('div', { className: 'qtt-row-head' },
          h(Switch, {
            checked: block.enabled,
            label: t('taste.toggle'),
            disabled: busy,
            onChange: () => onToggle(index),
          }),
          h('span', { className: 'qtt-row-name', title: label }, label),
          h('span', { className: 'qtt-row-count' }, t('taste.chars', { count: block.text.length })),
          h('span', { className: 'qtt-row-actions' },
            h('button', {
              type: 'button', className: 'qtt-icon-btn', title: t('taste.moveUp'),
              'aria-label': t('taste.moveUp'), disabled: busy || index === 0,
              onClick: () => onMove(index, -1),
            }, icon(ICON_UP, 12, { strokeWidth: 2 })),
            h('button', {
              type: 'button', className: 'qtt-icon-btn', title: t('taste.moveDown'),
              'aria-label': t('taste.moveDown'), disabled: busy || index === total - 1,
              onClick: () => onMove(index, 1),
            }, icon(ICON_DOWN, 12, { strokeWidth: 2 })),
            h('button', {
              type: 'button', className: 'qtt-icon-btn qtt-icon-btn--danger', title: t('taste.remove'),
              'aria-label': t('taste.remove'), disabled: busy,
              onClick: () => setConfirming(true),
            }, icon(ICON_TRASH, 12, { strokeWidth: 2 })),
          ),
        ),
        h('input', {
          className: 'qtt-input',
          type: 'text',
          value: block.title,
          maxLength: 120,
          placeholder: t('taste.titlePlaceholder'),
          disabled: busy,
          'aria-label': t('taste.titlePlaceholder'),
          onChange: (event) => onChange(index, { title: event.target.value }),
        }),
        h('textarea', {
          className: 'qtt-textarea',
          value: block.text,
          rows: Math.min(14, Math.max(3, block.text.split('\n').length + 1)),
          maxLength: MAX_TEXT,
          placeholder: t('taste.textPlaceholder'),
          disabled: busy,
          'aria-label': t('taste.textPlaceholder'),
          onChange: (event) => onChange(index, { text: event.target.value }),
        }),
      )
    }

    /** The 个性化 settings page. */
    function TastePage () {
      const [state, setState] = useState({ enabled: true, blocks: [], path: '' })
      const [saved, setSaved] = useState('')
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      /**
       * Whether the state on screen came from the Host. A failed initial load
       * must not enable Save: saving the empty default would overwrite
       * preferences the page never managed to read.
       */
      const [loaded, setLoaded] = useState(false)
      const mounted = useRef(true)

      useSyncExternalStore(subscribeRevision, () => revision, () => revision)

      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
      }, [])

      const applyView = useCallback((value) => {
        const next = tasteFromView(value)
        setState(next)
        setSaved(tasteSerialize(next))
        return next
      }, [])

      const reload = useCallback(async () => {
        try {
          const value = await callHost(TASTE_API, 'state')
          if (!mounted.current) return
          applyView(value)
          setLoaded(true)
          setNotice(null)
        } catch (error) {
          if (!mounted.current) return
          setNotice({ kind: 'error', text: String(error?.message ?? error) || t('common.offline') })
        }
      }, [applyView])

      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const value = await callHost(TASTE_API, 'state')
            if (cancelled || !mounted.current) return
            applyView(value)
            setLoaded(true)
          } catch (error) {
            if (cancelled || !mounted.current) return
            setNotice({ kind: 'error', text: String(error?.message ?? error) || t('common.offline') })
          } finally {
            if (!cancelled && mounted.current) setLoading(false)
          }
        })()
        return () => { cancelled = true }
      }, [applyView])

      const dirty = loaded && tasteSerialize(state) !== saved && loading === false
      const activeCount = useMemo(
        () => state.blocks.filter(block => block.enabled && block.text.trim() !== '').length,
        [state.blocks],
      )
      const totalChars = useMemo(
        () => state.blocks.reduce((sum, block) => sum + block.text.length, 0),
        [state.blocks],
      )

      const patchBlock = useCallback((index, patch) => {
        setState((current) => {
          const blocks = current.blocks.map((block, at) => (at === index ? { ...block, ...patch } : block))
          return { ...current, blocks }
        })
        setNotice(null)
      }, [])

      const toggleBlock = useCallback((index) => {
        setState((current) => {
          const blocks = current.blocks.map((block, at) => (
            at === index ? { ...block, enabled: !block.enabled } : block
          ))
          return { ...current, blocks }
        })
        setNotice(null)
      }, [])

      const moveBlock = useCallback((index, delta) => {
        setState((current) => {
          const target = index + delta
          if (target < 0 || target >= current.blocks.length) return current
          const blocks = [...current.blocks]
          const [moved] = blocks.splice(index, 1)
          blocks.splice(target, 0, moved)
          return { ...current, blocks }
        })
        setNotice(null)
      }, [])

      const removeBlock = useCallback((index) => {
        setState((current) => ({
          ...current,
          blocks: current.blocks.filter((_, at) => at !== index),
        }))
        setNotice(null)
      }, [])

      const addBlock = useCallback(() => {
        setState((current) => {
          if (current.blocks.length >= MAX_BLOCKS) return current
          return { ...current, blocks: [...current.blocks, newBlock()] }
        })
        setNotice(null)
      }, [])

      const save = useCallback(async () => {
        if (busy || !loaded) return
        if (totalChars > MAX_TOTAL) {
          setNotice({ kind: 'error', text: t('taste.limitNote') })
          return
        }
        setBusy(true)
        setNotice(null)
        try {
          const value = await callHost(TASTE_API, 'save', {
            enabled: state.enabled,
            blocks: state.blocks.map(({ id, title, text, enabled }) => ({ id, title, text, enabled })),
          })
          if (!mounted.current) return
          applyView(value)
          setNotice({ kind: 'ok', text: t('taste.saved') })
        } catch (error) {
          if (!mounted.current) return
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
        } finally {
          if (mounted.current) setBusy(false)
        }
      }, [busy, loaded, state, totalChars, applyView])

      if (loading) {
        return h(Page, { title: t('taste.title') }, h('div', { className: 'qtt-hint' }, t('taste.loading')))
      }

      // Without the Host's document there is nothing safe to edit: saving the
      // empty placeholder would overwrite preferences the page never read.
      if (!loaded) {
        return h(OfflinePage, {
          title: t('taste.title'),
          intro: t('taste.intro'),
          text: notice === null ? t('common.offline') : notice.text,
          busy,
          onRetry: () => {
            setBusy(true)
            void reload().finally(() => {
              if (mounted.current) setBusy(false)
            })
          },
        })
      }

      return h(Page, { title: t('taste.title'), intro: t('taste.intro') },
        h(MasterRow, {
          checked: state.enabled,
          title: t('taste.master'),
          hint: t('taste.masterHint'),
          disabled: busy,
          onChange: () => {
            setState((current) => ({ ...current, enabled: !current.enabled }))
            setNotice(null)
          },
        }),

        h('div', { className: 'qtt-section-head' },
          h('div', { className: 'qtt-section-title' },
            t('taste.section'),
            h('span', { className: 'qtt-count' }, t('taste.count', {
              count: state.blocks.length,
              active: activeCount,
            })),
          ),
          h('div', { className: 'qtt-actions' },
            h('button', {
              type: 'button',
              className: 'qtt-btn qtt-btn--ghost',
              disabled: busy || !dirty,
              onClick: () => { void reload() },
            }, t('taste.reload')),
            h('button', {
              type: 'button',
              className: 'qtt-btn',
              disabled: busy || state.blocks.length >= MAX_BLOCKS,
              onClick: addBlock,
            }, icon(ICON_PLUS, 12, { strokeWidth: 2 }), h('span', null, t('taste.add'))),
            h('button', {
              type: 'button',
              className: 'qtt-btn qtt-btn--primary',
              disabled: busy || !dirty,
              onClick: () => { void save() },
            }, busy ? t('taste.saving') : t('taste.save')),
          ),
        ),

        dirty ? h('div', { className: 'qtt-badge' }, t('taste.dirty')) : null,
        Notice(notice),

        state.blocks.length === 0
          ? h('div', { className: 'qtt-empty' },
            h('div', null, t('taste.empty')),
            h('div', { className: 'qtt-empty-limits' }, t('taste.limitNote')))
          : h('div', { className: 'qtt-list' }, state.blocks.map((block, index) => h(BlockRow, {
            key: block.id,
            block,
            index,
            total: state.blocks.length,
            busy,
            onChange: patchBlock,
            onToggle: toggleBlock,
            onMove: moveBlock,
            onRemove: removeBlock,
          }))),

        h('div', { className: 'qtt-foot' },
          h('span', { className: 'qtt-foot-label' }, t('taste.where')),
          h('code', { className: 'qtt-path' }, state.path === '' ? '…' : state.path),
          h('span', { className: 'qtt-foot-count' }, t('taste.chars', { count: totalChars })),
        ),
      )
    }

    // ══ Page: 性能监控 ═════════════════════════════════════════════════════
    /** Host route mounted by the monitor feature. */
    const MONITOR_API = 'qtc-monitor/api'

    /** Panel poll interval while live. Matches the Host's sample floor. */
    const MONITOR_POLL_MS = 1000

    /** How many sample points the sparkline draws. */
    const TREND_POINTS = 60

    /**
     * Format a MiB figure the way a person reads disk space.
     * @param mib - megabytes, or null.
     * @returns the label, or an em dash.
     */
    function mib (mib) {
      if (typeof mib !== 'number' || !Number.isFinite(mib)) return '—'
      if (mib >= 1024) return `${(mib / 1024).toFixed(mib >= 10240 ? 0 : 1)} GB`
      return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`
    }

    /**
     * Format a percentage.
     * @param value - 0–100, or null.
     * @param decimals - decimal places.
     * @returns the label, or an em dash.
     */
    function pct (value, decimals = 1) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${value.toFixed(decimals)}%`
    }

    /**
     * Format a duration in seconds as days/hours/minutes.
     * @param seconds - elapsed seconds.
     * @returns the label.
     */
    function duration (seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m ${Math.round(seconds % 60)}s`
      return `${Math.round(seconds)}s`
    }

    /**
     * Format a clock time for the "updated at" line.
     * @param at - epoch milliseconds.
     * @returns `HH:MM:SS`.
     */
    function clock (at) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '—'
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /**
     * Colour a value by how alarming it is.
     *
     * Thresholds are the ones a developer would act on: below 70% nothing needs
     * attention, 70–90% is worth noticing, above 90% is the problem zone.
     * @param value - the percentage, or null.
     * @returns `'ok' | 'warn' | 'bad' | 'idle'`.
     */
    function level (value, warn = 70, bad = 90) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'idle'
      if (value >= bad) return 'bad'
      if (value >= warn) return 'warn'
      return 'ok'
    }

    /**
     * One titled block of the panel.
     *
     * Children stack vertically at the section's own gap; wrap a run of
     * {@link Metric} tiles in {@link Metrics} to get the responsive grid. Keeping
     * those two (grid vs. stack) separate is what lets a section hold a grid, a
     * chart, and a list without any of them becoming a grid cell.
     */
    function Section (props) {
      return h('section', { className: 'qtm-section' },
        h('div', { className: 'qtm-section-head' },
          h('h3', { className: 'qtm-section-title' }, props.title),
          props.note === undefined ? null : h('span', { className: 'qtm-section-note' }, props.note),
        ),
        props.children,
      )
    }

    /**
     * The responsive tile grid that holds {@link Metric}s.
     * @param props - `{ children }`.
     * @returns the grid.
     */
    function Metrics (props) {
      return h('div', { className: 'qtm-metrics' }, props.children)
    }

    /**
     * The per-process breakdown of the whole application.
     *
     * Task Manager gives one row per process, so a user who wants to know where
     * the memory went expects the same shape here. Each row is named by role
     * (renderer / GPU / service) rather than by PID, because that is what the
     * user recognizes; the PID is kept as the tooltip for when it is needed to
     * cross-reference.
     *
     * The bar is scaled against the largest row, not the total, so the biggest
     * process fills the track and small ones stay visible: scaled against the
     * total, every row but the leader would be a stub.
     * @param props - `{ rows, others, totalMib, emptyLabel }`.
     * @returns the list.
     */
    function ProcessList (props) {
      const rows = Array.isArray(props.rows) ? props.rows : []
      if (rows.length === 0) {
        return h('div', { className: 'qtm-roots-note' }, props.emptyLabel)
      }
      const largest = Math.max(...rows.map((row) => row.mib ?? 0), 1)
      const line = (key, label, mibValue, percent, host, title) => h('div', {
        key,
        className: 'qtm-proc-row',
        title,
      },
      h('span', { className: 'qtm-proc-name' }, label),
      host ? h('span', { className: 'qtm-proc-tag' }, t('monitor.hostTag')) : null,
      h('span', { className: 'qtm-proc-bar' },
        h('span', {
          className: 'qtm-proc-fill',
          style: { width: `${Math.max(2, Math.min(100, percent))}%` },
        })),
      h('span', { className: 'qtm-proc-size' }, mib(mibValue)),
      )
      return h('div', { className: 'qtm-procs' },
        rows.map((row) => {
          const roleKey = `monitor.role.${row.role}`
          const label = row.subType === null || row.subType === undefined
            ? t(roleKey)
            : `${t(roleKey)} · ${row.subType}`
          return line(
            row.pid,
            label,
            row.mib,
            ((row.mib ?? 0) / largest) * 100,
            row.host === true,
            t('monitor.pid', { pid: row.pid }),
          )
        }),
        props.others === null || props.others === undefined
          ? null
          : line(
              'others',
              t('monitor.othersRow', { count: props.others.count }),
              props.others.mib,
              ((props.others.mib ?? 0) / largest) * 100,
              false,
              undefined,
            ),
      )
    }

    /**
     * One figure: label, value, and an optional hint under it.
     * @param props - `{ label, value, hint, level, priority }`.
     * @returns the metric tile.
     */
    function Metric (props) {
      return h('div', { className: `qtm-metric${props.priority ? ' qtm-metric--lead' : ''}` },
        h('div', { className: 'qtm-metric-label' }, props.label),
        h('div', { className: `qtm-metric-value qtm-level--${props.level ?? 'idle'}` }, props.value),
        props.hint === undefined ? null : h('div', { className: 'qtm-metric-hint' }, props.hint),
      )
    }

    /**
     * A filled bar used for every bounded 0–100 figure.
     * @param props - `{ percent, level }`.
     * @returns the bar track.
     */
    function Bar (props) {
      const width = typeof props.percent === 'number' && Number.isFinite(props.percent)
        ? Math.max(0, Math.min(100, props.percent))
        : 0
      return h('div', { className: 'qtm-bar', role: 'presentation' },
        h('div', {
          className: `qtm-bar-fill qtm-fill--${props.level ?? 'idle'}`,
          style: { width: `${width}%` },
        }),
      )
    }

    /**
     * A single labelled bar row: name, bar, optional value.
     *
     * The same silhouette serves the machine-memory and volume bars, so the two
     * sections read identically at a glance.
     * @param props - `{ label, percent, level, value }`.
     * @returns the row.
     */
    function Gauge (props) {
      return h('div', { className: 'qtm-bars' },
        h('div', { className: 'qtm-bar-row' },
          h('span', { className: 'qtm-bar-name' }, props.label),
          h(Bar, { percent: props.percent, level: props.level }),
          props.value === undefined ? null : h('span', { className: 'qtm-bar-value' }, props.value),
        ),
      )
    }

    /**
     * The smallest trend ceiling, so an idle machine still shows shape.
     *
     * At 4%, a 1.2% sample fills about a third of the strip and a 3% spike is
     * visibly taller; below this the axis would amplify measurement noise into
     * what looks like load.
     */
    const TREND_MIN_CEILING = 4

    /**
     * Round a peak up to the next readable axis step.
     *
     * Steps are 4/10/20/40/100 rather than an exact maximum, so the axis only
     * moves when the data really exceeds it — a chart that rescaled on every
     * poll would make a steady load look like it was moving.
     * @param peak - the busiest sample, in percent.
     * @returns the ceiling to divide by.
     */
    function trendCeiling (peak) {
      const steps = [TREND_MIN_CEILING, 10, 20, 40, 100]
      for (const step of steps) if (peak <= step) return step
      return 100
    }

    /**
     * A column chart of recent samples.
     *
     * Drawn as plain elements rather than an SVG chart library: the whole point
     * is a glanceable strip, and a plugin must not pull a second copy of a chart
     * dependency into the page.
     *
     * The ceiling is adaptive with a floor. A fixed 100% ceiling makes an idle
     * machine — the normal case — a flat line of 2px stubs with no shape at
     * all, which is exactly the reading a monitor must not give: "nothing is
     * happening" and "the chart is squashed" look identical. So the axis tracks
     * the busiest sample, rounded up to a readable step, and never drops below
     * {@link TREND_MIN_CEILING}; the label beside the strip states the ceiling
     * so the height is never ambiguous.
     * @param props - `{ points, level, emptyLabel }`.
     * @returns the chart.
     */
    function Trend (props) {
      const points = Array.isArray(props.points) ? props.points : []
      const values = points.filter((value) => typeof value === 'number' && Number.isFinite(value))
      if (values.length === 0) {
        return h('div', { className: 'qtm-trend qtm-trend--empty' }, props.emptyLabel)
      }
      const ceiling = trendCeiling(Math.max(...values))
      return h('div', { className: 'qtm-trend' },
        points.map((value, index) => {
          const known = typeof value === 'number' && Number.isFinite(value)
          const height = known ? Math.max(2, Math.min(100, (value / ceiling) * 100)) : 0
          return h('div', {
            key: index,
            className: `qtm-trend-col${known ? '' : ' qtm-trend-col--gap'}`,
            title: known ? t('monitor.barTip', { value: value.toFixed(1) }) : '',
          }, known ? h('div', {
            className: `qtm-trend-bar qtm-fill--${props.level(value)}`,
            style: { height: `${height}%` },
          }) : null)
        }),
      )
    }

    /** Parse one `snapshot` response into panel state. */
    function monitorFromView (value) {
      const snapshot = value?.snapshot ?? null
      return {
        snapshot,
        history: Array.isArray(value?.history) ? value.history : [],
      }
    }

    /**
     * The 性能监控 panel.
     *
     * The same component serves both hosts: the centre column (wide, roomy) and
     * the right column's tab body (narrow). `compact` is passed by the right
     * column, which is often little over 300px wide, so the layout collapses to
     * one column and drops the intro rather than wrapping into an unreadable
     * ribbon.
     * @param props - `{ compact }`.
     * @returns the panel.
     */
    function MonitorPage (props) {
      const compact = props?.compact === true
      const [snapshot, setSnapshot] = useState(null)
      const [trend, setTrend] = useState([])
      const [live, setLive] = useState(true)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [rescanning, setRescanning] = useState(false)
      const [notice, setNotice] = useState(null)
      const mounted = useRef(true)
      /** Newest sample timestamp already folded into the trend. */
      const cursor = useRef(0)

      useSyncExternalStore(subscribeRevision, () => revision, () => revision)

      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
      }, [])

      /**
       * Fetch one sample and fold its unread history into the trend.
       * @param options - `{ rescan }` to re-measure storage instead.
       */
      const pull = useCallback(async (options) => {
        if (options?.rescan === true) {
          // The Host awaits the walk on this path, so the busy state covers the
          // real work instead of guessing at it with a timer.
          try {
            const result = await callHost(MONITOR_API, 'refreshStorage')
            if (!mounted.current) return
            setSnapshot((current) => (current === null ? current : { ...current, disk: result.disk }))
            setNotice(null)
          } catch (error) {
            if (!mounted.current) return
            setNotice({ kind: 'error', text: String(error?.message ?? error) })
          }
          return
        }
        try {
          const value = await callHost(MONITOR_API, 'snapshot', { since: cursor.current })
          if (!mounted.current) return
          const next = monitorFromView(value)
          if (next.snapshot !== null) {
            setSnapshot(next.snapshot)
            cursor.current = next.snapshot.at
          }
          if (next.history.length > 0) {
            setTrend((current) => {
              const merged = [...current, ...next.history.map((row) => row.cpu)]
              return merged.length > TREND_POINTS ? merged.slice(merged.length - TREND_POINTS) : merged
            })
          }
          setNotice(null)
        } catch (error) {
          if (!mounted.current) return
          setNotice({ kind: 'error', text: String(error?.message ?? error) || t('common.offline') })
        } finally {
          if (mounted.current) setLoading(false)
        }
      }, [])

      // One timer for the whole panel: mounted, it polls; paused, it stops. The
      // Host samples on demand, so a hidden panel costs nothing.
      useEffect(() => {
        if (!live) return undefined
        let cancelled = false
        let timer
        const tick = async () => {
          await pull()
          if (!cancelled) timer = window.setTimeout(tick, MONITOR_POLL_MS)
        }
        void tick()
        return () => {
          cancelled = true
          window.clearTimeout(timer)
        }
      }, [live, pull])

      /**
       * Manual refresh.
       *
       * The polled path serves a five-second cache for the OS process table,
       * which is right for a background chart but wrong when the user presses
       * the button: they are asking for the numbers NOW. This awaits a fresh
       * read before pulling the snapshot.
       */
      const refreshNow = useCallback(() => {
        if (busy) return
        setBusy(true)
        void callHost(MONITOR_API, 'refreshProcesses')
          .catch(() => undefined)
          .then(() => pull())
          .finally(() => {
            if (mounted.current) setBusy(false)
          })
      }, [busy, pull])

      const rescan = useCallback(() => {
        if (busy || rescanning) return
        setBusy(true)
        setRescanning(true)
        void pull({ rescan: true }).finally(() => {
          if (!mounted.current) return
          setBusy(false)
          setRescanning(false)
        })
      }, [busy, rescanning, pull])

      if (loading && snapshot === null) {
        return h(Page, { title: t('monitor.title'), compact, surface: compact ? undefined : 'panel' },
          h('div', { className: 'qtt-hint' }, t('monitor.loading')))
      }

      if (snapshot === null) {
        return h(OfflinePage, {
          title: t('monitor.title'),
          intro: compact ? undefined : t('monitor.intro'),
          text: notice === null ? t('common.offline') : notice.text,
          busy,
          onRetry: refreshNow,
          compact,
          surface: compact ? undefined : 'panel',
        })
      }

      const cpu = snapshot.cpu
      const memory = snapshot.memory ?? {}
      const machine = memory.machine ?? {}
      const disk = snapshot.disk ?? {}
      const tree = disk.tree ?? null
      const volume = disk.volume ?? null
      const loop = snapshot.loop
      const runtime = snapshot.runtime ?? {}
      /** Whole-application memory, as the OS task manager reports it. */
      const app = memory.app ?? {}
      /**
       * Whether the Host actually provided the aggregate.
       *
       * `memory.app` is absent when the Host half predates it — a Host-side
       * change needs a restart, while this Client file hot-reloads. Falling
       * through to the generic "loading" copy in that case produced a spinner
       * that never resolved, which reads as "still working" when the truth is
       * "this Host cannot answer". The distinction is reported instead.
       */
      const appProvided = memory.app !== undefined && memory.app !== null
      const systemLevel = level(cpu?.system?.percent)
      // A process eating a quarter of the machine is already worth noticing;
      // per-core 100% would be a 1/2^N fraction of the whole, so the thresholds
      // are the machine-wide share, not the per-core figure.
      const processLevel = level(cpu?.process?.percentOfMachine, 25, 60)
      const machineLevel = level(machine.usedPercent)
      // The app's share of the whole machine is the actionable number, so it
      // uses the same 70/90 bands as every other bounded percentage here.
      const appLevel = app.supported === false
        ? 'idle'
        : level(
            typeof app.mib === 'number' && machine.totalBytes > 0
              ? (app.mib / (machine.totalBytes / (1024 * 1024))) * 100
              : null,
          )
      const volumeLevel = level(disk.volumeUsedPercent, 80, 90)
      const loopLevel = loop === null || loop === undefined
        ? 'idle'
        : loop.p99 >= 100 ? 'bad' : loop.p99 >= 30 ? 'warn' : 'ok'

      return h(Page, {
        title: t('monitor.title'),
        intro: compact ? undefined : t('monitor.intro'),
        compact,
        surface: compact ? undefined : 'panel',
      },
        h('div', { className: 'qtm-toolbar' },
          h('span', { className: `qtm-pill qtm-pill--${live ? 'live' : 'paused'}` },
            live ? t('monitor.live') : t('monitor.paused')),
          h('span', { className: 'qtm-updated' }, t('monitor.updated', { time: clock(snapshot.at) })),
          h('div', { className: 'qtt-actions' },
            h('button', {
              type: 'button',
              className: 'qtt-btn qtt-btn--ghost',
              disabled: busy,
              onClick: refreshNow,
            }, t('monitor.refresh')),
            h('button', {
              type: 'button',
              className: 'qtt-btn',
              disabled: busy || rescanning,
              onClick: rescan,
            }, rescanning ? t('monitor.rescanning') : t('monitor.rescan')),
            h('button', {
              type: 'button',
              className: 'qtt-btn',
              onClick: () => setLive((current) => !current),
            }, live ? t('monitor.pause') : t('monitor.resume')),
          ),
        ),
        Notice(notice),

        h(Section, {
          title: t('monitor.section.cpu'),
          note: cpu === null || cpu === undefined
            ? t('monitor.waiting')
            : t('monitor.window', { ms: cpu.windowMs }),
        },
          h(Metrics, null,
            h(Metric, {
              label: t('monitor.system'),
              value: cpu === null || cpu === undefined ? t('monitor.waiting') : pct(cpu.system.percent),
              hint: t('monitor.systemHint'),
              level: systemLevel,
              priority: true,
            }),
            h(Metric, {
              label: t('monitor.process'),
              value: cpu === null || cpu === undefined ? t('monitor.waiting') : pct(cpu.process.percentOfCore, 1),
              hint: cpu === null || cpu === undefined
                ? undefined
                : t('monitor.processHint', { share: pct(cpu.process.percentOfMachine, 2) }),
              level: processLevel,
            }),
            h(Metric, {
              label: t('monitor.cores', { count: cpu === null || cpu === undefined ? '—' : cpu.cores }),
              value: cpu === null || cpu === undefined ? '—' : String(cpu.cores),
              hint: typeof cpu?.model === 'string' && cpu.model !== '' ? cpu.model : undefined,
              level: 'idle',
            }),
            h(Metric, {
              label: t('monitor.load'),
              value: runtime.load === null || runtime.load === undefined
                ? t('monitor.unavailable')
                : `${runtime.load.one.toFixed(2)} / ${runtime.load.five.toFixed(2)} / ${runtime.load.fifteen.toFixed(2)}`,
              hint: t('monitor.loadHint'),
              level: 'idle',
            }),
          ),
          h('div', { className: 'qtm-trend-wrap' },
            h('div', { className: 'qtm-trend-label' },
              h('span', null, t('monitor.trend', { count: trend.length })),
              h('span', { className: 'qtm-trend-scale' }, t('monitor.trendScale', {
                ceiling: pct(trendCeiling(Math.max(...trend.filter((value) => typeof value === 'number' && Number.isFinite(value)), 0)), 0),
              }))),
            h(Trend, {
              points: trend,
              level: (value) => level(value),
              emptyLabel: t('monitor.trendEmpty'),
            }),
          ),
        ),

        h(Section, { title: t('monitor.section.memory') },
          h(Metrics, null,
            h(Metric, {
              // The whole application leads, because that is the figure a user
              // compares against the OS task manager. The host's own RSS beside
              // it explains where the rest goes instead of contradicting it.
              label: t('monitor.app'),
              value: !appProvided || app.supported === false
                ? t('monitor.unavailable')
                : app.mib === null || app.mib === undefined
                  // A failed query must not read as "still working on it": the
                  // spinner would never resolve, so the failure says so.
                  ? app.failed ? t('monitor.unavailable') : t('monitor.waiting')
                  : mib(app.mib),
              hint: !appProvided
                ? t('monitor.appReload')
                : app.supported === false
                  ? t('monitor.appUnsupported')
                  : app.failed
                    ? t('monitor.appFailed')
                    : app.processCount === null || app.processCount === undefined
                      ? undefined
                  : t('monitor.appHint', { count: app.processCount }),
              level: appLevel,
              priority: true,
            }),
            h(Metric, {
              label: t('monitor.rss'),
              value: mib(memory.rssMib),
              hint: app.hostSharePercent === null || app.hostSharePercent === undefined
                ? t('monitor.heapUsed', { used: mib(memory.heapUsedMib), total: mib(memory.heapTotalMib) })
                : t('monitor.rssHint', { share: pct(app.hostSharePercent) }),
              level: 'idle',
            }),
            h(Metric, {
              label: t('monitor.heap'),
              value: mib(memory.heapUsedMib),
              hint: mib(memory.heapTotalMib),
              level: 'idle',
            }),
            h(Metric, {
              label: t('monitor.external'),
              value: mib(memory.externalMib),
              level: 'idle',
            }),
            h(Metric, {
              label: t('monitor.machine'),
              value: pct(machine.usedPercent),
              hint: t('monitor.machineHint', {
                used: mib(typeof machine.usedBytes === 'number' ? machine.usedBytes / (1024 * 1024) : null),
                total: mib(typeof machine.totalBytes === 'number' ? machine.totalBytes / (1024 * 1024) : null),
              }),
              level: machineLevel,
            }),
          ),
          h(Gauge, { label: t('monitor.machine'), percent: machine.usedPercent, level: machineLevel, value: pct(machine.usedPercent) }),
          // The total answers "how much"; the breakdown answers "what is using
          // it", which is the question a user asks next.
          !appProvided || app.supported === false || (app.processes ?? []).length === 0
            ? null
            : h('div', { className: 'qtm-roots' },
                h('div', { className: 'qtm-roots-caption' }, t('monitor.processes')),
                h(ProcessList, {
                  rows: app.processes,
                  others: app.others ?? null,
                  emptyLabel: t('monitor.processesEmpty'),
                })),
        ),

        h(Section, {
          title: t('monitor.section.disk'),
          note: disk.volumePath === undefined ? undefined : disk.volumePath,
        },
          h(Metrics, null,
            h(Metric, {
              label: t('monitor.volume', { path: disk.volumePath ?? '—' }),
              value: pct(disk.volumeUsedPercent),
              hint: volume === null || volume === undefined
                ? undefined
                : t('monitor.volumeHint', {
                    free: mib(volume.availableBytes / (1024 * 1024)),
                    total: mib(volume.totalBytes / (1024 * 1024)),
                  }),
              level: volumeLevel,
              priority: true,
            }),
            h(Metric, {
              label: t('monitor.tree'),
              value: tree === null ? t('monitor.waiting') : mib(tree.mib),
              hint: tree === null
                ? undefined
                : t('monitor.treeHint', { files: tree.files, dirs: tree.dirs }),
              level: 'idle',
            }),
          ),
          h(Gauge, {
            label: disk.volumePath ?? '—',
            percent: disk.volumeUsedPercent,
            level: volumeLevel,
            value: pct(disk.volumeUsedPercent),
          }),
          tree === null || tree.roots.length === 0
            ? null
            : h('div', { className: 'qtm-roots' },
                disk.stale ? h('div', { className: 'qtm-roots-note' }, t('monitor.treeStale')) : null,
                tree.roots
                  .filter((row) => row.bytes > 0)
                  .slice(0, 8)
                  .map((row) => h('div', { key: row.name, className: 'qtm-root-row' },
                    h('span', { className: 'qtm-root-name', title: row.name }, row.name),
                    h('span', { className: `qtm-root-kind qtm-root-kind--${row.kind}` },
                      t(`monitor.treeKind.${row.kind}`)),
                    h(Bar, { percent: tree.bytes > 0 ? (row.bytes / tree.bytes) * 100 : 0, level: 'ok' }),
                    h('span', { className: 'qtm-root-size' }, mib(row.mib)),
                  )),
              ),
        ),

        h(Section, {
          title: t('monitor.section.health'),
          note: loop === null || loop === undefined
            ? t('monitor.waiting')
            : loopLevel === 'bad'
              ? t('monitor.eventLoopBad')
              : loopLevel === 'warn' ? t('monitor.eventLoopWarn') : t('monitor.eventLoopOk'),
        },
          h(Metrics, null,
            h(Metric, {
              label: t('monitor.eventLoop'),
              value: loop === null || loop === undefined ? t('monitor.waiting') : `${loop.p99.toFixed(0)} ms`,
              hint: loop === null || loop === undefined
                ? undefined
                : t('monitor.eventLoopHint', { p99: loop.p99.toFixed(1), max: loop.max.toFixed(1) }),
              level: loopLevel,
              priority: true,
            }),
            h(Metric, {
              label: t('monitor.uptime'),
              value: duration(runtime.uptimeSeconds),
              hint: t('monitor.pid', { pid: runtime.pid ?? '—' }),
              level: 'idle',
            }),
            h(Metric, {
              label: 'Node',
              value: runtime.nodeVersion ?? '—',
              hint: `${runtime.platform ?? ''} ${runtime.arch ?? ''}`.trim(),
              level: 'idle',
            }),
          ),
        ),

        h('div', { className: 'qtt-foot' },
          h('span', { className: 'qtt-foot-label' }, t('monitor.tree')),
          h('code', { className: 'qtt-path' }, tree === null ? '…' : tree.home),
        ),
      )
    }

    /**
     * The right column's tab body.
     *
     * The column hands the registered component the tab's own props; the panel
     * ignores them and asks for its compact layout, since this seat is always
     * the narrow one.
     * @returns the panel.
     */
    function MonitorTabBody () {
      return h(MonitorPage, { compact: true })
    }

    // ── Styles ─────────────────────────────────────────────────────────────
    /**
     * Both pages share one stylesheet: they are small, they use the same
     * tokens, and a single <style> tag per plugin keeps the head clean. The
     * `qtm-` prefix marks monitor rules.
     *
     * Only `--dsw-alias-*` tokens are referenced, so light/dark switching and
     * future token renames degrade appearance rather than break the page.
     */
    const CSS = `
/* Shared block; each host adds the geometry it needs below. */
.qtt-page{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);min-width:0}
.qtt-page-title{margin:0;font-size:16px;font-weight:600;line-height:24px}
.qtt-page-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);max-width:76ch}

/* Main-slot occupant: claims the centre column and scrolls its own body, the
   way the shipped Schedules page does. The column is already flex:1 with
   overflow:hidden, so a page that does not claim the height would leave the
   frame's background showing below its last card. */
.qtt-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.qtt-page--panel{width:100%;box-sizing:border-box;padding:0 clamp(24px,4vw,48px) 48px}
.qtt-page--panel .qtt-page-title{margin:28px 0 0;font-size:20px;font-weight:500;line-height:28px}
[data-platform=darwin] .qtt-page--panel .qtt-page-title{margin-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.qtt-page--panel .qtt-page-intro{margin:-4px 0 0}

/* Right column tab body: the same panel in a fraction of the width. */
.qtt-page--compact{gap:10px;font-size:13px;width:100%;box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:12px 12px 24px;scrollbar-gutter:stable}
.qtt-page--compact .qtt-page-title{margin:0;font-size:15px;line-height:22px}
.qtt-page--compact .qtt-foot{position:static}
.qtt-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.qtt-master{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.qtt-master-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.qtt-master-title{font-size:13px;font-weight:600;line-height:18px}
.qtt-master-hint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.qtt-switch{position:relative;display:inline-flex;align-items:center;width:30px;height:18px;padding:0;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .15s ease,border-color .15s ease}
.qtt-switch:disabled{opacity:.5;cursor:default}
.qtt-switch--on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.qtt-switch-knob{position:absolute;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s ease,background .15s ease}
.qtt-switch--on .qtt-switch-knob{transform:translateX(12px);background:var(--dsw-alias-bg-base)}
.qtt-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.qtt-section-title{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:600}
.qtt-count{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.qtt-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.qtt-badge{align-self:flex-start;font-size:11px;line-height:16px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-state-warn-primary);font-weight:400}
.qtt-notice{font-size:12px;line-height:16px;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);word-break:break-word}
.qtt-notice--ok{color:var(--dsw-alias-state-success-primary)}
.qtt-notice--error{color:var(--dsw-alias-state-error-primary)}
.qtt-list{display:flex;flex-direction:column;gap:8px}
.qtt-row{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.qtt-row--off{opacity:.72}
.qtt-row--confirm{flex-direction:row;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-color:var(--dsw-alias-state-error-primary)}
.qtt-confirm-text{font-size:13px;line-height:19px}
.qtt-confirm-actions{display:flex;align-items:center;gap:6px;flex:none}
.qtt-row-head{display:flex;align-items:center;gap:8px;min-width:0}
.qtt-row-name{font-size:13px;font-weight:600;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}
.qtt-row-count{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);flex:none}
.qtt-row-actions{display:flex;align-items:center;gap:2px;flex:none}
.qtt-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:1px solid transparent;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.qtt-icon-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.qtt-icon-btn:disabled{opacity:.35;cursor:default}
.qtt-icon-btn--danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.qtt-input,.qtt-textarea{width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:19px}
.qtt-input::placeholder,.qtt-textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.qtt-input:focus-visible,.qtt-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.qtt-input:disabled,.qtt-textarea:disabled{opacity:.6}
.qtt-textarea{resize:vertical;min-height:64px;font-family:inherit;white-space:pre-wrap}
.qtt-empty{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);padding:16px 4px}
.qtt-empty-limits{font-size:11px;line-height:16px}
.qtt-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.qtt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.qtt-btn:disabled{opacity:.45;cursor:default}
.qtt-btn--ghost{background:transparent;border-color:transparent}
.qtt-btn--primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500}
.qtt-btn--primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);filter:brightness(1.08)}
.qtt-btn--danger{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);font-weight:500}
.qtt-btn--danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);filter:brightness(1.08)}
.qtt-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.qtt-foot-label{flex:none}
.qtt-foot-count{margin-left:auto;flex:none}
.qtt-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;word-break:break-all;color:var(--dsw-alias-label-secondary)}
/* ── Monitor panel ── */
.qtm-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.qtm-toolbar .qtt-actions{margin-left:auto}
.qtm-pill{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:11px;line-height:16px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.qtm-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.qtm-pill--live{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.qtm-pill--live::before{animation:qtm-pulse 2s ease-in-out infinite}
.qtm-pill--paused{color:var(--dsw-alias-state-idle-primary)}
@keyframes qtm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.qtm-pill--live::before{animation:none}}
.qtm-updated{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qtm-section{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.qtm-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.qtm-section-title{margin:0;font-size:13px;font-weight:600;line-height:18px}
.qtm-section-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.qtm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.qtt-page--compact .qtm-metrics{grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.qtt-page--compact .qtm-metric{padding:7px 9px}
.qtt-page--compact .qtm-metric-value{font-size:17px;line-height:23px}
.qtt-page--compact .qtm-section{padding:10px 11px;gap:8px}
.qtt-page--compact .qtm-toolbar{gap:8px}
.qtt-page--compact .qtm-toolbar .qtt-actions{margin-left:0;width:100%}
.qtt-page--compact .qtm-root-name{flex-basis:72px}
.qtt-page--compact .qtm-trend{height:38px}
.qtm-metric{display:flex;flex-direction:column;gap:3px;min-width:0;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2)}
.qtm-metric--lead{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}
.qtm-metric-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qtm-metric-value{font-size:19px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums}
.qtm-metric-hint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.qtm-level--ok{color:var(--dsw-alias-state-success-primary)}
.qtm-level--warn{color:var(--dsw-alias-state-warn-primary)}
.qtm-level--bad{color:var(--dsw-alias-state-error-primary)}
.qtm-level--idle{color:var(--dsw-alias-label-primary)}
.qtm-bar{position:relative;flex:1 1 auto;min-width:40px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.qtm-bar-fill{height:100%;border-radius:3px;transition:width .3s ease}
.qtm-fill--ok{background:var(--dsw-alias-state-success-primary)}
.qtm-fill--warn{background:var(--dsw-alias-state-warn-primary)}
.qtm-fill--bad{background:var(--dsw-alias-state-error-primary)}
.qtm-fill--idle{background:var(--dsw-alias-state-idle-primary)}
.qtm-bars{display:flex;flex-direction:column;gap:6px}
.qtm-bar-row{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qtm-bar-name{flex:0 0 auto;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qtm-bar-value{flex:none;font-variant-numeric:tabular-nums}
.qtm-trend-wrap{display:flex;flex-direction:column;gap:4px}
.qtm-trend-label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qtm-trend-scale{font-variant-numeric:tabular-nums}
.qtm-trend{display:flex;align-items:flex-end;gap:1px;height:48px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.qtm-trend--empty{display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qtm-trend-col{flex:1 1 0;min-width:1px;height:100%;display:flex;align-items:flex-end}
.qtm-trend-col--gap{opacity:0}
.qtm-trend-bar{width:100%;border-radius:1px;min-height:2px;opacity:.85}
.qtm-roots{display:flex;flex-direction:column;gap:5px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1)}
.qtm-roots-note{font-size:11px;line-height:15px;color:var(--dsw-alias-state-warn-primary)}
.qtm-root-row{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qtm-root-name{flex:0 0 96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary)}
.qtm-root-kind{flex:none;font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1)}
.qtm-root-kind--install{color:var(--dsw-alias-label-secondary)}
.qtm-root-kind--data{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.qtm-root-size{flex:0 0 62px;text-align:right;font-variant-numeric:tabular-nums}
.qtm-roots-caption{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-weight:600}
.qtm-procs{display:flex;flex-direction:column;gap:4px}
.qtm-proc-row{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qtm-proc-name{flex:0 0 112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.qtm-proc-tag{flex:none;font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary)}
.qtm-proc-bar{flex:1 1 auto;min-width:40px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:block}
.qtm-proc-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary);opacity:.75;transition:width .3s ease}
.qtm-proc-size{flex:0 0 62px;text-align:right;font-variant-numeric:tabular-nums}
`

    /** One style tag for the whole plugin, removed with the client run. */
    function mountStyles () {
      if (typeof document === 'undefined') return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-qtc-taste'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /**
     * Every settings page this plugin contributes, in nav order.
     *
     * `id` addresses both the section and its icon (the shell matches them by
     * id); `label` is a thunk so the nav row follows the active locale without
     * re-registering.
     */
    const PAGES = [
      { id: 'dsh-qtc-taste', order: 25, label: 'taste.label', component: TastePage, icon: TasteIcon },
    ]

    // ── Sidebar panel ──────────────────────────────────────────────────────
    /**
     * The 性能监控 navigation glyph: a gauge needle on a dial.
     *
     * Drawn to the same contract as {@link TasteIcon} — 16-unit box, no fill,
     * `currentColor`, 1.3 stroke, round joins — and sized so its ink spans about
     * 11 of the 16 units, matching the shipped panel icons at 16px.
     * @param props - `{ size, active }` from the sidebar panel row.
     * @returns the inline SVG.
     */
    function MonitorIcon (props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      // Dial: the upper three-quarter arc of a circle.
      h('path', { d: 'M2.95 11.55a6.1 6.1 0 1 1 10.1 0' }),
      // Ticks at the two ends of the sweep.
      h('path', { d: 'M2.2 9.1l1.28.36' }),
      h('path', { d: 'M13.8 9.1l-1.28.36' }),
      // Needle, resting toward the upper right.
      h('path', { d: 'M8 9.9l2.75-2.4' }),
      // Hub.
      h('path', { d: 'M8 10.05h0' }),
      )
    }

    /**
     * Every sidebar panel this plugin contributes, in sidebar order.
     *
     * `id` is the main-panel key as well: the shell renders the `main`
     * occupant whose key equals the panel id it just selected, so both
     * registrations must carry the same id. `label` is a thunk so the row
     * follows the active locale.
     */
    const PANELS = [
      { id: 'qtc-monitor', order: 30, label: 'monitor.label', component: MonitorPage, icon: MonitorIcon },
    ]

    // ── Right sidebar tab ──────────────────────────────────────────────────
    /**
     * The right column's tab type.
     *
     * The right sidebar is a tab host: its "开始" list is not a slot a plugin
     * paints into, it is the set of registered tab TYPES, each contributing one
     * `guide` entry (that is how 文件 / 浏览器 / 新建终端 get there). So the
     * monitor appears in that list by registering a type of its own and giving
     * it a guide entry — not by adding another `sidebar.panellist` row.
     *
     * `kind` is the key the column dispatches on when the user picks the entry,
     * and it must match the `sidebar.right.pane.tab` key below. `multiple: true`
     * is what 新建终端 uses; the monitor is a singleton view, so it stays at the
     * default and the column reuses one tab instead of stacking duplicates.
     */
    const RIGHT_TAB_KIND = 'qtc-monitor'
    const RIGHT_TAB_ID = 'dsh-qtc-taste/monitor'

    /**
     * The right-sidebar entry icon: the same gauge, drawn at guide scale.
     *
     * The guide hands this component a larger `size` (22–26px) than the
     * sidebar row does, so it is the same artwork with a slightly heavier
     * stroke to hold its weight at that size.
     * @param props - `{ size }` from the guide capsule.
     * @returns the inline SVG.
     */
    function MonitorGuideIcon (props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 22
      return h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', { d: 'M4.4 17.3a9.2 9.2 0 1 1 15.2 0' }),
      h('path', { d: 'M3.3 13.6l1.9.55' }),
      h('path', { d: 'M20.7 13.6l-1.9.55' }),
      h('path', { d: 'M12 14.9l4.1-3.6' }),
      h('path', { d: 'M12 15.1h0' }),
      )
    }

    /**
     * The right column's tab title chip.
     *
     * The chip keeps its plain label even if the panel body fails to load, so a
     * closed or crashed body never leaves an unnamed tab behind.
     * @returns the chip text.
     */
    function MonitorTabTitle () {
      useSyncExternalStore(subscribeRevision, () => revision, () => revision)
      return h('span', null, t('monitor.label'))
    }

    return {
      inject: ['slots', 'locale'],
      apply (ctx) {
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'zh', zh),
            ctx.locale.register(NS, 'en', en),
          ]
          return () => { for (const dispose of disposers) dispose() }
        }, 'dsh-qtc-taste: dictionaries')

        translate = ctx.locale.bind(NS)
        // A locale change swaps the bound dictionary; pages re-render off this
        // counter rather than staying in the previous language.
        ctx.effect(() => ctx.locale.subscribe(bumpRevision), 'dsh-qtc-taste: locale')
        ctx.effect(mountStyles, 'dsh-qtc-taste: styles')

        for (const page of PAGES) {
          ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: page.id,
            order: page.order,
            locale: NS,
          }, page.icon))

          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: page.id,
            order: page.order,
            label: () => t(page.label),
            locale: NS,
          }, page.component))
        }

        for (const panel of PANELS) {
          // The sidebar owns the button and resolves its caption from this
          // registration's label; the icon receives `{ size, active }`.
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: panel.id,
            order: panel.order,
            label: () => t(panel.label),
            locale: NS,
          }, panel.icon))

          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: panel.id,
            locale: NS,
          }, panel.component))
        }

        // ── Right sidebar tab ──
        // The registry is optional: a profile without the right column simply
        // has no tab host, and the left-column panel above still works.
        ctx.inject(['sidebarRightTabs'], (rctx) => {
          const tabs = rctx.sidebarRightTabs
          if (tabs === undefined) return

          rctx.effect(() => tabs.register({
            id: RIGHT_TAB_ID,
            kind: RIGHT_TAB_KIND,
            priority: 'builtin',
            title: () => t('monitor.label'),
            guide: [{
              id: 'open',
              order: 35,
              title: () => t('monitor.label'),
              description: () => t('monitor.guideDescription'),
              icon: MonitorGuideIcon,
            }],
          }), 'dsh-qtc-taste: right tab type')

          // The body and the chip are keyed by the registered type id, which is
          // how the column dispatches a tab to this plugin's component.
          rctx.slots.inject('sidebar.right.pane.tab', () => rctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: RIGHT_TAB_ID,
            locale: NS,
          }, MonitorTabBody))

          rctx.slots.inject('sidebar.right.pane.tab.title', () => rctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: RIGHT_TAB_ID,
          }, MonitorTabTitle))
        })
      },
    }
  },
})
