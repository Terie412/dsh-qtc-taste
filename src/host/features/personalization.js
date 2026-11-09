/**
 * Feature: personal prompt blocks (「个性化」).
 *
 * A user-authored block list injected into the system prompt of every agent
 * step. This module owns its own document (`taste.json`), its own prompt
 * section, and its own route; the shell only calls `register`.
 *
 * Two design points are load-bearing:
 *
 * - The section text is a FUNCTION, so each assembly reads the current document
 *   and a saved edit reaches the next model step without a restart.
 * - The section declares `interpolate: false`, because user text may contain
 *   `{{…}}` and must never be treated as a prompt variable — one stray brace
 *   would otherwise fail prompt assembly for every step.
 *
 * @module dsh-qtc-taste/host/features/personalization
 */
import {
  clip,
  documentPath,
  quarantine,
  readDocument,
  registerFeatureRoute,
  routeError,
  writeDocument,
} from '../storage.js'

/** Route the settings page posts to. */
const API_PATH = '/qtc-taste/api'

/** Prompt section name; unique to this feature. */
const SECTION_NAME = 'dsh-qtc-taste:personalization'

/**
 * Section order. The assembled prompt is ordered ascending: tool guidance ends
 * around 3100, deliverable references sit at 9000, structured output at 9900,
 * and the deployment persona suffix closes the prompt at 10200. A personal
 * preference block belongs just before that closing suffix.
 */
const SECTION_ORDER = 9800

/** Guards so one malformed document cannot make every model step enormous. */
const MAX_BLOCKS = 50
const MAX_TEXT = 20000
const MAX_TITLE = 120
const MAX_TOTAL = 120000

/**
 * @typedef {{ id: string, title: string, text: string, enabled: boolean }} TasteBlock
 * @typedef {{ version: number, enabled: boolean, blocks: TasteBlock[] }} TasteDocument
 */

/** @returns a fresh empty document. */
function emptyDocument () {
  return { version: 1, enabled: true, blocks: [] }
}

/** Monotonic suffix so ids stay unique even within one millisecond. */
let idCounter = 0

/**
 * Build a stable, filesystem-safe block id.
 * @returns the id.
 */
function newId () {
  idCounter += 1
  return `blk-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

/**
 * Coerce any parsed value into a valid document.
 *
 * Unknown fields are dropped and every string is bounded, so a hand-edited or
 * older document can never crash assembly or bloat the prompt.
 * @param raw - parsed JSON (or anything else).
 * @returns a valid document.
 */
export function normalize (raw) {
  const doc = emptyDocument()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return doc
  doc.enabled = raw.enabled !== false
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : []
  const seen = new Set()
  let total = 0
  for (const entry of blocks) {
    if (doc.blocks.length >= MAX_BLOCKS) break
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const text = clip(entry.text, MAX_TEXT)
    if (total + text.length > MAX_TOTAL) break
    total += text.length
    let id = clip(entry.id, 64)
    if (id === '' || seen.has(id)) id = newId()
    seen.add(id)
    doc.blocks.push({
      id,
      title: clip(entry.title, MAX_TITLE),
      text,
      enabled: entry.enabled !== false,
    })
  }
  return doc
}

/**
 * Render the injected prompt section from one document.
 *
 * An empty string means "contribute nothing": the section stays registered (so
 * the prompt registry never churns) while adding no text.
 * @param doc - the current document.
 * @returns the section text.
 */
export function renderSection (doc) {
  if (doc === undefined || doc.enabled !== true) return ''
  const active = doc.blocks.filter((block) => block.enabled === true && block.text.trim() !== '')
  if (active.length === 0) return ''
  const lines = [
    '## Personal preferences',
    '',
    'The user maintains the following personal preferences for their harness. Apply them alongside the rest of this prompt. When a preference conflicts with a higher-priority instruction, a tool contract, or the facts of the task, the higher-priority requirement wins.',
  ]
  for (const block of active) {
    const title = block.title.trim()
    lines.push('', title === '' ? '### Preference' : `### ${title}`, '', block.text.trim())
  }
  return lines.join('\n')
}

/**
 * Register the personalization feature on one Host context.
 * @param ctx - Host plugin context.
 */
export function register (ctx) {
  const path = documentPath('taste')
  const loaded = readDocument(path, normalize, emptyDocument())
  if (loaded.source === 'malformed') quarantine(path)
  /** Last successfully read document; the fallback when a read fails. */
  let doc = loaded.value
  /** Last successful source (`default` / `file`). */
  let source = loaded.source === 'file' ? 'file' : 'default'

  /**
   * The document to inject right now.
   *
   * The file is re-read on every assembly. It is a few kilobytes and is read
   * once per model step — the same cadence as the assembly itself — so the cost
   * is negligible, and it makes ALL writers equivalent: this settings page, a
   * hand edit, a restored backup, or a sync tool. No cache stamp can then miss
   * an edit written within the same millisecond.
   *
   * A missing file clears the blocks (the user deleted it); an unreadable or
   * momentarily malformed one keeps the last good document instead of silently
   * dropping the user's preferences.
   * @returns the document to render.
   */
  function current () {
    const reread = readDocument(path, normalize, emptyDocument())
    if (reread.source === 'file') {
      doc = reread.value
      source = 'file'
    } else if (reread.source === 'default') {
      doc = reread.value
      source = 'default'
    }
    // 'unreadable' and 'malformed' keep the cached document.
    return doc
  }

  ctx.inject(['systemPrompt'], (sctx) => {
    sctx.effect(() => sctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: () => renderSection(current()),
      interpolate: false,
    }), 'dsh-qtc-taste: personalization section')
  })

  /** Snapshot returned to the page and used for every response. */
  const view = () => {
    const live = current()
    return {
      enabled: live.enabled,
      blocks: live.blocks.map((block) => ({ ...block })),
      path,
      source,
      sectionName: SECTION_NAME,
    }
  }

  registerFeatureRoute(ctx, API_PATH, 'dsh-qtc-taste: personalization API', {
    state: () => view(),
    save: (payload) => {
      const next = normalize({ enabled: payload?.enabled, blocks: payload?.blocks })
      const total = next.blocks.reduce((sum, block) => sum + block.text.length, 0)
      if (total > MAX_TOTAL) {
        throw routeError(400, 'too-large', 'personalization text is too large')
      }
      // Preserve a malformed document before overwriting it, so a broken file
      // the user was hand-editing stays recoverable.
      if (readDocument(path, normalize, emptyDocument()).source === 'malformed') quarantine(path)
      writeDocument(path, next)
      doc = next
      source = 'file'
      return view()
    },
  })
}
