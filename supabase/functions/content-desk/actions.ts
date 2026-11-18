// The desk's hands. Every write goes through the same table write or RPC the
// app's own button uses, made with IVAN'S OWN session (the user JWT client), so
// the database applies exactly the checks it applies to a tap in the app:
//   approve      -> carousel_drafts update (approveDraft) / cb39_verdict_set keep for a brain draft
//   date, undate -> operator_set_schedule_date('clientops', …)  (WhenEditor / Calendar)
//   pull         -> content_next_pull(queue, slot_at, reason)    (Next rows)
//   delete       -> deleteDraft (queue cancel, reason stamp, delete, archive fallback) / cb39 drop
//   redo         -> regenerateDraft (status generating + post-gen-v2 webhook)
//   photo_attach -> operator_set_draft_photos('clientops', …)    (PictureRow)
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
import { warsaw } from './brief.ts'
import type { Act } from './parse.ts'

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
const GATE = 'clientops'
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

export function resolveDraft(brief: Rendered, act: Act): { d: Draft; handle: string } | { error: string; chips?: { label: string; send: string }[] } {
  const raw = act.draft
  if (Array.isArray(raw)) {
    const chips = raw.slice(0, 3).map((h) => brief.drafts.get(String(h).startsWith('#') ? String(h).toLowerCase() : '#' + String(h).toLowerCase()))
      .filter(Boolean).map((d) => ({ label: short(d!.first_line, 40), send: `${act.kind} the one that starts "${short(d!.first_line, 70)}"` }))
    return { error: 'ambiguous', chips }
  }
  let handle = String(raw ?? '').trim().toLowerCase()
  if (!handle) return { error: 'no_draft' }
  if (!handle.startsWith('#')) handle = '#' + handle
  const d = brief.drafts.get(handle)   // exact handle only: no prefix fallback (Sol r1 #2)
  if (!d) return { error: 'unknown_draft' }
  if (!lineMatches(d.first_line, act.line)) {
    return { error: 'line_mismatch', chips: [{ label: short(d.first_line, 40), send: `${act.kind} the one that starts "${short(d.first_line, 70)}"` }] }
  }
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

function rpcOk(data: unknown, error: { message?: string } | null): Record<string, unknown> {
  if (error) throw new Error(error.message ?? 'rpc failed')
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) throw new Error(typeof r.error === 'string' ? r.error : 'refused')
  return r
}

function stampTaxonomy(t: unknown, marks: Record<string, unknown>): Record<string, unknown> {
  let parsed = t
  if (typeof t === 'string') { try { parsed = JSON.parse(t) } catch { parsed = t } }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...(parsed as Record<string, unknown>), ...marks }
  if (typeof parsed === 'string' && parsed.trim()) return { structure_used: parsed.trim(), ...marks }
  return { ...marks }
}

/** The app's ideaDecidable (src/lib/content.ts): only Ivan's own workspace and no campaign. */
export function ideaDecidable(i: { workspace_type?: string | null; campaign_id?: string | null }): boolean {
  const w = (i.workspace_type ?? '').trim().toLowerCase()
  return (w === '' || w === 'own') && (i.campaign_id ?? null) === null
}

const BRAIN_REASONS: [RegExp, string][] = [
  [/invent|made up|fake|not true|fabricat/i, 'invented_fact'], [/voice|sound like me|not me/i, 'not_my_voice'],
  [/generic|bland|boring/i, 'generic'], [/topic|off.?topic|wrong subject/i, 'wrong_topic'], [/long/i, 'too_long'],
  [/already|said it|repeat|duplicate/i, 'already_said'], [/proof|receipt/i, 'needs_proof'], [/hook/i, 'weak_hook'],
]

const IN_ALIAS: Record<string, string> = { attach_photo: 'photo_attach', stage_photo: 'photo_stage', remove_date: 'undate', copy: 'link', schedule: 'date', move: 'date' }
// The names the echo carries (what the app and the eval call these actions).
const OUT_NAME: Record<string, string> = { photo_attach: 'attach_photo', photo_stage: 'stage_photo', undate: 'remove_date' }

export async function plan(ctx: Ctx, act: Act): Promise<Planned> {
  // the same object goes in, so a later flag on it (the authorized QA override) reaches run()
  act.kind = IN_ALIAS[act.kind] ?? act.kind
  const p = await planInner(ctx, act)
  const k = p.echo.kind
  p.echo.kind = k === 'link' ? (classifyPostUrl(String(act.url ?? '')) ? 'copy' : 'idea') : (OUT_NAME[k] ?? k)
  return p
}

/** The draft fields a held action pins at proposal and checks again at commit. */
export type Snapshot = { target_id: string; updated_at: string | null; first_line_sha: string }

/**
 * Re-plan a held action at commit time from the stored target UUID only (Sol r1 #2):
 * the draft is loaded by id (Ivan's lane), checked against Ivan's Review visibility
 * for unfinished statuses, and refused if it changed since it was proposed.
 */
export async function planForTarget(ctx: Ctx, act: Act, snap: Snapshot): Promise<Planned | { refuse: string }> {
  const { data: row, error } = await ctx.svc.from('carousel_drafts')
    .select('id, status, type, scheduled_at, published_at, post_body, title, topic, taxonomy, qa, source_ref, image_urls, created_at, updated_at, client_id')
    .eq('id', snap.target_id).is('client_id', null).maybeSingle()
  if (error || !row) return { refuse: 'gone' }
  if (String(row.updated_at) !== String(snap.updated_at)) return { refuse: 'changed' }
  const firstLine = firstLineOf(row.post_body)
  if (await sha256Hex(firstLine) !== snap.first_line_sha) return { refuse: 'changed' }
  const tax = (row.taxonomy && typeof row.taxonomy === 'object' && !Array.isArray(row.taxonomy)) ? row.taxonomy as Record<string, unknown> : {}
  let member = false
  if (['review', 'approved', 'error', 'generating'].includes(row.status)) {
    const { data: vis } = await ctx.userDb.from('cb34_p2_safe_drafts').select('id, cb34_p2_member').eq('id', row.id).maybeSingle()
    if (!vis && !tax.desk_eval_fixture) return { refuse: 'not_visible' }
    member = vis?.cb34_p2_member === true
  }
  const d: Draft = {
    id: row.id, status: row.status, type: row.type, scheduled_at: row.scheduled_at, published_at: row.published_at,
    first_line: firstLine, title: String(row.title ?? row.topic ?? ''), belief: null, vehicle: null,
    recipe: (row.qa as { recipe?: string } | null)?.recipe ?? null, qa_verdict: (row.qa as { verdict?: string } | null)?.verdict ?? null,
    is_copy: tax.outlier_copy === 'true' || tax.outlier_copy === true, photos: Array.isArray(row.image_urls) ? row.image_urls.length : 0,
    brain: member || tax.source === 'content-brain', human_edited: String(tax.human_edited ?? '') === 'true',
    slot_kind: null, selling: false, chars: String(row.post_body ?? '').length, created_at: row.created_at, fixture: (tax.desk_eval_fixture as string) ?? null,
  }
  const handle = String(act.draft ?? '#target').toLowerCase()
  const brief: Rendered = { ...ctx.brief, drafts: new Map([[handle.startsWith('#') ? handle : '#' + handle, d]]), handleOf: new Map([[d.id, handle]]) }
  return await plan({ ...ctx, brief }, { ...act, draft: handle, line: firstLine.slice(0, 60) })
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
      const id = d!.id, brain = d!.brain
      return {
        ...base,
        echo: { kind, label: `Approving ${q}${failedCheck ? ' (it failed its check)' : ''}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        describe: `approve ${qq}${failedCheck ? ', even though it FAILED its quality check' : ''}`,
        command: `approve ${qq}${failedCheck ? ' even though it failed its check' : ''}`,
        run: async () => {
          if (failedCheck && act._qa_override !== true) throw new Error('qa_override_missing')
          if (brain) {
            const { data, error } = await ctx.userDb.rpc('cb39_verdict_set', { p_draft: id, p_verdict: 'keep', p_reasons: [], p_note: null, p_invocation: null, p_ms_to_verdict: null })
            if (error) throw new Error(error.message)
            return { result: data }
          }
          const { data, error } = await ctx.userDb.from('carousel_drafts').update({ status: 'approved' }).eq('id', id).is('client_id', null).select('id')
          if (error) throw new Error(error.message)
          if (!data?.length) throw new Error('This post could not be updated from here.')
          return { result: { approved: id } }
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
        describe: `date ${qq} for ${warsaw(iso)} Warsaw time`,
        command: `move ${qq} to ${String(act.at)}`,
        run: async () => {
          const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: iso })
          const r = rpcOk(data, error)
          const at = typeof r.scheduled_at === 'string' ? r.scheduled_at : iso
          return { result: r, undo: { op: 'date', draft_id: id, prev, applied: at }, detail: at !== iso ? `The calendar stored ${warsaw(at)}.` : undefined }
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
        // Pull: the queued copy is cancelled and the draft goes back to Review. No undo exists in the app.
        return {
          ...base,
          echo: { kind: 'pull', label: `Taking ${q} off the schedule`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
          describe: `take ${qq} off the schedule (it is scheduled for ${warsaw(prev)})`,
          command: `pull ${qq} off the schedule`,
          run: async () => {
            if (queue && kind === 'pull') {
              const { data, error } = await ctx.userDb.rpc('content_next_pull', { p_queue: queue.queue_id, p_slot_at: queue.slot_at, p_reason: reason })
              return { result: rpcOk(data, error) }
            }
            const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: null })
            return { result: rpcOk(data, error) }
          },
        }
      }
      return {
        ...base,
        echo: { kind: 'undate', label: `Removed the date from ${q} (was ${warsaw(prev)})`, state: 'done', undo: true, target },
        describe: `remove the date from ${qq} (now ${warsaw(prev)})`,
        command: `remove the date from ${qq}`,
        run: async () => {
          const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: null })
          return { result: rpcOk(data, error), undo: { op: 'date', draft_id: id, prev, applied: null } }
        },
      }
    }
    case 'delete': {
      const id = d!.id, brain = d!.brain, status = d!.status
      if (status === 'published') return { echo: { kind, label: `${q} is published; delete it on LinkedIn.`, state: 'failed', undo: false, target }, refuse: 'published' }
      const why = typeof act.reason === 'string' ? act.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
      return {
        ...base,
        echo: { kind, label: `Deleting ${q}${why ? ` (${why})` : ''}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        describe: `delete ${qq}${why ? ` because "${why}"` : ''}`,
        command: `delete ${qq}${why ? `, reason: ${why}` : ''}`,
        run: async () => {
          if (brain && ['review', 'error'].includes(status)) {
            const reasons = why ? [...new Set(BRAIN_REASONS.filter(([re]) => re.test(why)).map(([, r]) => r))] : []
            const { data, error } = await ctx.userDb.rpc('cb39_verdict_set', { p_draft: id, p_verdict: 'drop', p_reasons: reasons.length ? reasons : ['other'], p_note: why, p_invocation: null, p_ms_to_verdict: null })
            if (error) throw new Error(error.message)
            return { result: data }
          }
          // Sol r1 #7: a dated/scheduled post is first taken off the schedule through the app's own
          // guarded path, and its queue rows are cancelled; if either fails, nothing is deleted.
          if (status === 'scheduled' || d!.scheduled_at) {
            const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: null })
            rpcOk(data, error)
          }
          const cancel = await ctx.userDb.from('scheduled_posts').update({ status: 'cancelled', error_message: 'draft_deleted_by_operator' })
            .eq('clickup_task_id', id).in('status', ['pending', 'queued_v2', 'posting']).select('id')
          if (cancel.error) throw new Error('queue_cancel_failed')
          const { data: row } = await ctx.userDb.from('carousel_drafts').select('taxonomy').eq('id', id).maybeSingle()
          let tax = row?.taxonomy
          if (why) {
            tax = stampTaxonomy(tax, { delete_reason: why })
            try { await ctx.userDb.from('carousel_drafts').update({ taxonomy: tax }).eq('id', id).is('client_id', null) } catch { /* fail-soft, as the app */ }
          }
          const del = await ctx.userDb.from('carousel_drafts').delete().eq('id', id).is('client_id', null).select('id')
          if (!del.error && del.data?.length) return { result: { outcome: 'deleted' } }
          const upd = await ctx.userDb.from('carousel_drafts')
            .update({ status: 'disqualified', taxonomy: stampTaxonomy(tax, { deleted_by_operator: true, deleted_at: new Date().toISOString() }) })
            .eq('id', id).is('client_id', null).select('id')
          if (upd.error) throw new Error(upd.error.message)
          if (!upd.data?.length) throw new Error('Delete failed: the row was neither removed nor archived.')
          return { result: { outcome: 'disqualified' } }
        },
      }
    }
    case 'redo': {
      const id = d!.id
      if (d!.status === 'scheduled') return { echo: { kind, label: `${q} is scheduled. Pull it first, then rewrite.`, state: 'failed', undo: false, target }, refuse: 'scheduled' }
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
          const { data: row, error: rErr } = await ctx.userDb.from('carousel_drafts').select('id, type, topic, title, taxonomy, status').eq('id', id).maybeSingle()
          if (rErr || !row) throw new Error(rErr?.message ?? 'draft not found')
          const startedAt = new Date().toISOString()
          const before = row.status
          const tax0 = row.taxonomy && typeof row.taxonomy === 'object' && !Array.isArray(row.taxonomy) ? row.taxonomy : {}
          const { error } = await ctx.userDb.from('carousel_drafts').update({ status: 'generating', taxonomy: { ...tax0, generating_started_at: startedAt } }).eq('id', id)
          if (error) throw new Error(error.message)
          const postFormat = row.type === 'carousel' ? 'Carousel' : row.type === 'single_image' ? 'Single Image' : 'Text Post'
          const f = ctx.fetchImpl ?? fetch
          let ok = false
          try {
            const res = await f(ctx.env('VITE_POSTGEN_WEBHOOK') || POSTGEN, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ draft_id: id, topic: row.topic ?? row.title ?? '', title: row.title ?? '', author: 'Ivan', source: 'Inbox', post_format: postFormat, include_image: 'No' }),
              signal: AbortSignal.timeout(15_000),
            })
            ok = res.ok
            if (!ok && res.status < 500) throw new Error(`writer_refused_${res.status}`)
          } catch (e) {
            if (e instanceof Error && e.name === 'TimeoutError') throw new Error('writer_unconfirmed') // may still run: keep "generating"
            ok = false
          }
          if (!ok) {
            // a definite enqueue failure: put the status back if the row is still ours in "generating"
            await ctx.userDb.from('carousel_drafts').update({ status: before, taxonomy: tax0 }).eq('id', id).eq('status', 'generating')
              .filter('taxonomy->>generating_started_at', 'eq', startedAt)
            throw new Error('writer_unavailable')
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
          const { data: row } = await ctx.userDb.from('carousel_drafts').select('image_urls').eq('id', id).maybeSingle()
          const prev: string[] = Array.isArray(row?.image_urls) ? row.image_urls.filter((u: unknown) => typeof u === 'string') : []
          const applied = [...prev, att.url]
          const { data, error } = await ctx.userDb.rpc('operator_set_draft_photos', { p_gate: GATE, p_draft_id: id, p_urls: applied })
          if (error) throw new Error(error.message)
          if ((data as { ok?: boolean })?.ok !== true) throw new Error(String((data as { error?: string })?.error ?? 'refused'))
          const stored = Array.isArray((data as { image_urls?: unknown }).image_urls) ? (data as { image_urls: string[] }).image_urls : applied
          return { result: data, undo: { op: 'photos', draft_id: id, prev, applied: stored } }
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
      const quote = String(act.quote ?? ctx.text).trim()
      if (!text) return { echo: { kind, label: 'Nothing to save as an idea.', state: 'failed', undo: false }, refuse: 'empty' }
      return {
        echo: { kind, label: `Saved as an idea: "${short(text, 70)}". The scorer picks it up next.`, state: 'done', undo: true },
        describe: `save his thought as a post idea in Ideas: "${short(text, 100)}"`,
        command: `save this as an idea: ${short(text, 200)}`,
        run: async () => {
          const { data, error } = await ctx.svc.from('lm_idea_candidates').insert({
            source: 'manual', content_type: 'post', status: 'pending', raw_topic: text.slice(0, 500),
            evidence: [{ who: 'Ivan', tier: 'OBSERVATION', quote: quote.slice(0, 1200), instrument: 'content desk', source: 'content_desk', when: new Date().toISOString().slice(0, 10) }],
            raw_context: `Ivan in the Content Desk${ctx.attachments.length ? ' (with attachment)' : ''}: ${quote.slice(0, 1500)}`,
            source_ref: `desk:${ctx.messageId}`, format_recommendation: 'text',
          }).select('id').single()
          if (error) throw new Error(error.message)
          return { result: data, undo: { op: 'delete_row', table: 'lm_idea_candidates', id: data.id } }
        },
      }
    }
    case 'link': {
      const url = String(act.url ?? '').trim()
      if (!/^https:\/\//i.test(url)) return { echo: { kind, label: 'That link does not look right, so I did nothing.', state: 'failed', undo: false }, refuse: 'bad_url' }
      // Sol r1: only a link Ivan actually sent, and only social post hosts get fetched.
      if (!ctx.text.includes(url) && !ctx.attachments.some((a) => a.url === url)) {
        return { echo: { kind, label: 'I only file links you send me.', state: 'failed', undo: false }, refuse: 'url_not_in_message' }
      }
      const post = classifyPostUrl(url)
      const note = typeof act.note === 'string' ? act.note.trim().slice(0, 500) : ''
      return {
        echo: { kind, label: post ? `Added the ${post.platform === 'x' ? 'X' : 'LinkedIn'} post as a copy candidate in Ideas` : 'Saved the link as an idea', state: 'done', undo: true },
        describe: post ? `file the ${post.platform} post he sent as a copy candidate in Ideas` : `file the link he sent as a post idea in Ideas`,
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
      const title = String(act.title ?? '').trim().slice(0, 120)
      const brief = String(act.brief ?? '').trim().slice(0, 8000)
      if (!title || !brief) return { echo: { kind, label: 'The cloud job had no task, so I did nothing.', state: 'failed', undo: false }, refuse: 'empty' }
      if (!ctx.t3) return { echo: { kind, label: 'Cloud jobs are off right now.', state: 'failed', undo: false }, refuse: 't3_off' }
      return {
        echo: { kind, label: `Opened a cloud thread on Ivan Cloud: "${short(title, 60)}"`, state: 'done', undo: false },
        describe: `open a coding/research job on his cloud machine: "${short(title, 100)}"`,
        command: `open a cloud job: ${short(title, 100)}`,
        run: async () => {
          const j = await ctx.t3!({ title, brief: `${brief}\n\nIvan's own words: ${ctx.text.slice(0, 2000)}` })
          if (j.error && j.status === 'failed') throw new Error('t3_queue_failed')
          return { result: j, t3_job: { id: j.job_id, status: j.status, title } }
        },
      }
    }
  }
  return { echo: { kind, label: `I can't do "${kind}" from here.`, state: 'failed', undo: false }, refuse: 'unknown_kind' }
}

export function classifyPostUrl(url: string): { platform: 'linkedin' | 'x'; id: string; author?: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
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

const sameInstant = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && Date.parse(String(a)) === Date.parse(String(b)))
const sameList = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? a : []) === JSON.stringify(Array.isArray(b) ? b : [])

export class UndoRefused extends Error {}

/**
 * Undo a done action through the same app paths, but only while the value is still the one this
 * action applied (Sol r1): a later edit in the calendar or the app is never overwritten.
 */
export async function runUndo(ctx: Pick<Ctx, 'userDb' | 'svc'>, undo: Record<string, unknown>): Promise<void> {
  if (undo.op === 'date') {
    const { data: row } = await ctx.svc.from('carousel_drafts').select('scheduled_at').eq('id', undo.draft_id).is('client_id', null).maybeSingle()
    if (!row) throw new UndoRefused('gone')
    if ('applied' in undo && !sameInstant(row.scheduled_at, undo.applied)) throw new UndoRefused('changed_since')
    const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: undo.draft_id, p_scheduled_at: undo.prev ?? null })
    rpcOk(data, error)
    return
  }
  if (undo.op === 'photos') {
    const { data: row } = await ctx.svc.from('carousel_drafts').select('image_urls').eq('id', undo.draft_id).is('client_id', null).maybeSingle()
    if (!row) throw new UndoRefused('gone')
    if ('applied' in undo && !sameList(row.image_urls, undo.applied)) throw new UndoRefused('changed_since')
    const { data, error } = await ctx.userDb.rpc('operator_set_draft_photos', { p_gate: GATE, p_draft_id: undo.draft_id, p_urls: undo.prev ?? [] })
    if (error) throw new Error(error.message)
    if ((data as { ok?: boolean })?.ok !== true) throw new Error(String((data as { error?: string })?.error ?? 'refused'))
    return
  }
  if (undo.op === 'delete_row' && (undo.table === 'lm_idea_candidates' || undo.table === 'content_photos')) {
    const { error } = await ctx.svc.from(undo.table).delete().eq('id', undo.id)
    if (error) throw new Error(error.message)
    return
  }
  throw new Error('nothing to undo')
}
