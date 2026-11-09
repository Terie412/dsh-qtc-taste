/**
 * dsh-qtc-taste — Client half.
 *
 * One Settings page per feature, plus the shared controls they draw with:
 *
 * | Page | What it edits |
 * |---|---|
 * | 个性化 | user-authored blocks injected into the system prompt |
 *
 * A feature contributes a `settings.section` registration and a matching
 * `settings.section.icon`; their ids must match or the shell keeps its default
 * gear. Adding a feature means writing one page function and one entry in
 * {@link PAGES} — the shared primitives below already cover its chrome.
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

    /** Page scaffolding: title, intro, body. */
    function Page (props) {
      return h('div', { className: 'qtt-page' },
        h('h2', { className: 'qtt-page-title' }, props.title),
        props.intro === undefined ? null : h('p', { className: 'qtt-page-intro' }, props.intro),
        props.children,
      )
    }

    /**
     * Shared "cannot load" state: editing an unread document would overwrite
     * data the page never saw, so it offers a retry instead of the editor.
     * @param props - `{ title, intro, text, busy, onRetry }`.
     * @returns the fallback page.
     */
    function OfflinePage (props) {
      return h(Page, { title: props.title, intro: props.intro },
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

    // ── Styles ─────────────────────────────────────────────────────────────
    const CSS = `
.qtt-page{display:flex;flex-direction:column;gap:12px;padding:4px 2px;color:var(--dsw-alias-label-primary);max-width:820px}
.qtt-page-title{margin:0;font-size:16px;font-weight:600;line-height:24px}
.qtt-page-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
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
      },
    }
  },
})
