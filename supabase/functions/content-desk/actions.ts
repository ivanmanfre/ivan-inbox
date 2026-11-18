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
}

export type Planned = {
  echo: Omit<ActionEcho, 'id'>
  // what to run now (done) or on commit (held); returns result + undo payload
  run?: () => Promise<{ result: unknown; undo?: Record<string, unknown> | null; detail?: string; t3_job?: ActionEcho['t3_job'] }>
  refuse?: string
  chips?: { label: string; send: string }[]
  /** the action in plain words, for the authorization check */
  describe?: string
  /** an explicit command Ivan can tap to ask for exactly this */
  command?: string
  target_id?: string
}

export const HOLD_MS = 8000
const POSTGEN = 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2'

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const short = (s: string, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Strict: the quoted words (normalized) must start, or appear whole inside, the draft's first line; min 3 words or 12 chars. */
export function lineMatches(firstLine: string, quoted: unknown): boolean {
  if (typeof quoted !== 'string') return false
  const q = norm(quoted)
  if (!q || (q.split(' ').length < 3 && q.length < 12)) return false
  const f = norm(firstLine)
  return f.startsWith(q) || ` ${f} `.includes(` ${q} `)
}

const normHandle = (h: unknown) => { const x = String(h ?? '').trim().toLowerCase(); return x ? (x.startsWith('#') ? x : '#' + x) : '' }

/** The Warsaw day a draft is on (published day for a published post), or 'undated'. */
export function dayOf(d: Draft): string {
  const at = d.status === 'published' ? (d.published_at ?? d.scheduled_at) : d.scheduled_at
  return at ? warsawDay(at) : 'undated'
}

/** The shortest opening of the draft's first line that matches no other draft in the brief (else the whole line). */
export function distinctExcerpt(d: Draft, all: Draft[]): string {
  const words = d.first_line.split(/\s+/).filter(Boolean)
  for (let n = 3; n <= Math.min(words.length, 24); n++) {
    const ex = words.slice(0, n).join(' ')
    if (all.filter((o) => lineMatches(o.first_line, ex)).length === 1) return ex
  }
  return d.first_line
}

const VERB: Record<string, (ref: string, act: Act) => string> = {
  approve: (r) => `approve ${r}`, delete: (r) => `delete ${r}`, redo: (r) => `redo ${r} through the writer, same idea`,
  date: (r, a) => `move ${r} to ${String(a.at ?? '')}`.trim(), undate: (r) => `remove the date from ${r}`,
  pull: (r) => `pull ${r} off the schedule`, photo_attach: (r) => `attach the photo to ${r}`,
}

/** One chip per candidate: a distinct excerpt plus its day, so each chip names exactly one draft. */
function pickChips(act: Act, ds: Draft[], all: Draft[]): { label: string; send: string }[] {
  return ds.slice(0, 3).map((d) => {
    const day = dayOf(d)
    const ref = `the one that starts "${distinctExcerpt(d, all)}" ${day === 'undated' ? 'undated' : `dated ${day}`}`
    const send = (VERB[IN_ALIAS[act.kind] ?? act.kind] ?? ((r: string) => `${act.kind} ${r}`))(ref, act)
    return { label: send, send }
  })
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
  const named = brief.drafts.get(handle)
  const byLine = [...brief.drafts.entries()].filter(([, d]) => lineMatches(d.first_line, act.line))
  const dated = typeof act.dated === 'string' && act.dated.trim() ? act.dated.trim() : null
  const pool = byLine.length > 1 && dated ? byLine.filter(([, d]) => dayOf(d) === dated) : byLine
  if (pool.length > 1 || (byLine.length > 1 && !pool.length)) return { error: 'ambiguous', chips: pickChips(act, byLine.map(([, d]) => d), all) }
  if (!pool.length) return named ? { error: 'line_mismatch', chips: pickChips(act, [named], all) } : { error: 'unknown_draft' }
  const [h, d] = pool[0]
  if (h !== handle) return { error: 'handle_mismatch', chips: pickChips(act, named ? [d, named] : [d], all) }
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

export async function plan(ctx: Ctx, act: Act): Promise<Planned> {
  // the same object goes in, so a later flag on it (the authorized QA override) reaches run()
  act.kind = IN_ALIAS[act.kind] ?? act.kind
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
  const r = resolveDraft(ctx.brief, act)
  if ('error' in r) return { p: await plan(ctx, act), snap: null }   // plan() renders the refusal + chips
  let live: Awaited<ReturnType<typeof loadLive>>
  try { live = await loadLive(ctx, r.d.id) } catch (e) {
    if (!(e instanceof QueueReadError)) throw e
    return { p: { echo: { kind: OUT_NAME[act.kind] ?? act.kind, label: 'I could not read its queue, so I did nothing.', state: 'failed', undo: false }, refuse: 'queue_read_failed', target_id: r.d.id }, snap: null }
  }
  if (!live) return { p: { echo: { kind: OUT_NAME[act.kind] ?? act.kind, label: 'That post is gone or no longer in your Review.', state: 'failed', undo: false }, refuse: 'gone', target_id: r.d.id }, snap: null }
  if (!lineMatches(live.d.first_line, act.line)) {
    return { p: { echo: { kind: OUT_NAME[act.kind] ?? act.kind, label: 'That post was rewritten since, so I did nothing.', state: 'failed', undo: false, detail: 'line_mismatch' }, refuse: 'line_mismatch', target_id: r.d.id,
      chips: [{ label: short(live.d.first_line, 40), send: `${act.kind} the one that starts "${short(live.d.first_line, 70)}"` }] }, snap: live.snap }
  }
  const p = await plan({ ...ctx, brief: liveBrief(ctx, live.d, live.snap, r.handle) }, act)
  p.target_id = live.d.id
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
  return (String(body ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '').slice(0, 160)
}

async function planInner(ctx: Ctx, act: Act): Promise<Planned> {
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
      const iso = warsawToIso(String(act.at ?? ''))
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
      const reason = typeof act.reason === 'string' ? act.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
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
      const why = typeof act.reason === 'string' ? act.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
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
      const note = typeof act.note === 'string' ? act.note.trim() : ''
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
            try { await deskWrite(ctx, 'desk_redo_release', { p_draft: id, p_started_at: startedAt, p_status: before }) } catch { /* it changed since: leave it */ }
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
      const n = Number(act.photo ?? 1)
      const att = ctx.attachments.filter((a) => a.kind === 'photo')[n - 1]
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
      const n = Number(act.photo ?? 1)
      const att = ctx.attachments.filter((a) => a.kind === 'photo')[n - 1]
      if (!att) return { echo: { kind, label: 'I do not see a photo on your message.', state: 'failed', undo: false }, refuse: 'no_photo' }
      const tags = (Array.isArray(act.tags) ? act.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8)
      // content_photos.subject is one of selfie | him | no-people (check constraint); the model
      // infers it from Ivan's words (it cannot see the picture), else no-people.
      const subject = ['selfie', 'him', 'no-people'].includes(String(act.subject)) ? String(act.subject) : 'no-people'
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
      const text = String(act.text ?? '').trim()
      if (!text) return { echo: { kind, label: 'Nothing to save as an idea.', state: 'failed', undo: false }, refuse: 'empty' }
      // Sol r6 #1: the row is built here, once; the verifier reads exactly its Ivan-facing fields and
      // run() inserts exactly this row. A quote is kept only as a verbatim span of THIS message; with
      // none, the evidence carries no quote at all (no fallback to the whole message).
      const quote = ivanQuote(act.quote, ctx.text)
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
      const url = String(act.url ?? '').trim()
      if (!/^https:\/\//i.test(url)) return { echo: { kind, label: 'That link does not look right, so I did nothing.', state: 'failed', undo: false }, refuse: 'bad_url' }
      // Sol r1: only a link Ivan actually sent, and only social post hosts get fetched.
      if (!urlInMessage(url, ctx.text) && !ctx.attachments.some((a) => a.url === url)) {
        return { echo: { kind, label: 'I only file links you send me.', state: 'failed', undo: false }, refuse: 'url_not_in_message' }
      }
      const post = classifyPostUrl(url)
      // "his note" is attributed to Ivan: only a verbatim span of his message, never model text (Sol r5 B5)
      const note = typeof act.note === 'string' && verbatimIn(act.note, ctx.text) ? act.note.trim().slice(0, 500) : ''
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
      const h = String(act.line_handle ?? '').toUpperCase()
      const line = ctx.brief.lines.get(h)
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
      // normalized ONCE into the action: the verifier and queueT3Job get these exact strings (Sol r4 #2)
      if (act._t3_normalized !== true) {
        const raw = String(act.brief ?? '').trim()
        const n = normT3(String(act.title ?? ''), raw ? `${raw}\n\nIvan's own words: ${ctx.text.slice(0, 2000)}` : '')
        act.title = n.title; act.brief = n.brief; act._t3_normalized = true
      }
      const title = String(act.title), brief = String(act.brief)
      if (!title || !brief) return { echo: { kind, label: 'The cloud job had no task, so I did nothing.', state: 'failed', undo: false }, refuse: 'empty' }
      if (!ctx.t3) return { echo: { kind, label: 'Cloud jobs are off right now.', state: 'failed', undo: false }, refuse: 't3_off' }
      return {
        echo: { kind, label: `Opened a cloud thread on Ivan Cloud: "${short(title, 60)}"`, state: 'done', undo: false },
        describe: `open a coding/research job on his cloud machine: "${short(title, 100)}"`,
        command: `open a cloud job: ${short(title, 100)}`,
        run: async () => {
          const j = await ctx.t3!({ title, brief })
          if (j.error && j.status === 'failed') throw new Error('t3_queue_failed')
          return { result: j, t3_job: { id: j.job_id, status: j.status, title } }
        },
      }
    }
  }
  return { echo: { kind, label: `I can't do "${kind}" from here.`, state: 'failed', undo: false }, refuse: 'unknown_kind' }
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
export function actionKey(act: Act, targetId?: string | null): string {
  const args = Object.entries(act)
    .filter(([k]) => !k.startsWith('_') && !['kind', 'draft', 'line', 'dated'].includes(k))
    .map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().toLowerCase() : v] as [string, unknown])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([IN_ALIAS[act.kind] ?? act.kind, targetId ?? null, args])
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
