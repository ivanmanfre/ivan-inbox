// The desk's hands. Every write goes through the same table write or RPC the
// app's own button uses, made with IVAN'S OWN session (the user JWT client), so
// the database applies exactly the checks it applies to a tap in the app:
//   approve      -> carousel_drafts update (approveDraft) / cb39_verdict_set keep for a brain draft
//   date, undate -> operator_set_schedule_date('clientops', …)  (WhenEditor / Calendar)
//   pull         -> content_next_pull(queue, slot_at, reason)    (Next rows)
//   delete       -> deleteDraft (reason stamp, delete, archive fallback, queue cancel) / cb39 drop
//   redo         -> regenerateDraft (status generating + post-gen-v2 webhook)
//   photo_attach -> operator_set_draft_photos('clientops', …)    (PictureRow)
//   draft_line   -> lm-curator-decide approve                    (Ideas approve)
// Ideas, links and staged photos have no app insert path; they use the same row
// shapes the app's producers write (operator_outlier_use, content-radar), with
// the service role.
//
// SAFETY: an action names a draft by the handle the brief handed out AND the
// first words of its first line. Both must agree or nothing happens.

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
}

export const HOLD_MS = 8000
const GATE = 'clientops'
const POSTGEN = 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2'

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const short = (s: string, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** Does the model's quoted line really belong to this draft? Needs 2+ words and a prefix or containment match. */
export function lineMatches(firstLine: string, quoted: unknown): boolean {
  if (typeof quoted !== 'string') return false
  const q = norm(quoted).split(' ').filter(Boolean).slice(0, 6)
  if (q.length < 2 && !(q.length === 1 && q[0].length >= 6)) return false
  const f = norm(firstLine)
  const head = q.join(' ')
  if (f.startsWith(head) || f.includes(head)) return true
  // tolerate a dropped or changed word: 80% of the quoted words appear in order
  const words = f.split(' ')
  let i = 0, hits = 0
  for (const w of q) { const j = words.indexOf(w, i); if (j >= 0) { hits++; i = j + 1 } }
  return q.length >= 3 && hits / q.length >= 0.8
}

export function resolveDraft(brief: Rendered, act: Act): { d: Draft; handle: string } | { error: string; chips?: { label: string; send: string }[] } {
  const raw = act.draft
  if (Array.isArray(raw)) {
    const chips = raw.slice(0, 3).map((h) => brief.drafts.get(String(h).startsWith('#') ? String(h) : '#' + String(h)))
      .filter(Boolean).map((d) => ({ label: short(d!.first_line, 40), send: `${act.kind} the one that starts "${short(d!.first_line, 70)}"` }))
    return { error: 'ambiguous', chips }
  }
  let handle = String(raw ?? '').trim().toLowerCase()
  if (!handle) return { error: 'no_draft' }
  if (!handle.startsWith('#')) handle = '#' + handle
  let d = brief.drafts.get(handle)
  if (!d) {
    // a longer or shorter prefix of a handle we gave out, if it is unique
    const hits = [...brief.drafts.entries()].filter(([h]) => h.startsWith(handle) || handle.startsWith(h))
    if (hits.length === 1) { handle = hits[0][0]; d = hits[0][1] }
  }
  if (!d) return { error: 'unknown_draft' }
  if (!lineMatches(d.first_line, act.line)) {
    return { error: 'line_mismatch', chips: [{ label: short(d.first_line, 40), send: `${act.kind} the one that starts "${short(d.first_line, 70)}"` }] }
  }
  return { d, handle }
}

/** "2026-11-26 10:45" in Warsaw -> UTC ISO. */
export function warsawToIso(s: string): string | null {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (!m) return null
  const [_, y, mo, d, h, mi] = m.map(Number) as unknown as number[]
  // find the UTC instant whose Warsaw wall time is y-mo-d h:mi (DST-safe, two passes)
  let t = Date.UTC(y, mo - 1, d, h, mi)
  for (let k = 0; k < 2; k++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(t)).reduce((a, p) => (a[p.type] = p.value, a), {} as Record<string, string>)
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute)
    t += Date.UTC(y, mo - 1, d, h, mi) - wall
  }
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

const BRAIN_REASONS: [RegExp, string][] = [
  [/invent|made up|fake|not true|fabricat/i, 'invented_fact'], [/voice|sound like me|not me/i, 'not_my_voice'],
  [/generic|bland|boring/i, 'generic'], [/topic|off.?topic|wrong subject/i, 'wrong_topic'], [/long/i, 'too_long'],
  [/already|said it|repeat|duplicate/i, 'already_said'], [/proof|receipt/i, 'needs_proof'], [/hook/i, 'weak_hook'],
]

const IN_ALIAS: Record<string, string> = { attach_photo: 'photo_attach', stage_photo: 'photo_stage', remove_date: 'undate', copy: 'link', schedule: 'date', move: 'date' }
// The names the echo carries (what the app and the eval call these actions).
const OUT_NAME: Record<string, string> = { photo_attach: 'attach_photo', photo_stage: 'stage_photo', undate: 'remove_date' }

export async function plan(ctx: Ctx, act: Act): Promise<Planned> {
  const p = await planInner(ctx, { ...act, kind: IN_ALIAS[act.kind] ?? act.kind })
  const k = p.echo.kind
  p.echo.kind = k === 'link' ? (classifyPostUrl(String(act.url ?? '')) ? 'copy' : 'idea') : (OUT_NAME[k] ?? k)
  return p
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

  switch (kind) {
    case 'approve': {
      if (!['review', 'error'].includes(d!.status)) {
        return { echo: { kind, label: `${q} is ${d!.status}, so there is nothing to approve.`, state: 'failed', undo: false, target }, refuse: 'bad_status' }
      }
      if (d!.status === 'error' && !/anyway/i.test(ctx.text)) {
        return {
          echo: { kind, label: `${q} failed its check. Approve it anyway?`, state: 'failed', undo: false, target }, refuse: 'qa_error',
          chips: [{ label: 'Approve anyway', send: `approve the one that starts "${short(d!.first_line, 70)}" anyway` }],
        }
      }
      const id = d!.id, brain = d!.brain
      return {
        echo: { kind, label: `Approving ${q}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        run: async () => {
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
        echo: { kind, label: `Moved ${q} to ${warsaw(iso)}${prev ? ` (was ${warsaw(prev)})` : ''}`, state: 'done', undo: true, target },
        run: async () => {
          const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: iso })
          const r = rpcOk(data, error)
          const at = typeof r.scheduled_at === 'string' ? r.scheduled_at : iso
          return { result: r, undo: { op: 'date', draft_id: id, prev }, detail: at !== iso ? `The calendar stored ${warsaw(at)}.` : undefined }
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
          echo: { kind: 'pull', label: `Taking ${q} off the schedule`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
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
        echo: { kind: 'undate', label: `Removed the date from ${q} (was ${warsaw(prev)})`, state: 'done', undo: true, target },
        run: async () => {
          const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: id, p_scheduled_at: null })
          return { result: rpcOk(data, error), undo: { op: 'date', draft_id: id, prev } }
        },
      }
    }
    case 'delete': {
      const id = d!.id, brain = d!.brain
      if (d!.status === 'published') return { echo: { kind, label: `${q} is published; delete it on LinkedIn.`, state: 'failed', undo: false, target }, refuse: 'published' }
      const why = typeof act.reason === 'string' ? act.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
      return {
        echo: { kind, label: `Deleting ${q}${why ? ` (${why})` : ''}`, state: 'held', undo: true, hold_ms: HOLD_MS, target },
        run: async () => {
          if (brain && ['review', 'error'].includes(d!.status)) {
            const reasons = why ? [...new Set(BRAIN_REASONS.filter(([re]) => re.test(why)).map(([, r]) => r))] : []
            const { data, error } = await ctx.userDb.rpc('cb39_verdict_set', { p_draft: id, p_verdict: 'drop', p_reasons: reasons.length ? reasons : ['other'], p_note: why, p_invocation: null, p_ms_to_verdict: null })
            if (error) throw new Error(error.message)
            return { result: data }
          }
          const { data: row } = await ctx.userDb.from('carousel_drafts').select('taxonomy').eq('id', id).maybeSingle()
          let tax = row?.taxonomy
          if (why) {
            tax = stampTaxonomy(tax, { delete_reason: why })
            try { await ctx.userDb.from('carousel_drafts').update({ taxonomy: tax }).eq('id', id).is('client_id', null) } catch { /* fail-soft, as the app */ }
          }
          const del = await ctx.userDb.from('carousel_drafts').delete().eq('id', id).is('client_id', null).select('id')
          let outcome = 'deleted'
          if (del.error || !del.data?.length) {
            const upd = await ctx.userDb.from('carousel_drafts')
              .update({ status: 'disqualified', taxonomy: stampTaxonomy(tax, { deleted_by_operator: true, deleted_at: new Date().toISOString() }) })
              .eq('id', id).is('client_id', null).select('id')
            if (upd.error) throw new Error(upd.error.message)
            if (!upd.data?.length) throw new Error('Delete failed: the row was neither removed nor archived.')
            outcome = 'disqualified'
          }
          try {
            await ctx.userDb.from('scheduled_posts').update({ status: 'cancelled', error_message: 'draft_deleted_by_operator' })
              .eq('clickup_task_id', id).in('status', ['pending', 'queued_v2', 'posting'])
          } catch { /* as the app: never fail a completed delete on the second write */ }
          return { result: { outcome } }
        },
      }
    }
    case 'redo': {
      const id = d!.id
      if (d!.status === 'scheduled') return { echo: { kind, label: `${q} is scheduled. Pull it first, then rewrite.`, state: 'failed', undo: false, target }, refuse: 'scheduled' }
      if (d!.human_edited) return { echo: { kind, label: `${q} has your hand edits, and the writer will not overwrite them.`, state: 'failed', undo: false, target }, refuse: 'human_edited' }
      const note = typeof act.note === 'string' ? act.note.trim() : ''
      return {
        echo: { kind, label: `Rewriting ${q} through your writer. It takes a few minutes.`, state: 'done', undo: false, target },
        run: async () => {
          const { data: row, error: rErr } = await ctx.userDb.from('carousel_drafts').select('id, type, topic, title, taxonomy').eq('id', id).maybeSingle()
          if (rErr || !row) throw new Error(rErr?.message ?? 'draft not found')
          const tax = { ...(row.taxonomy && typeof row.taxonomy === 'object' && !Array.isArray(row.taxonomy) ? row.taxonomy : {}), generating_started_at: new Date().toISOString() }
          const { error } = await ctx.userDb.from('carousel_drafts').update({ status: 'generating', taxonomy: tax }).eq('id', id)
          if (error) throw new Error(error.message)
          const postFormat = row.type === 'carousel' ? 'Carousel' : row.type === 'single_image' ? 'Single Image' : 'Text Post'
          const f = ctx.fetchImpl ?? fetch
          const res = await f(ctx.env('VITE_POSTGEN_WEBHOOK') || POSTGEN, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft_id: id, topic: row.topic ?? row.title ?? '', title: row.title ?? '', author: 'Ivan', source: 'Inbox', post_format: postFormat, include_image: 'No' }),
            signal: AbortSignal.timeout(15_000),
          })
          if (!res.ok) throw new Error(`the writer answered ${res.status}`)
          return { result: { fired: true }, detail: note ? 'The writer reruns on the same idea; it does not take a direction from here yet.' : undefined }
        },
      }
    }
    case 'photo_attach': {
      const n = Number(act.photo ?? 1)
      const att = ctx.attachments.filter((a) => a.kind === 'photo')[n - 1]
      if (!att) return { echo: { kind, label: 'I do not see a photo on your message.', state: 'failed', undo: false, target }, refuse: 'no_photo' }
      const id = d!.id
      return {
        echo: { kind, label: `Added your photo to ${q}`, state: 'done', undo: true, target },
        run: async () => {
          const { data: row } = await ctx.userDb.from('carousel_drafts').select('image_urls').eq('id', id).maybeSingle()
          const prev: string[] = Array.isArray(row?.image_urls) ? row.image_urls.filter((u: unknown) => typeof u === 'string') : []
          const { data, error } = await ctx.userDb.rpc('operator_set_draft_photos', { p_gate: GATE, p_draft_id: id, p_urls: [...prev, att.url] })
          if (error) throw new Error(error.message)
          if ((data as { ok?: boolean })?.ok !== true) throw new Error(String((data as { error?: string })?.error ?? 'refused'))
          return { result: data, undo: { op: 'photos', draft_id: id, prev } }
        },
      }
    }
    case 'photo_stage': {
      const n = Number(act.photo ?? 1)
      const att = ctx.attachments.filter((a) => a.kind === 'photo')[n - 1]
      if (!att) return { echo: { kind, label: 'I do not see a photo on your message.', state: 'failed', undo: false }, refuse: 'no_photo' }
      const tags = (Array.isArray(act.tags) ? act.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8)
      const note = typeof act.note === 'string' ? act.note.slice(0, 300) : null
      return {
        echo: { kind, label: `Saved your photo to the library${tags.length ? ' (' + tags.join(', ') + ')' : ''} for a later post`, state: 'done', undo: true },
        run: async () => {
          const path = (att.url.match(/\/object\/public\/post-stills\/(.+)$/) ?? [])[1] ?? att.url
          const { data, error } = await ctx.svc.from('content_photos').insert({
            storage_path: decodeURIComponent(path), public_url: att.url, tags: [...new Set([...tags, 'desk'])],
            country: tags.includes('poland') ? 'Poland' : null, subject: note, source: 'content_desk', source_ref: `desk:${ctx.messageId}`,
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
      const post = classifyPostUrl(url)
      const note = typeof act.note === 'string' ? act.note.trim().slice(0, 500) : ''
      return {
        echo: { kind, label: post ? `Added the ${post.platform === 'x' ? 'X' : 'LinkedIn'} post as a copy candidate in Ideas` : 'Saved the link as an idea', state: 'done', undo: true },
        run: async () => {
          let meta: { title?: string; description?: string; author?: string } | null = null
          try { meta = ctx.unfurl ? await ctx.unfurl(url) : null } catch { meta = null }
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
            raw_topic: (note || excerpt || `Link: ${url}`).slice(0, 500),
            evidence: [
              { who: meta?.author || host, tier: 'OBSERVATION', url, excerpt, instrument: 'content desk', source: 'content_desk' },
              ...(note ? [{ who: 'Ivan', tier: 'OBSERVATION', quote: note, instrument: 'content desk', source: 'content_desk' }] : []),
            ],
            raw_context: `Ivan shared ${url} in the Content Desk.${note ? ' His note: ' + note : ''}${excerpt ? ' Page: ' + excerpt : ''}`,
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
        run: async () => {
          const f = ctx.fetchImpl ?? fetch
          const base = (ctx.env('SUPABASE_URL') ?? '').replace(/\/$/, '')
          const anon = ctx.env('SUPABASE_ANON_KEY') ?? ''
          const r = await f(`${base}/functions/v1/lm-curator-decide`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
            body: JSON.stringify({ candidate_id: line.id, decision: 'approve' }), signal: AbortSignal.timeout(20_000),
          })
          if (!r.ok) throw new Error(`the idea desk answered ${r.status}`)
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
        run: async () => {
          const j = await ctx.t3!({ title, brief: `${brief}\n\nIvan's own words: ${ctx.text.slice(0, 2000)}` })
          if (j.error && j.status === 'failed') throw new Error(j.error)
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

/** Undo a done action from its stored undo payload, through the same app paths. */
export async function runUndo(ctx: Pick<Ctx, 'userDb' | 'svc'>, undo: Record<string, unknown>): Promise<void> {
  if (undo.op === 'date') {
    const { data, error } = await ctx.userDb.rpc('operator_set_schedule_date', { p_gate: GATE, p_draft_id: undo.draft_id, p_scheduled_at: undo.prev ?? null })
    rpcOk(data, error)
    return
  }
  if (undo.op === 'photos') {
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
