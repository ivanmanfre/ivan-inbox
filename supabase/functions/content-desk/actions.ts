// The desk's hands. Every write goes through the same table write or RPC the
// app's own button uses, made with IVAN'S OWN session (the user JWT client), so
// the database applies exactly the checks it applies to a tap in the app:
// Every draft write goes through a desk SQL function (db/20261118m_content_desk_r6.sql) that first takes
// the publisher's locks (account, queue rows, draft), checks the authorized revision, then runs the app's write:
//   approve      -> desk_approve (approveDraft's UPDATE) / desk_keep -> cb39_verdict_set keep for a brain draft
//   date, undate -> desk_set_date -> operator_set_schedule_date('clientops', …)  (WhenEditor / Calendar)
//   pull         -> desk_pull -> content_next_pull(queue, slot_at, reason) (Next rows) / the calendar's Remove date
//   delete       -> desk_delete (reason stamp, delete, archive fallback); never a brain draft (Keep/Drop in Review)
//   redo         -> regenerateDraft (status generating + post-gen-v2 webhook)
//   photo_attach -> desk_set_photos -> operator_set_draft_photos('clientops', …)    (PictureRow)
//   draft_line   -> lm-curator-decide approve                    (Ideas approve, with ideaDecidable)
// Ideas, links and staged photos have no app insert path; they use the same row
// shapes the app's producers write (operator_outlier_use, content-radar), with
// the service role.
//
// SAFETY (Sol desk-backend r1):
// - an action names a draft by the EXACT handle the brief handed out AND the first
//   words of its first line (a strict prefix/containment match, min 3 words or 12 chars);
// - every write is first checked against Ivan's own message by a reasoned
//   authorization call (index.ts authorize); nothing here decides that;
// - a held action stores the target UUID + updated_at + first-line hash and is
//   re-planned at commit from that UUID only (planForTarget), never from a handle.

import type { Rendered, Draft } from './brief.ts'
import { warsaw, warsawDay } from './brief.ts'
import type { Act } from './parse.ts'
import { urlInMessage } from './unfurl.ts'
import { MAX_BRIEF_CHARS, MAX_TITLE_CHARS } from '../_shared/desk-t3.ts'
import { identify, words, type IdDraft } from './target.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type ActionEcho = {
  id: string
  kind: string
  label: string
  state: 'done' | 'held' | 'undone' | 'failed' | 'cancelled'
  undo: boolean
  hold_ms?: number
  detail?: string
  target?: { kind: 'draft'; handle: string; first_line: string }
  t3_job?: { id: string; status: string; title: string; link?: string | null }
}

export type Ctx = {
  userDb: Db        // createClient(url, anon, { global: { headers: { Authorization: Bearer <jwt> } } })
  svc: Db           // service role
  userId: string
  messageId: string
  brief: Rendered
  attachments: { kind: string; url: string; name?: string }[]
  text: string
  env: (k: string) => string | undefined
  fetchImpl?: typeof fetch
  t3?: (args: { title: string; brief: string }) => Promise<{ job_id: string; status: string; error?: string }>
  unfurl?: (url: string) => Promise<{ title?: string; description?: string; author?: string } | null>
  /** eval fixtures mode: only desk eval fixture drafts are candidates then */
  fixtures?: boolean
  /** list numbers the previous desk answer displayed -> draft id (its meta.shown_drafts) */
  shown?: Map<number, string> | null
}

export type Planned = {
  echo: Omit<ActionEcho, 'id'>
  // what to run now (done) or on commit (held); returns result + undo payload
  run?: () => Promise<{ result: unknown; undo?: Record<string, unknown> | null; detail?: string; t3_job?: ActionEcho['t3_job']; label?: string }>
  refuse?: string
  chips?: { label: string; send: string }[]
  /** the action in plain words, for the authorization check */
  describe?: string
  /** an explicit command Ivan can tap to ask for exactly this */
  command?: string
  target_id?: string
  /** the canonical arguments this kind's write consumes (canonArgs): the dedupe key and the journal (Sol r7 #2, #3) */
  canon?: Record<string, unknown>
  /** for the verifier: the resolved post's full live opener (Sol r7 #1, r8 #1) */
  context?: string
}

export const HOLD_MS = 8000
const POSTGEN = 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2'

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const short = (s: string, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** The ONE matcher (Sol r8 #1): the quoted words, normalized, appear whole anywhere in the first line. */
export function quoteIn(firstLine: string, quoted: unknown): boolean {
  if (typeof quoted !== 'string') return false
  const q = norm(quoted)
  return !!q && ` ${norm(firstLine)} `.includes(` ${q} `)
}

/** Long enough to single out a post: min 3 words or 12 chars. */
export function quoteLongEnough(quoted: unknown): boolean {
  const q = typeof quoted === 'string' ? norm(quoted) : ''
  return !!q && (q.split(' ').length >= 3 || q.length >= 12)
}

/** Strict: quoteIn and long enough. */
export function lineMatches(firstLine: string, quoted: unknown): boolean {
  return quoteLongEnough(quoted) && quoteIn(firstLine, quoted)
}

const normHandle = (h: unknown) => { const x = String(h ?? '').trim().toLowerCase(); return x ? (x.startsWith('#') ? x : '#' + x) : '' }

/** The Warsaw day a draft is on (published day for a published post), or 'undated'. */
export function dayOf(d: Draft): string {
  const at = d.status === 'published' ? (d.published_at ?? d.scheduled_at) : d.scheduled_at
  return at ? warsawDay(at) : 'undated'
}

/** The shortest opening of the draft's first line that matches no other draft in the brief (else the whole line). */
export function distinctExcerpt(d: Draft, all: Draft[]): string {
  const ws = d.first_line.split(/\s+/).filter(Boolean)
  for (let n = 3; n <= Math.min(ws.length, 24); n++) {
    const ex = ws.slice(0, n).join(' ')
    // unique under the identity rule itself: only this draft reaches the excerpt's full span
    const exw = words(ex)
    if (all.filter((o) => o.id !== d.id && sharedSpanOf(exw, o.first_line) >= exw.length).length === 0) return ex
  }
  return d.first_line
}
const sharedSpanOf = (exw: string[], line: string) => { const lw = ` ${words(line).join(' ')} `; return lw.includes(` ${exw.join(' ')} `) ? exw.length : 0 }

// the verb only: a chip carries draft identity and never a rejected argument (no time, no reason) (Sol r8 #3)
// short verbs: a chip's own boilerplate must never outweigh the excerpt in the span match (target.ts)
const VERB: Record<string, (ref: string) => string> = {
  approve: (r) => `approve ${r}`, delete: (r) => `delete ${r}`, redo: (r) => `redo ${r}`,
  date: (r) => `move ${r}`, undate: (r) => `undate ${r}`,
  pull: (r) => `pull ${r}`, photo_attach: (r) => `add photo to ${r}`,
}

/** One chip per candidate, built from draft identity only: a distinct opener excerpt plus its day. */
export function pickChips(act: Act, ds: Draft[], all: Draft[]): { label: string; send: string }[] {
  return ds.slice(0, 3).map((d) => {
    const day = dayOf(d)
    const ref = `"${distinctExcerpt(d, all)}" ${day === 'undated' ? '(no date)' : `(${day})`}`
    const send = (VERB[IN_ALIAS[act.kind] ?? act.kind] ?? ((r: string) => `${act.kind} ${r}`))(ref)
    return { label: send, send }
  })
}

// the statuses a kind can act on (or refuse with its own reason); only these drafts are candidates
const ELIGIBLE: Record<string, string[]> = {
  approve: ['review', 'error'], date: ['review', 'approved', 'scheduled'], undate: ['review', 'approved', 'scheduled'],
  pull: ['scheduled'], delete: ['review', 'error'], redo: ['review', 'error', 'approved', 'generating'],
  photo_attach: ['review', 'approved', 'scheduled'],
}
const UNFINISHED = new Set(['review', 'approved', 'error', 'generating'])

/**
 * Every live draft of Ivan's that this kind could act on, read FRESH (no brief cache, no cap of a few):
 * his lane, an eligible status, not published, in his Review when unfinished; dated for undate/pull.
 * Null when it cannot be read: nothing is resolved then.
 */
/**
 * Read every row of a query, page by page, in a stable order (Sol r9 #3). The exact count comes with
 * the first page; anything short of it, an error or a missing count = null (fail closed).
 */
// deno-lint-ignore no-explicit-any
export async function readAll(page: (from: number, to: number) => any, size = 1000): Promise<any[] | null> {
  const out: unknown[] = []
  let total: number | null = null
  for (let from = 0; from < 50_000; from += size) {
    const { data, error, count } = await page(from, from + size - 1)
    if (error || !Array.isArray(data)) return null
    if (total == null) { if (typeof count !== 'number') return null; total = count }
    out.push(...data)
    if (out.length >= total || data.length < size) break
  }
  return total != null && out.length === total ? out : null
}

export async function liveCandidates(ctx: Pick<Ctx, 'svc' | 'userDb' | 'fixtures'>, kind: string): Promise<Draft[] | null> {
  const statuses = ELIGIBLE[kind]
  if (!statuses) return []
  const data = await readAll((from, to) => ctx.svc.from('carousel_drafts')
    .select('id, status, type, scheduled_at, published_at, post_body, taxonomy, created_at, updated_at', { count: 'exact' })
    .is('client_id', null).is('published_at', null).in('status', statuses).order('id', { ascending: true }).range(from, to))
  if (!data) return null
  let visible: Set<string> | null = null
  if (ctx.userDb && data.some((r: { status: string }) => UNFINISHED.has(r.status))) {
    const vis = await readAll((from, to) => ctx.userDb.from('cb34_p2_safe_drafts').select('id', { count: 'exact' }).order('id', { ascending: true }).range(from, to))
    if (!vis) return null
    visible = new Set(vis.map((v: { id: string }) => v.id))
  }
  const out: Draft[] = []
  for (const r of data as { id: string; status: string; type: string; scheduled_at: string | null; published_at: string | null; post_body: string | null; taxonomy: unknown; created_at: string; updated_at: string }[]) {
    const tax = (r.taxonomy && typeof r.taxonomy === 'object' && !Array.isArray(r.taxonomy)) ? r.taxonomy as Record<string, unknown> : {}
    const fixture = !!tax.desk_eval_fixture
    if (fixture !== !!ctx.fixtures) continue   // fixtures mode: only eval fixtures; otherwise never a fixture
    if (!fixture && UNFINISHED.has(r.status) && visible && !visible.has(r.id)) continue
    if ((kind === 'undate' || kind === 'pull') && !r.scheduled_at) continue
    out.push({ id: r.id, status: r.status, type: r.type, scheduled_at: r.scheduled_at, published_at: r.published_at, first_line: firstLineOf(r.post_body),
      title: '', belief: null, vehicle: null, recipe: null, qa_verdict: null, is_copy: false, photos: 0, brain: false, human_edited: false,
      slot_kind: null, selling: false, chars: 0, created_at: r.created_at, fixture: fixture ? String(tax.desk_eval_fixture) : null, updated_at: r.updated_at })
  }
  return out
}

/**
 * Resolve the target (Sol r6 #2): the quoted excerpt is checked against EVERY draft in the brief. It
 * must match exactly one (narrowed by `dated` when he named the day), and that one must carry the
 * server-assigned handle the action names. Several matches act on none and show one chip each.
 */
export function resolveDraft(brief: Rendered, act: Act): { d: Draft; handle: string } | { error: string; chips?: { label: string; send: string }[] } {
  const all = [...brief.drafts.values()]
  if (Array.isArray(act.draft)) {
    const ds = act.draft.map((h) => brief.drafts.get(normHandle(h))).filter((d): d is Draft => !!d)
    return { error: 'ambiguous', chips: pickChips(act, ds, all) }
  }
  const handle = normHandle(act.draft)
  if (!handle) return { error: 'no_draft' }
  // the server already resolved the target from his words (planLive, planForTarget): one draft, no model pointer
  if (handle === '#target' && brief.drafts.size === 1 && brief.drafts.has('#target')) return { d: brief.drafts.get('#target')!, handle }
  const named = brief.drafts.get(handle)
  const byLine = [...brief.drafts.entries()].filter(([, d]) => lineMatches(d.first_line, act.line))
  const dated = typeof act.dated === 'string' && act.dated.trim() ? act.dated.trim() : null
  const pool = byLine.length > 1 && dated ? byLine.filter(([, d]) => dayOf(d) === dated) : byLine
  if (pool.length > 1 || (byLine.length > 1 && !pool.length)) return { error: 'ambiguous', chips: pickChips(act, byLine.map(([, d]) => d), all) }
  if (!pool.length) return named ? { error: 'line_mismatch', chips: pickChips(act, [named], all) } : { error: 'unknown_draft' }
  const [h, d] = pool[0]
  if (h !== handle) return { error: 'handle_mismatch', chips: pickChips(act, named ? [d, named] : [d], all) }
  // a day he named is enforced on the resolved draft itself, not only used to narrow (Sol r7 #1)
  if (dated && dayOf(d) !== dated) return { error: 'dated_mismatch', chips: pickChips(act, [d], all) }
  return { d, handle }
}

/** "2026-11-26 10:45" in Warsaw -> UTC ISO. A date or time that does not exist in Warsaw is null. */
export function warsawToIso(s: string): string | null {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (!m) return null
  const [_, y, mo, d, h, mi] = m.map(Number) as unknown as number[]
  const wallOf = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(t)).reduce((a, p) => (a[p.type] = p.value, a), {} as Record<string, string>)
  let t = Date.UTC(y, mo - 1, d, h, mi)
  for (let k = 0; k < 2; k++) {
    const p = wallOf(t)
    t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  }
  // round trip: the instant must show exactly the requested wall time (rejects 31 Nov, DST gaps)
  const p = wallOf(t)
  if (+p.year !== y || +p.month !== mo || +p.day !== d || +p.hour % 24 !== h || +p.minute !== mi) return null
  return new Date(t).toISOString()
}

/** The app's ideaDecidable (src/lib/content.ts): only Ivan's own workspace and no campaign. */
export function ideaDecidable(i: { workspace_type?: string | null; campaign_id?: string | null }): boolean {
  const w = (i.workspace_type ?? '').trim().toLowerCase()
  return (w === '' || w === 'own') && (i.campaign_id ?? null) === null
}


const IN_ALIAS: Record<string, string> = { attach_photo: 'photo_attach', stage_photo: 'photo_stage', remove_date: 'undate', copy: 'link', schedule: 'date', move: 'date' }
// The names the echo carries (what the app and the eval call these actions).
const OUT_NAME: Record<string, string> = { photo_attach: 'attach_photo', photo_stage: 'stage_photo', undate: 'remove_date' }

const KINDS = new Set(['approve', 'date', 'undate', 'pull', 'delete', 'redo', 'photo_attach', 'photo_stage', 'idea', 'link', 'draft_line', 't3'])

export async function plan(ctx: Ctx, act: Act): Promise<Planned> {
  // the same object goes in, so a later flag on it (the authorized QA override) reaches run()
  act.kind = IN_ALIAS[act.kind] ?? act.kind
  // an unknown kind is a fixed code with a fixed label: model text never reaches a label or the journal (Sol r9 #6)
  if (!KINDS.has(act.kind)) { act.kind = 'unknown'; return { echo: { kind: 'unknown', label: "I can't do that from here, so I did nothing.", state: 'failed', undo: false }, refuse: 'unknown_kind', canon: {} } }
  const p = await planInner(ctx, act)
  // every draft action records its target UUID, whatever its state (done, held, dry, refused)
  if (!p.target_id && p.echo.target) p.target_id = ctx.brief.drafts.get(p.echo.target.handle)?.id
  const k = p.echo.kind
  p.echo.kind = k === 'link' ? (classifyPostUrl(String(act.url ?? '')) ? 'copy' : 'idea') : (OUT_NAME[k] ?? k)
  return p
}

/** The draft fields read from the DB before authorization, pinned on the action and checked again right before the write. */
export type Snapshot = {
  target_id: string; updated_at: string | null; status: string; first_line_sha: string
  scheduled_at: string | null; image_urls: string[]
  /** any live queue copy (pending / queued_v2 / posting): delete safety */
  queue: { queue_id: string; slot_at: string; status: string } | null
  /** the exact eligible Next row (linkedin, pending, not a repost, in the future): what a pull acts on */
  next: { queue_id: string; slot_at: string } | null
  /** every live queue row id (pending / queued_v2 / posting), sorted: desk_pull requires this exact set (Sol r5 B2) */
  queue_ids?: string[]
}

/** Read the live row (Ivan's lane) and its live queue rows. Null when the draft is gone or not his. */
export async function readSnapshot(svc: Db, id: string): Promise<Snapshot | null> {
  try { const live = await loadLive({ svc } as Ctx, id); return live ? live.snap : null } catch { return null }
}

const LIVE_COLS = 'id, status, type, scheduled_at, published_at, post_body, title, topic, taxonomy, qa, source_ref, image_urls, created_at, updated_at, client_id'

/** The live row as a Draft plus its snapshot (Sol r3 P1a: describe and run come from the same live row). */
export async function loadLive(ctx: Pick<Ctx, 'svc'> & Partial<Pick<Ctx, 'userDb'>>, id: string): Promise<{ d: Draft; snap: Snapshot; tax: Record<string, unknown> } | null> {
  const { data: row, error } = await ctx.svc.from('carousel_drafts').select(LIVE_COLS).eq('id', id).is('client_id', null).maybeSingle()
  if (error || !row) return null
  const { data: q, error: qErr } = await ctx.svc.from('scheduled_posts').select('id, scheduled_at, status, platform, is_repost')
    .eq('clickup_task_id', id).in('status', ['pending', 'queued_v2', 'posting']).order('scheduled_at', { ascending: true }).limit(20)
  if (qErr) throw new QueueReadError()   // a queue we cannot read is never assumed empty: fail closed
  const rows = (Array.isArray(q) ? q : []) as { id: string; scheduled_at: string; status: string; platform: string | null; is_repost: boolean | null }[]
  const anyLive = rows[0] ?? null
  const queueIds = rows.map((r) => r.id).sort()
  const next = rows.find((r) => r.platform === 'linkedin' && r.status === 'pending' && !r.is_repost && Date.parse(r.scheduled_at) > Date.now()) ?? null
  const firstLine = firstLineOf(row.post_body)
  const tax = (row.taxonomy && typeof row.taxonomy === 'object' && !Array.isArray(row.taxonomy)) ? row.taxonomy as Record<string, unknown> : {}
  let member = tax.source === 'content-brain'
  if (ctx.userDb && ['review', 'approved', 'error', 'generating'].includes(row.status)) {
    const { data: vis } = await ctx.userDb.from('cb34_p2_safe_drafts').select('id, cb34_p2_member').eq('id', row.id).maybeSingle()
    if (!vis && !tax.desk_eval_fixture) return null   // not in his Review: not his to act on
    member = member || vis?.cb34_p2_member === true
  }
  const d: Draft = {
    id: row.id, status: row.status, type: row.type, scheduled_at: row.scheduled_at, published_at: row.published_at,
    first_line: firstLine, title: String(row.title ?? row.topic ?? ''), belief: null, vehicle: null,
    recipe: (row.qa as { recipe?: string } | null)?.recipe ?? null, qa_verdict: (row.qa as { verdict?: string } | null)?.verdict ?? null,
    is_copy: tax.outlier_copy === 'true' || tax.outlier_copy === true, photos: Array.isArray(row.image_urls) ? row.image_urls.length : 0,
    brain: member, human_edited: String(tax.human_edited ?? '') === 'true',
    slot_kind: null, selling: false, chars: String(row.post_body ?? '').length, created_at: row.created_at,
    fixture: (tax.desk_eval_fixture as string) ?? null, updated_at: row.updated_at, queue_ids: queueIds,
  }
  const snap: Snapshot = {
    target_id: row.id, updated_at: row.updated_at, status: row.status, first_line_sha: await sha256Hex(firstLine),
    scheduled_at: row.scheduled_at, image_urls: Array.isArray(row.image_urls) ? row.image_urls.filter((u: unknown) => typeof u === 'string') : [],
    queue: anyLive ? { queue_id: anyLive.id, slot_at: anyLive.scheduled_at, status: anyLive.status } : null,
    next: next ? { queue_id: next.id, slot_at: next.scheduled_at } : null,
    queue_ids: queueIds,
  }
  return { d, snap, tax }
}

function liveBrief(ctx: Ctx, d: Draft, snap: Snapshot, handle: string): Rendered {
  const queueByDraft = new Map(snap.next ? [[d.id, { queue_id: snap.next.queue_id, draft_id: d.id, slot_at: snap.next.slot_at, origin: 'own', first_line: d.first_line }]] : [])
  return { ...ctx.brief, drafts: new Map([[handle, d]]), handleOf: new Map([[d.id, handle]]), queueByDraft }
}

/**
 * Plan a draft action against the LIVE row (Sol r3 P1a): the brief only resolves the exact handle to
 * an id; the quoted line is checked against the live first line, and the description the verifier
 * sees and the write that runs are both built from that same live row.
 */
export async function planLive(ctx: Ctx, act: Act): Promise<{ p: Planned; snap: Snapshot | null }> {
  act.kind = IN_ALIAS[act.kind] ?? act.kind
  const needsDraft = ['approve', 'date', 'undate', 'pull', 'delete', 'redo', 'photo_attach'].includes(act.kind)
  if (!needsDraft || Array.isArray(act.draft)) return { p: await plan(ctx, act), snap: null }
  const kindOut = OUT_NAME[act.kind] ?? act.kind
  const none = (refuse: string, label: string, chips?: { label: string; send: string }[], target_id?: string) =>
    ({ p: { echo: { kind: kindOut, label, state: 'failed' as const, undo: false, detail: refuse }, refuse, chips, target_id }, snap: null })
  // Round 10 (Sol r9 #1): the model does NOT choose the target. Its handle, excerpt and day are
  // ignored; the draft comes from Ivan's CURRENT message alone (target.ts identify), against a fresh,
  // complete read of every live eligible draft. Exactly one candidate proceeds; otherwise act on none.
  let cands = await liveCandidates(ctx, act.kind)
  if (!cands) return none('read_failed', 'I could not read your drafts, so I did nothing.')
  const today = warsawDay(new Date().toISOString())
  // a date move's named day is the NEW date, never identity (eval C03 "on tuesday 9 march")
  const idOpts = { today, dayIsArg: act.kind === 'date' }
  const asId = (ds: Draft[]): IdDraft[] => ds.map((d) => ({ id: d.id, first_line: d.first_line, day: dayOf(d) }))
  let res = identify(ctx.text, asId(cands), ctx.shown, idOpts)
  if (ctx.fixtures && !res.ids.length) {
    // eval fixtures mode: fixtures first; only when no fixture fits his words do his real drafts count
    const real = await liveCandidates({ ...ctx, fixtures: false }, act.kind)
    if (!real) return none('read_failed', 'I could not read your drafts, so I did nothing.')
    cands = real
    res = identify(ctx.text, asId(cands), ctx.shown, idOpts)
  }
  const byId = new Map(cands.map((d) => [d.id, d]))
  if (res.ids.length !== 1) {
    const shown = res.ids.map((x) => byId.get(x)!).filter(Boolean)
    return shown.length
      ? none('ambiguous', `${shown.length} posts match your words. Pick one.`, pickChips(act, shown, cands))
      : none('no_match', 'I could not tell which post you mean from your words, so I did nothing.')
  }
  const match = byId.get(res.ids[0])!
  const handle = '#target'
  // the action now names that draft; the model's own pointers are dropped (never used again, never journaled)
  act.draft = handle; act.line = match.first_line; delete act.dated
  const rivals = res.rivals.map((x) => byId.get(x)!).filter(Boolean).slice(0, 5)
  const r = { d: match, handle }
  let live: Awaited<ReturnType<typeof loadLive>>
  try { live = await loadLive(ctx, r.d.id) } catch (e) {
    if (!(e instanceof QueueReadError)) throw e
    return { p: { echo: { kind: OUT_NAME[act.kind] ?? act.kind, label: 'I could not read its queue, so I did nothing.', state: 'failed', undo: false }, refuse: 'queue_read_failed', target_id: r.d.id }, snap: null }
  }
  if (!live) return { p: { echo: { kind: OUT_NAME[act.kind] ?? act.kind, label: 'That post is gone or no longer in your Review.', state: 'failed', undo: false }, refuse: 'gone', target_id: r.d.id }, snap: null }
  if (live.d.first_line !== match.first_line) {
    // rewritten between the two reads: the words he matched are not this row's any more
    return { p: { echo: { kind: kindOut, label: 'That post was rewritten since, so I did nothing.', state: 'failed', undo: false, detail: 'line_mismatch' }, refuse: 'line_mismatch', target_id: r.d.id,
      chips: pickChips(act, [live.d], cands) }, snap: live.snap }
  }
  act.line = live.d.first_line
  const p = await plan({ ...ctx, brief: liveBrief(ctx, live.d, live.snap, r.handle) }, act)
  p.target_id = live.d.id
  // the verifier reads the resolved post's whole live opener and every rival opener with its day
  const dayText = (x: Draft) => (dayOf(x) === 'undated' ? 'undated' : `dated ${dayOf(x)}`)
  p.context = `Target post, found from his words, full first line: "${live.d.first_line.slice(0, 300)}" (${dayText(live.d)}).` +
    (rivals.length ? ` Other posts that share some of his words: ${rivals.map((o) => `"${o.first_line.slice(0, 300)}" (${dayText(o)})`).join('; ')}. Allowed only if his message means the target, not one of these.` : '')
  return { p, snap: live.snap }
}

/** Immediately before a write: the row must still be exactly as it was authorized (status + updated_at). */
export async function stillSame(svc: Db, snap: Snapshot): Promise<boolean> {
  const { data: row } = await svc.from('carousel_drafts').select('updated_at, status').eq('id', snap.target_id).is('client_id', null).maybeSingle()
  // residual window: the app RPCs take no version argument, so a write landing in the few ms between
  // this read and the RPC is not caught; every app path has the same window
  return !!row && String(row.updated_at) === String(snap.updated_at) && row.status === snap.status
}

/**
 * Re-plan a held action at commit time from the stored target UUID only (Sol r1 #2):
 * the draft is loaded by id (Ivan's lane), checked against Ivan's Review visibility
 * for unfinished statuses, and refused if it changed since it was proposed.
 */
export async function planForTarget(ctx: Ctx, act: Act, snap: Snapshot): Promise<Planned | { refuse: string }> {
  let live: Awaited<ReturnType<typeof loadLive>>
  try { live = await loadLive(ctx, snap.target_id) } catch (e) {
    if (e instanceof QueueReadError) return { refuse: 'queue_read_failed' }
    throw e
  }
  if (!live) return { refuse: 'gone' }
  if (String(live.snap.updated_at) !== String(snap.updated_at) || live.snap.status !== snap.status || live.snap.first_line_sha !== snap.first_line_sha) return { refuse: 'changed' }
  // the queue set the action was authorized on (Sol r5 B2); desk_pull checks it again under the locks
  if (JSON.stringify(snap.queue_ids ?? null) !== JSON.stringify(live.snap.queue_ids ?? null)) return { refuse: 'queue_changed' }
  if ((IN_ALIAS[act.kind] ?? act.kind) === 'pull') {
    // the held pull acts on the very Next row it was proposed for (Sol r4 #4): same queue id and slot, or nothing
    const a = snap.next, b = live.snap.next
    if (!a || !b || a.queue_id !== b.queue_id || Date.parse(a.slot_at) !== Date.parse(b.slot_at)) return { refuse: 'queue_changed' }
  }
  const handle = '#target'
  return await plan({ ...ctx, brief: liveBrief(ctx, live.d, live.snap, handle) }, { ...act, draft: handle, line: live.d.first_line })
}

export function firstLineOf(body: unknown): string {
  return (String(body ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '').slice(0, 300)
}

/**
 * The canonical arguments each kind's write consumes (Sol r7 #2): built once, used by the write itself
 * (planCase reads only these), by the dedupe key and by the journal. Model fields a kind does not
 * consume never appear here.
 */
export function canonArgs(kind: string, act: Act, ctx: Pick<Ctx, 'text' | 'attachments' | 'brief'>): Record<string, unknown> {
  const reason = typeof act.reason === 'string' ? act.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
  const photoUrl = () => ctx.attachments.filter((a) => a.kind === 'photo')[Number(act.photo ?? 1) - 1]?.url ?? null
  switch (kind) {
    case 'approve': case 'undate': return {}
    // the note decides the redo (a directed redo is refused: the writer takes no direction) (eval E12)
    case 'redo': return { note: typeof act.note === 'string' && act.note.trim() ? act.note.replace(/\s+/g, ' ').trim().slice(0, 500) : null }
    case 'date': return { at: warsawToIso(String(act.at ?? '')) }
    case 'pull': case 'delete': return { reason }
    case 'photo_attach': return { url: photoUrl() }
    case 'photo_stage': return {
      url: photoUrl(),
      tags: [...new Set((Array.isArray(act.tags) ? act.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 8).sort(),
      // content_photos.subject is one of selfie | him | no-people (check constraint)
      subject: ['selfie', 'him', 'no-people'].includes(String(act.subject)) ? String(act.subject) : 'no-people',
    }
    case 'idea': return { raw_topic: String(act.text ?? '').trim().slice(0, 500), quote: ivanQuote(act.quote, ctx.text) }
    case 'link': return { url: String(act.url ?? '').trim(), note: typeof act.note === 'string' && verbatimIn(act.note, ctx.text) ? act.note.trim().slice(0, 500) : null }
    case 'draft_line': return { line_id: ctx.brief.lines.get(String(act.line_handle ?? '').toUpperCase())?.id ?? null }
    case 't3': {
      // normalized ONCE into the action: the verifier and queueT3Job get these exact strings (Sol r4 #2)
      if (act._t3_normalized !== true) {
        const raw = String(act.brief ?? '').trim()
        const n = normT3(String(act.title ?? ''), raw ? `${raw}\n\nIvan's own words: ${ctx.text.slice(0, 2000)}` : '')
        act.title = n.title; act.brief = n.brief; act._t3_normalized = true
      }
      return { title: String(act.title), brief: String(act.brief) }
    }
  }
  return {}
}

async function planInner(ctx: Ctx, act: Act): Promise<Planned> {
  const c = canonArgs(act.kind, act, ctx)
  const p = await planCase(ctx, act, c)
  p.canon = c
  return p
}

async function planCase(ctx: Ctx, act: Act, c: Record<string, unknown>): Promise<Planned> {
  const kind = act.kind
  const needsDraft = ['approve', 'date', 'undate', 'pull', 'delete', 'redo', 'photo_attach'].includes(kind)
  let d: Draft | null = null, handle = ''
  if (needsDraft) {
    const r = resolveDraft(ctx.brief, act)
    if ('error' in r) {
      return {
        echo: { kind, label: r.error === 'ambiguous' ? 'More than one post matches. Pick one.' : 'I could not tell which post you mean, so I did nothing.', state: 'failed', undo: false, detail: r.error },
        refuse: r.error, chips: r.chips,
      }
    }
    d = r.d; handle = r.handle
  }
  const target = d ? { kind: 'draft' as const, handle, first_line: d.first_line } : undefined
  const q = d ? `"${short(d.first_line, 50)}"` : ''
  const qq = d ? `the post that starts "${short(d.first_line, 70)}"` : ''
  const base = d ? { target_id: d.id } : {}

  switch (kind) {
    case 'approve': {
      if (!['review', 'error'].includes(d!.status)) {
        return { echo: { kind, label: `${q} is ${d!.status}, so there is nothing to approve.`, state: 'failed', undo: false, target }, refuse: 'bad_status' }
      }
      // A post that failed its quality check is approved only when Ivan says so outright; the
      // authorization check sees these words and decides (no keyword list).
      const failedCheck = d!.status === 'error'
      const id = d!.id, brain = d!.brain, pinned = d!.updated_at ?? null
      return {
        ...base,
        echo: { kind, label: `Approving ${q}${failedCheck ? ' (it failed its check)' : ''}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        describe: `approve ${qq}${failedCheck ? ', even though it FAILED its quality check' : ''}`,
        command: `approve ${qq}${failedCheck ? ' even though it failed its check' : ''}`,
        run: async () => {
          if (failedCheck && act._qa_override !== true) throw new Error('qa_override_missing')
          // the authorized revision only, under the publisher's locks; Brain Keep then calls the app's keep RPC (Sol r5 B3)
          return { result: await deskWrite(ctx, brain ? 'desk_keep' : 'desk_approve', { p_draft: id, p_expected_updated_at: pinned, p_expected_status: d!.status }) }
        },
      }
    }
    case 'date': {
      const iso = c.at as string | null
      if (!iso) return { echo: { kind, label: 'I could not read the date, so I did nothing.', state: 'failed', undo: false, target }, refuse: 'bad_date' }
      if (d!.status === 'published') return { echo: { kind, label: `${q} is already published.`, state: 'failed', undo: false, target }, refuse: 'published' }
      const id = d!.id, prev = d!.scheduled_at
      return {
        ...base,
        echo: { kind, label: `Moved ${q} to ${warsaw(iso)}${prev ? ` (was ${warsaw(prev)})` : ''}`, state: 'done', undo: true, target },
        describe: `date ${qq} for ${String(act.at)} Warsaw time (${warsaw(iso)})`,
        command: `move ${qq} to ${String(act.at)}`,
        run: async () => {
          const w = await setDate(ctx, d!, iso)
          return { result: w.rpc, undo: { op: 'date', draft_id: id, prev: w.before, applied: w.applied, applied_status: w.applied_status, applied_updated_at: w.applied_updated_at },
            detail: w.applied && Date.parse(w.applied) !== Date.parse(iso) ? `The calendar stored ${warsaw(w.applied)}.` : undefined }
        },
      }
    }
    case 'undate':
    case 'pull': {
      const id = d!.id, prev = d!.scheduled_at
      if (!prev) return { echo: { kind, label: `${q} has no date.`, state: 'failed', undo: false, target }, refuse: 'no_date' }
      if (d!.status === 'published') return { echo: { kind, label: `${q} is already published.`, state: 'failed', undo: false, target }, refuse: 'published' }
      const queue = ctx.brief.queueByDraft.get(id)
      const reason = (c.reason as string | null | undefined) ?? null
      if (d!.status === 'scheduled') {
        if (kind === 'pull' && !queue) {
          // a pull acts on the exact Next row only (Sol r4 #4); without one it is the calendar's Remove date, asked for as such
          return { echo: { kind: 'pull', label: `${q} has no queued copy I can pull, so I did nothing.`, state: 'failed', undo: false, target }, refuse: 'no_queue_row',
            chips: [{ label: 'Remove the date', send: `remove the date from ${qq}` }] }
        }
        // Pull: the queued copy is cancelled and the draft goes back to Review. No undo exists in the app.
        return {
          ...base,
          echo: { kind: 'pull', label: `Taking ${q} off the schedule`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
          describe: kind === 'pull'
            ? `take ${qq} off the schedule (it is scheduled for ${warsaw(prev)}; its queued copy for ${warsaw(queue!.slot_at)} is cancelled)${reason ? `, reason: "${reason}"` : ''}`
            : `remove the date from ${qq}, which takes it off the schedule (it is scheduled for ${warsaw(prev)})`,
          command: `pull ${qq} off the schedule`,
          run: async () => {
            // the exact queue set (and for a pull the exact Next row) it was authorized on, checked again
            // under the publisher's locks before the app's own pull runs (Sol r4 #4, r5 B2)
            if (kind === 'pull' && !queue) throw new Error('no_queue_row')
            if (!Array.isArray(d!.queue_ids)) throw new Error('changed')
            return { result: await deskWrite(ctx, 'desk_pull', {
              p_draft: id, p_expected_updated_at: d!.updated_at ?? null, p_queue_ids: d!.queue_ids,
              p_next_queue: kind === 'pull' ? queue!.queue_id : null, p_next_slot: kind === 'pull' ? queue!.slot_at : null,
              p_reason: kind === 'pull' ? reason : null,
            }) }
          },
        }
      }
      return {
        ...base,
        echo: { kind: 'undate', label: `Removed the date from ${q} (was ${warsaw(prev)})`, state: 'done', undo: true, target },
        describe: `remove the date from ${qq} (now ${warsaw(prev)})`,
        command: `remove the date from ${qq}`,
        run: async () => {
          const w = await setDate(ctx, d!, null)
          return { result: w.rpc, undo: { op: 'date', draft_id: id, prev: w.before, applied: w.applied, applied_status: w.applied_status, applied_updated_at: w.applied_updated_at } }
        },
      }
    }
    case 'delete': {
      const id = d!.id, status = d!.status, brain = d!.brain
      if (status === 'published') return { echo: { kind, label: `${q} is published; delete it on LinkedIn.`, state: 'failed', undo: false, target }, refuse: 'published' }
      if (brain) {
        // Brain drafts take Keep or Drop in Review; the desk never drops one (Sol r4 #1)
        return { echo: { kind, label: `${q} is a brain draft. Brain drafts take Keep or Drop in Review.`, state: 'failed', undo: false, target }, refuse: 'brain_draft' }
      }
      // Sol r3 P1d: the desk deletes only an UNDATED draft in review or error. A dated or scheduled
      // one is pulled first (its own action), so a delete can never race a schedule.
      if (d!.scheduled_at || !['review', 'error'].includes(status)) {
        return {
          echo: { kind, label: `${q} is ${d!.scheduled_at ? 'dated' : status}. Pull it first, then delete it.`, state: 'failed', undo: false, target }, refuse: 'dated',
          chips: [{ label: 'Pull it first', send: d!.status === 'scheduled' ? `pull ${qq} off the schedule` : `remove the date from ${qq}` }],
        }
      }
      const why = (c.reason as string | null) ?? null
      const pinned = d!.updated_at ?? null
      return {
        ...base,
        echo: { kind, label: `Deleting ${q}${why ? ` (${why})` : ''}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        describe: `delete ${qq}${why ? `, reason: "${why}"` : ', no reason given'}`,
        command: `delete ${qq}${why ? `, reason: ${why}` : ''}`,
        run: async () => {
          // undated, review/error, no live queue copy, the authorized revision: all checked under the
          // publisher's locks in desk_delete, which then stamps the reason and deletes (or archives)
          if (!pinned) throw new Error('changed')
          return { result: await deskWrite(ctx, 'desk_delete', { p_draft: id, p_expected_updated_at: pinned, p_reason: why }) }
        },
      }
    }
    case 'redo': {
      const id = d!.id
      if (d!.status === 'scheduled') return { echo: { kind, label: `${q} is scheduled. Pull it first, then rewrite.`, state: 'failed', undo: false, target }, refuse: 'scheduled' }
      if (!['review', 'error', 'approved'].includes(d!.status)) return { echo: { kind, label: `${q} is ${d!.status === 'generating' ? 'already being rewritten' : d!.status}, so I left it.`, state: 'failed', undo: false, target }, refuse: 'not_redoable' }
      if (d!.human_edited) return { echo: { kind, label: `${q} has your hand edits, and the writer will not overwrite them.`, state: 'failed', undo: false, target }, refuse: 'human_edited' }
      const note = String(c.note ?? '')
      if (note) {
        // Sol r1: the writer takes no direction from here, so a directed redo is refused, never silently dropped.
        return {
          echo: { kind, label: `The writer can't take a direction from here yet, so I left ${q} as it is. Say "redo it" to rerun it on the same idea.`, state: 'failed', undo: false, target },
          refuse: 'direction_unsupported', chips: [{ label: 'Redo on the same idea', send: `redo ${qq} through the writer, same idea` }],
        }
      }
      return {
        ...base,
        echo: { kind, label: `Rewriting ${q} through your writer. It takes a few minutes.`, state: 'done', undo: false, target },
        describe: `rerun the writer on ${qq} (rewrites its copy)`,
        command: `redo ${qq} through the writer, same idea`,
        run: async () => {
          // the 'generating' claim under the publisher's locks: authorized status + updated_at, and no
          // live queued copy (Sol r6 #6); only the request that gets the row fires the writer
          if (!d!.updated_at) throw new Error('changed')
          const startedAt = new Date().toISOString()
          const before = d!.status
          const row = await deskWrite(ctx, 'desk_redo_claim', { p_draft: id, p_expected_updated_at: d!.updated_at, p_expected_status: before, p_started_at: startedAt }) as
            { type?: string; topic?: string | null; title?: string | null }
          const postFormat = row.type === 'carousel' ? 'Carousel' : row.type === 'single_image' ? 'Single Image' : 'Text Post'
          const f = ctx.fetchImpl ?? fetch
          let status = 0
          try {
            const res = await f(ctx.env('VITE_POSTGEN_WEBHOOK') || POSTGEN, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ draft_id: id, topic: row.topic ?? row.title ?? '', title: row.title ?? '', author: 'Ivan', source: 'Inbox', post_format: postFormat, include_image: 'No' }),
              signal: AbortSignal.timeout(15_000),
            })
            status = res.status
          } catch { status = 0 }
          if (status >= 400 && status < 500) {
            // an explicit rejection: the writer will not run, so the row goes back if it is still ours
            // up to 3 tries while the row is busy (lock wait / deadlock); a row that is no longer our claim
            // needs no release. Still busy after 3: say so plainly (Sol r7 #5)
            let released = false
            for (let i = 0; i < 3 && !released; i++) {
              const { data, error } = await ctx.userDb.rpc('desk_redo_release', { p_draft: id, p_started_at: startedAt, p_status: before })
              const code = error ? (lockCode(error) ? 'busy' : 'error') : String((data as { ok?: boolean; error?: string } | null)?.ok === true ? 'ok' : (data as { error?: string } | null)?.error ?? 'error')
              if (code === 'ok' || code === 'changed' || code === 'gone') released = true
              else await new Promise((res) => setTimeout(res, 150 * (i + 1)))
            }
            if (!released) throw new Error('failed_release')
            throw new Error('writer_refused')
          }
          if (status < 200 || status >= 300) {
            // timeout, reset or 5xx: the writer may well be running; no rollback
            return { result: { fired: 'unconfirmed' }, detail: 'The writer did not confirm. It may still be running; check Review in a few minutes.' }
          }
          return { result: { fired: true } }
        },
      }
    }
    case 'photo_attach': {
      const att = c.url ? { url: String(c.url) } : null
      if (!att) return { echo: { kind, label: 'I do not see a photo on your message.', state: 'failed', undo: false, target }, refuse: 'no_photo' }
      const id = d!.id
      return {
        ...base,
        echo: { kind, label: `Added your photo to ${q}`, state: 'done', undo: true, target },
        describe: `attach the photo he sent to ${qq}`,
        command: `attach this photo to ${qq}`,
        run: async () => {
          const { data, error } = await ctx.userDb.rpc('desk_set_photos', { p_draft: id, p_expected_updated_at: d!.updated_at ?? null, p_expected_status: d!.status, p_add_url: att.url })
          if (error) throw new Error(lockCode(error) ? 'changed' : 'write_failed')
          const w = (data ?? {}) as { ok?: boolean; error?: string; before?: string[]; applied?: string[]; applied_status?: string; applied_updated_at?: string; rpc?: unknown }
          if (w.ok !== true) throw new Error(String(w.error ?? 'refused'))
          return { result: w.rpc ?? null, undo: { op: 'photos', draft_id: id, prev: w.before ?? [], applied: w.applied ?? [], applied_status: w.applied_status, applied_updated_at: w.applied_updated_at } }
        },
      }
    }
    case 'photo_stage': {
      const att = c.url ? { url: String(c.url) } : null
      if (!att) return { echo: { kind, label: 'I do not see a photo on your message.', state: 'failed', undo: false }, refuse: 'no_photo' }
      // the model infers the subject from Ivan's words (it cannot see the picture), else no-people
      const tags = c.tags as string[], subject = String(c.subject)
      return {
        echo: { kind, label: `Saved your photo to the library${tags.length ? ' (' + tags.join(', ') + ')' : ''} for a later post`, state: 'done', undo: true },
        describe: `save the photo he sent to the photo library${tags.length ? ` tagged ${tags.join(', ')}` : ''} for a later post`,
        command: `save this photo to the library for a later post`,
        run: async () => {
          const path = (att.url.match(/\/object\/public\/post-stills\/(.+)$/) ?? [])[1] ?? att.url
          const { data, error } = await ctx.svc.from('content_photos').insert({
            storage_path: decodeURIComponent(path), public_url: att.url, tags: [...new Set([...tags, 'desk'])],
            country: tags.includes('poland') ? 'Poland' : null, subject, source: 'content_desk', source_ref: `desk:${ctx.messageId}`,
          }).select('id').single()
          if (error) throw new Error(error.message)
          return { result: data, undo: { op: 'delete_row', table: 'content_photos', id: data.id } }
        },
      }
    }
    case 'idea': {
      const text = String(c.raw_topic ?? '')
      if (!text) return { echo: { kind, label: 'Nothing to save as an idea.', state: 'failed', undo: false }, refuse: 'empty' }
      // Sol r6 #1: the row is built here, once; the verifier reads exactly its Ivan-facing fields and
      // run() inserts exactly this row. A quote is kept only as a verbatim span of THIS message; with
      // none, the evidence carries no quote at all (no fallback to the whole message).
      const quote = (c.quote as string | null) ?? null
      const row = {
        source: 'manual', content_type: 'post', status: 'pending', raw_topic: text.slice(0, 500),
        evidence: [{ who: 'Ivan', tier: 'OBSERVATION', ...(quote ? { quote } : {}), instrument: 'content desk', source: 'content_desk', when: new Date().toISOString().slice(0, 10) }],
        raw_context: `Ivan in the Content Desk${ctx.attachments.length ? ' (with attachment)' : ''}${quote ? `: ${quote}` : '.'}`,
        source_ref: `desk:${ctx.messageId}`, format_recommendation: 'text',
      }
      return {
        echo: { kind, label: `Saved as an idea: "${short(text, 70)}". The scorer picks it up next.`, state: 'done', undo: true },
        describe: `save a post idea in Ideas. Stored topic: "${row.raw_topic}". Stored as his own words: ${quote ? `"${quote}"` : 'nothing'}. Stored context: "${row.raw_context}"`,
        command: `save this as an idea: ${short(text, 200)}`,
        run: async () => {
          const { data, error } = await ctx.svc.from('lm_idea_candidates').insert(row).select('id').single()
          if (error) throw new Error(error.message)
          return { result: data, undo: { op: 'delete_row', table: 'lm_idea_candidates', id: data.id } }
        },
      }
    }
    case 'link': {
      const url = String(c.url ?? '')
      if (!/^https:\/\//i.test(url)) return { echo: { kind, label: 'That link does not look right, so I did nothing.', state: 'failed', undo: false }, refuse: 'bad_url' }
      // Sol r1: only a link Ivan actually sent, and only social post hosts get fetched.
      if (!urlInMessage(url, ctx.text) && !ctx.attachments.some((a) => a.url === url)) {
        return { echo: { kind, label: 'I only file links you send me.', state: 'failed', undo: false }, refuse: 'url_not_in_message' }
      }
      const post = classifyPostUrl(url)
      // "his note" is attributed to Ivan: only a verbatim span of his message, never model text (Sol r5 B5)
      const note = (c.note as string | null) ?? ''
      return {
        echo: { kind, label: post ? `Added the ${post.platform === 'x' ? 'X' : 'LinkedIn'} post as a copy candidate in Ideas` : 'Saved the link as an idea', state: 'done', undo: true },
        // Sol r6 #1: the verifier reads the exact url and the exact note stored as his words
        describe: (post ? `file the ${post.platform} post he sent as a copy candidate in Ideas (its own title and description are stored as the topic)` : `file the link he sent as a post idea in Ideas. Stored topic: "${(note || `Link: ${url}`).slice(0, 500)}"`) +
          `. Stored as his note: ${note ? `"${note}"` : 'nothing'}`,
        command: `file this link: ${url}`,
        run: async () => {
          let meta: { title?: string; description?: string; author?: string } | null = null
          if (post) { try { meta = ctx.unfurl ? await ctx.unfurl(url) : null } catch { meta = null } }
          const excerpt = [meta?.title, meta?.description].filter(Boolean).join(' - ').slice(0, 600)
          if (post) {
            const ref = `outlier:${post.platform}:${post.id}`
            const { data: dupe } = await ctx.svc.from('lm_idea_candidates').select('id, status').eq('source_ref', ref).limit(1)
            if (dupe?.length) return { result: { existing: dupe[0].id }, detail: 'It was already in Ideas.' }
            const who = meta?.author || post.author || post.platform
            const { data, error } = await ctx.svc.from('lm_idea_candidates').insert({
              source: post.platform === 'x' ? 'x_viral' : 'competitor', content_type: 'post', status: 'reviewing',
              raw_topic: (excerpt || `Copy candidate: ${url}`).slice(0, 500), normalized_topic: (meta?.title ?? '').slice(0, 200) || null,
              evidence: [{ who, tier: 'OBSERVATION', author: who, platform: post.platform, url, excerpt, picked_via: 'content desk: pasted link' }],
              source_ref: ref, raw_context: `Ivan pasted this ${post.platform} post in the Content Desk to copy.${note ? ' His note: ' + note : ''}`,
            }).select('id').single()
            if (error) throw new Error(error.message)
            return { result: data, undo: { op: 'delete_row', table: 'lm_idea_candidates', id: data.id } }
          }
          const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'web' } })()
          const { data, error } = await ctx.svc.from('lm_idea_candidates').insert({
            source: 'manual', content_type: 'post', status: 'pending',
            raw_topic: (note || `Link: ${url}`).slice(0, 500),
            evidence: [
              { who: host, tier: 'OBSERVATION', url, instrument: 'content desk', source: 'content_desk' },
              ...(note ? [{ who: 'Ivan', tier: 'OBSERVATION', quote: note, instrument: 'content desk', source: 'content_desk' }] : []),
            ],
            raw_context: `Ivan shared ${url} in the Content Desk.${note ? ' His note: ' + note : ''}`,
            source_ref: `desk:${ctx.messageId}`, format_recommendation: 'text',
          }).select('id').single()
          if (error) throw new Error(error.message)
          return { result: data, undo: { op: 'delete_row', table: 'lm_idea_candidates', id: data.id } }
        },
      }
    }
    case 'draft_line': {
      const line = [...ctx.brief.lines.values()].find((l) => l.id === c.line_id)
      if (!line) return { echo: { kind, label: 'I could not find that call line, so I did nothing.', state: 'failed', undo: false }, refuse: 'unknown_line' }
      if (line.draft_id) return { echo: { kind, label: 'That line already has a draft in Review.', state: 'failed', undo: false }, refuse: 'exists' }
      return {
        echo: { kind, label: `Sent the call line "${short(line.said || line.topic, 60)}" to your writer. The draft lands in Review in a few minutes.`, state: 'done', undo: false },
        describe: `make a post from his call line "${short(line.said || line.topic, 100)}" through the writer`,
        command: `draft a post from the call line that starts "${short(line.said || line.topic, 60)}"`,
        run: async () => {
          // the app's lane guard (ideaDecidable), on the live row, right before the call (Sol r1 #4)
          const { data: cand } = await ctx.svc.from('lm_idea_candidates').select('id, workspace_type, campaign_id, status').eq('id', line.id).maybeSingle()
          if (!cand || !ideaDecidable(cand)) throw new Error('idea_not_ours')
          const f = ctx.fetchImpl ?? fetch
          const base = (ctx.env('SUPABASE_URL') ?? '').replace(/\/$/, '')
          const anon = ctx.env('SUPABASE_ANON_KEY') ?? ''
          const r = await f(`${base}/functions/v1/lm-curator-decide`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
            body: JSON.stringify({ candidate_id: line.id, decision: 'approve' }), signal: AbortSignal.timeout(20_000),
          })
          if (!r.ok) throw new Error(`idea_desk_${r.status}`)
          return { result: await r.json().catch(() => ({})) }
        },
      }
    }
    case 't3': {
      const title = String(c.title ?? ''), brief = String(c.brief ?? '')
      if (!title || !brief) return { echo: { kind, label: 'The cloud job had no task, so I did nothing.', state: 'failed', undo: false }, refuse: 'empty' }
      if (!ctx.t3) return { echo: { kind, label: 'Cloud jobs are off right now.', state: 'failed', undo: false }, refuse: 't3_off' }
      return {
        echo: { kind, label: 'Opening a cloud thread on Ivan Cloud.', state: 'done', undo: false },
        describe: `open a coding/research job on his cloud machine: "${short(title, 100)}"`,
        command: `open a cloud job: ${short(title, 100)}`,
        run: async () => {
          const j = await ctx.t3!({ title, brief })
          // opened only once the queue write is confirmed: a job id and status queued (Sol r7 #7)
          if (!j.job_id || j.status !== 'queued') throw new Error('t3_queue_failed')
          return { result: j, t3_job: { id: j.job_id, status: j.status, title }, label: `Opened a cloud thread on Ivan Cloud: "${short(title, 60)}"` }
        },
      }
    }
  }
  return { echo: { kind: 'unknown', label: "I can't do that from here, so I did nothing.", state: 'failed', undo: false }, refuse: 'unknown_kind' }
}

export function classifyPostUrl(url: string): { platform: 'linkedin' | 'x'; id: string; author?: string } | null {
  try { return classifyPostUrlInner(url) } catch { return null }   // total: never throws
}

function classifyPostUrlInner(url: string): { platform: 'linkedin' | 'x'; id: string; author?: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^www\.|^mobile\./, '').toLowerCase()
  if (host === 'x.com' || host === 'twitter.com') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/)
    return m ? { platform: 'x', id: m[2], author: '@' + m[1] } : null
  }
  if (host === 'linkedin.com') {
    const act = (u.pathname + ' ' + decodeURIComponent(u.search)).match(/activity[:-](\d{15,25})/) ?? u.pathname.match(/urn:li:(?:activity|share|ugcPost):(\d{15,25})/)
    if (!act) return null
    const author = u.pathname.match(/^\/posts\/([a-z0-9-]+?)_/i)?.[1]
    return { platform: 'linkedin', id: act[1], author }
  }
  return null
}


export class UndoRefused extends Error {}

/**
 * The t3 title and brief exactly as queueT3Job stores them (collapse/trim/cap, then trim again so a
 * cap that lands on whitespace changes nothing): normT3(x) is a fixed point of queueT3Job's own
 * normalization, so the verifier reads the stored strings byte for byte (Sol r4 #2).
 */
export function normT3(title: string, brief: string): { title: string; brief: string } {
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS).trim(),
    brief: brief.trim().slice(0, MAX_BRIEF_CHARS).trim(),
  }
}

/** A desk SQL write (db/20261118m_content_desk_r6.sql): locks, checks, then the app's own write; a refusal is a code. */
async function deskWrite(ctx: Pick<Ctx, 'userDb'>, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.userDb.rpc(fn, args)
  if (error) throw new Error(lockCode(error) ? 'changed' : 'write_failed')
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) throw new Error(typeof r.error === 'string' ? r.error : 'refused')
  return r
}

/**
 * The identity of a proposed action (Sol r6 #3): kind, resolved target and its arguments, normalized
 * (server-owned "_" keys and the handle/excerpt/day that only locate the target are left out; text is
 * whitespace-collapsed and lowercased). Two actions with one key are one action.
 */
export function actionKey(p: Pick<Planned, 'echo' | 'target_id' | 'canon'>): string {
  // an idea's text is compared casefolded with whitespace collapsed; storage and the verifier keep it exact (Sol r8 #2)
  const fold = p.echo.kind === 'idea' ? (v: unknown) => (typeof v === 'string' ? v.normalize('NFKC').toUpperCase().toLowerCase().replace(/\s+/g, ' ').trim() : v) : (v: unknown) => v
  const canon = Object.entries(p.canon ?? {}).map(([k, v]) => [k, fold(v)] as [string, unknown]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([p.echo.kind, p.target_id ?? null, canon])
}

/** 55P03 lock_not_available / 40P01 deadlock_detected: Postgres rolled the call back; it is "it changed, nothing done". */
export function lockCode(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === '55P03' || error.code === '40P01')
}

/** The text is an exact span of Ivan's message (trimmed, non-empty). */
export function verbatimIn(s: unknown, text: string): boolean {
  const q = typeof s === 'string' ? s.trim() : ''
  return q.length > 0 && text.includes(q)
}

/**
 * What the journal stores for one planned action (Sol r7 #3, r8 #3, eval E12): a run keeps the
 * canonical args its write consumes plus what a held commit re-plans from; a refusal keeps only kind
 * and refusal code, except that a refused directed redo keeps its note as his own words.
 */
export function journalArgs(act: Act, p: Pick<Planned, 'run' | 'refuse' | 'canon'>, snap: Snapshot | null, mode: { fixtures?: boolean; dry?: boolean }, text: string): Record<string, unknown> {
  if (p.run) {
    return { kind: act.kind, ...(p.canon ?? {}), ...(act._qa_override === true ? { _qa_override: true } : {}),
      ...(snap ? { _snapshot: snap } : {}), ...(mode.fixtures ? { _fixtures: true } : {}), ...(mode.dry ? { _dry: true } : {}) }
  }
  const note = p.refuse === 'direction_unsupported' ? ivanSpan(p.canon?.note, text) : null
  return { kind: act.kind, refusal_code: p.refuse ?? 'refused', ...(note ? { note } : {}) }
}

/** The exact span of his message that the quote names, found case-insensitively; null when it is not there. */
export function ivanSpan(quote: unknown, text: string): string | null {
  // matched against the ORIGINAL message and sliced from it by index: each window of the original is
  // compared as a whole, so no length-changing transform ever shifts the slice (Sol r9 #8)
  const q = typeof quote === 'string' ? quote.trim() : ''
  if (!q) return null
  const ql = q.toLowerCase()
  for (let i = 0; i + q.length <= text.length; i++) {
    const win = text.slice(i, i + q.length)
    if (win.toLowerCase() === ql) return win
  }
  return null
}

/** What may be stored as Ivan's own words: the model's quote only if it is a verbatim span of his message, else nothing (Sol r6 #1). */
export function ivanQuote(quote: unknown, text: string, cap = 1200): string | null {
  return verbatimIn(quote, text) && String(quote).trim().length <= cap ? String(quote).trim() : null
}

/** The queue could not be read: never assumed empty (Sol r4 #4). */
export class QueueReadError extends Error { constructor() { super('queue_read_failed') } }

/** Date write through desk_set_date: lock, version check, before value, app RPC, applied value: one transaction (Sol r4). */
async function setDate(ctx: Ctx, d: Draft, iso: string | null) {
  const { data, error } = await ctx.userDb.rpc('desk_set_date', { p_draft: d.id, p_expected_updated_at: d.updated_at ?? null, p_expected_status: d.status, p_at: iso })
  if (error) throw new Error(lockCode(error) ? 'changed' : 'write_failed')
  const w = (data ?? {}) as { ok?: boolean; error?: string; before?: string | null; applied?: string | null; applied_status?: string; applied_updated_at?: string; rpc?: unknown }
  if (w.ok !== true) throw new Error(String(w.error ?? 'refused'))
  return { rpc: w.rpc ?? null, before: w.before ?? null, applied: w.applied ?? null, applied_status: w.applied_status ?? null, applied_updated_at: w.applied_updated_at ?? null }
}


/**
 * Undo a done action through the same app paths, but only while the value is still the one this
 * action applied (Sol r1): a later edit in the calendar or the app is never overwritten.
 */
export async function runUndo(ctx: Pick<Ctx, 'userDb' | 'svc'>, undo: Record<string, unknown>): Promise<void> {
  if (undo.op === 'date' || undo.op === 'photos') {
    if (!('applied' in undo) || !undo.applied_status || !undo.applied_updated_at) throw new UndoRefused('legacy')
    // compare (value, status, updated_at) + app RPC in one statement under a row lock, as Ivan's own
    // session (db/20261118m_content_desk_r4.sql); a post scheduled or edited since is never touched
    const { data, error } = undo.op === 'date'
      ? await ctx.userDb.rpc('desk_undo_schedule_v2', { p_draft: undo.draft_id, p_applied: undo.applied ?? null, p_applied_status: undo.applied_status, p_applied_updated_at: undo.applied_updated_at, p_prev: undo.prev ?? null })
      : await ctx.userDb.rpc('desk_undo_photos_v2', { p_draft: undo.draft_id, p_applied: undo.applied ?? [], p_applied_status: undo.applied_status, p_applied_updated_at: undo.applied_updated_at, p_prev: undo.prev ?? [] })
    if (error) { if (lockCode(error)) throw new UndoRefused('changed_since'); throw new Error('undo_failed') }
    const r = (data ?? {}) as { ok?: boolean; error?: string }
    if (r.ok !== true) {
      if (r.error === 'changed_since' || r.error === 'gone') throw new UndoRefused(r.error)
      throw new Error(String(r.error ?? 'undo_failed'))
    }
    return
  }
  if (undo.op === 'delete_row' && (undo.table === 'lm_idea_candidates' || undo.table === 'content_photos')) {
    const { error } = await ctx.svc.from(undo.table).delete().eq('id', undo.id)
    if (error) throw new Error('undo_failed')
    return
  }
  throw new Error('nothing to undo')
}
