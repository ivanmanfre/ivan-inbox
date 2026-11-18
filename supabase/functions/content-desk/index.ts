// content-desk: Ivan's Content Desk. A fast conversational desk with a preloaded
// brief and typed actions (MISSION goal-runs/content-desk-chat-2026-11-18).
//
// Separate from inbox-claude on purpose: that broker drives a full Claude Code
// session (minutes, Bash, every client's credentials). The desk is one model
// call through the Railway proxy with the whole content week already in the
// prompt, and its only hands are the app's own write paths, made with Ivan's
// own session (actions.ts).
//
// Doors:
//   browser (Bearer = Ivan's access token, allowlisted user id): send, undo, commit, cancel, warm
//   server  (x-desk-secret = DESK_TICK_SECRET; not a CORS allow-header): tick
// Flags (desk_config): desk_enabled, triggers_enabled, t3_enabled. `x-desk-eval: 1`
// from the allowlisted user bypasses the off flags and stamps meta.test (the eval).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { render, applyVisibility, type BriefJson, type Rendered } from './brief.ts'
import { buildPrompt } from './prompt.ts'
import { parse, plain, type Act } from './parse.ts'
import { askDesk, askDeskStream, LlmError, DESK_MODEL } from './llm.ts'
import { plan, runUndo, type ActionEcho, type Ctx } from './actions.ts'
import { planTriggers } from './triggers.ts'
import { queueT3Job, sweepT3Stalls } from '../_shared/desk-t3.ts'
import { unfurl } from '../inbox-claude/unfurl.ts'
import { notify } from '../_shared/notify.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
function later(p: PromiseLike<unknown>) {
  const q = Promise.resolve(p).catch((e) => console.error('desk after-response failed', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(q)
}

const env = (k: string) => Deno.env.get(k)
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const ALLOWED = env('INBOX_CLAUDE_ALLOWED_USER_ID')
const TICK_SECRET = env('DESK_TICK_SECRET')

const MAX_TEXT = 6000
const MAX_ATTACH = 4
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 40
const DESK_URL = 'https://ivanmanfre.github.io/ivan-inbox/#exp/d/content/desk'

function cors(origin: string | null): Record<string, string> {
  const ok = !!origin && (origin === 'https://ivanmanfre.github.io' || /^http:\/\/localhost:\d{4,5}$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'https://ivanmanfre.github.io',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-desk-eval, x-desk-fixtures',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'x-desk-model, x-desk-brief-chars',
    'Vary': 'Origin',
  }
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } })
}

// ---- brief cache (per isolate) ------------------------------------------------
// Kept while desk_brief_stamp() (a ~20 ms fingerprint of every table the brief
// reads) is unchanged, for at most 15 minutes; dropped on every desk write.
let briefCache: { at: number; fixtures: boolean; stamp: string; json: BriefJson } | null = null
let panelCache: { at: number; panel: Record<string, unknown> } | null = null
const BRIEF_MAX_AGE_MS = 15 * 60_000
const PANEL_MAX_AGE_MS = 10 * 60_000
// deno-lint-ignore no-explicit-any
async function loadBrief(svc: any, fixtures: boolean, force = false): Promise<{ json: BriefJson; ms: number; cached: boolean }> {
  const t0 = Date.now()
  const stampP = svc.rpc('desk_brief_stamp').then((r: { data: unknown }) => String(r.data ?? ''), () => '')
  if (!force && briefCache && briefCache.fixtures === fixtures && Date.now() - briefCache.at < BRIEF_MAX_AGE_MS) {
    const stamp = await stampP
    if (stamp && stamp === briefCache.stamp) return { json: briefCache.json, ms: Date.now() - t0, cached: true }
  }
  // The calendar panel (slots, quotas, 48h profile views, booking reasons) is the slow ~1.2 s
  // part and changes slowly: it is reused for up to 10 minutes; the fast core is always fresh.
  const panelFresh = !force && !!panelCache && Date.now() - panelCache.at < PANEL_MAX_AGE_MS
  const [{ data, error }, stamp] = await Promise.all([svc.rpc('desk_brief_core', { p_fixtures: fixtures, p_with_panel: !panelFresh }), stampP])
  if (error || !data) throw new Error(`brief failed: ${error?.message ?? 'empty'}`)
  const json = data as BriefJson
  if (panelFresh) json.panel = panelCache!.panel
  else if ((json.panel as { ok?: boolean })?.ok !== false) panelCache = { at: Date.now(), panel: json.panel }
  briefCache = { at: Date.now(), fixtures, stamp, json }
  return { json, ms: Date.now() - t0, cached: false }
}

function invalidate() { briefCache = null }

let flagCache: { at: number; value: Record<string, unknown> } | null = null
// deno-lint-ignore no-explicit-any
async function flags(svc: any, fresh = false): Promise<Record<string, unknown>> {
  if (!fresh && flagCache && Date.now() - flagCache.at < 20_000) return flagCache.value
  const { data } = await svc.from('desk_config').select('key, value')
  const value = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]))
  flagCache = { at: Date.now(), value }
  return value
}

// Verified tokens, cached for their own lifetime (max 5 min) so a second message
// does not pay another auth round trip. Same check as getUser: the cache only
// ever holds a token getUser already accepted for the allowlisted id.
const tokenCache = new Map<string, number>()
// deno-lint-ignore no-explicit-any
async function verify(jwt: string): Promise<{ id: string } | { error: string; status: number }> {
  const until = tokenCache.get(jwt)
  if (until && until > Date.now()) return { id: ALLOWED! }
  const { data: who, error } = await createClient(SUPABASE_URL!, ANON!, { auth: { persistSession: false } }).auth.getUser(jwt)
  if (error || !who?.user) return { error: 'invalid_token', status: 401 }
  if (who.user.id !== ALLOWED) return { error: 'forbidden_user', status: 403 }
  let exp = Date.now() + 5 * 60_000
  try { const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (typeof p.exp === 'number') exp = Math.min(exp, p.exp * 1000 - 30_000) } catch { /* keep 5 min */ }
  if (tokenCache.size > 50) tokenCache.clear()
  tokenCache.set(jwt, exp)
  return { id: who.user.id }
}

// The drafts Ivan's Review actually shows, read with his own session (the view's guard needs it).
// deno-lint-ignore no-explicit-any
async function visibleDrafts(userDb: any): Promise<Map<string, boolean> | null> {
  try {
    const { data, error } = await userDb.from('cb34_p2_safe_drafts').select('id, cb34_p2_member')
      .is('client_id', null).in('status', ['review', 'approved', 'error', 'generating']).limit(1000)
    if (error || !Array.isArray(data)) return null
    return new Map(data.map((r: { id: string; cb34_p2_member: boolean | null }) => [r.id, r.cb34_p2_member === true]))
  } catch { return null }
}

// deno-lint-ignore no-explicit-any
async function recentMessages(svc: any, userId: string, evalMode = false) {
  // Eval items are independent questions: they carry no history. Real turns never see eval rows.
  if (evalMode) return []
  const { data } = await svc.from('desk_messages').select('role, origin, body, created_at, meta')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(30)
  return (data ?? []).filter((m: { meta?: { test?: boolean } }) => m.meta?.test !== true).slice(0, 11).reverse()
}
// deno-lint-ignore no-explicit-any
async function openJobs(svc: any, userId: string) {
  const { data } = await svc.from('desk_t3_jobs').select('title, status, created_at, t3_link')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(5)
  return data ?? []
}

// deno-lint-ignore no-explicit-any
async function runReads(svc: any, r: Rendered, reads: Act[]): Promise<string> {
  const out: string[] = []
  for (const rd of reads.slice(0, 3)) {
    if (rd.kind === 'read_draft') {
      const h = String(rd.draft ?? '').toLowerCase()
      const d = r.drafts.get(h.startsWith('#') ? h : '#' + h)
      if (!d) { out.push(`read_draft ${h}: no such draft`); continue }
      const { data } = await svc.from('carousel_drafts').select('post_body, qa').eq('id', d.id).maybeSingle()
      out.push(`read_draft ${h} ("${d.first_line.slice(0, 60)}"):\n${String(data?.post_body ?? '').slice(0, 3500)}\nQA feedback: ${String((data?.qa as { feedback?: string } | null)?.feedback ?? '').slice(0, 500)}`)
    } else if (rd.kind === 'read_posts') {
      const words = String(rd.q ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 2).slice(0, 4)
      if (!words.length) { out.push('read_posts: no search words'); continue }
      let q = svc.from('own_posts').select('posted_at, post_text, num_impressions, num_likes, num_comments')
        .gte('posted_at', new Date(Date.now() - 120 * 86400e3).toISOString()).order('posted_at', { ascending: false }).limit(8)
      for (const w of words) q = q.ilike('post_text', `%${w}%`)
      const { data } = await q
      out.push(`read_posts "${words.join(' ')}": ` + ((data ?? []).map((p: { posted_at: string; post_text: string; num_impressions: number; num_likes: number; num_comments: number }) =>
        `\n- ${p.posted_at.slice(0, 10)} "${String(p.post_text ?? '').split('\n')[0].slice(0, 90)}": ${p.num_impressions ?? '?'} impressions, ${p.num_likes ?? 0} likes, ${p.num_comments ?? 0} comments`).join('') || ' none found'))
    }
  }
  return out.join('\n\n')
}

// ---- the turn ------------------------------------------------------------------
type SendBody = { text?: unknown; client_key?: unknown; attachments?: unknown; voice?: unknown; chip?: unknown }

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin)
  if (!SUPABASE_URL || !ANON || !SERVICE || !ALLOWED) return json({ error: 'desk_not_configured' }, 503, origin)
  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

  // ---- server door: the trigger tick -----------------------------------------
  const secret = req.headers.get('x-desk-secret')
  if (secret !== null) {
    if (!TICK_SECRET || secret !== TICK_SECRET) return json({ error: 'unauthorized' }, 401, origin)
    const body = await req.json().catch(() => ({})) as { op?: string; now?: string; dry?: boolean }
    if (body.op !== 'tick') return json({ error: 'bad_op' }, 400, origin)
    return json(await tick(svc, { dry: body.dry === true }), 200, origin)
  }

  // ---- browser door ---------------------------------------------------------
  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return json({ error: 'unauthenticated' }, 401, origin)
  const [who, body, cfg] = await Promise.all([
    verify(jwt),
    req.json().catch(() => null) as Promise<Record<string, unknown> | null>,
    flags(svc),
  ])
  if ('error' in who) return json({ error: who.error }, who.status, origin)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_json' }, 400, origin)
  const userId = who.id
  const userDb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const evalMode = req.headers.get('x-desk-eval') === '1'
  const fixtures = evalMode && req.headers.get('x-desk-fixtures') === '1'
  // eval only: dry = plan and echo every action but write nothing; t3Test = the cloud thread only replies a plan
  const dry = evalMode && req.headers.get('x-desk-dry') === '1'
  const t3Test = evalMode && req.headers.get('x-desk-t3-test') === '1'
  const op = String(body.op ?? '')
  if (cfg.desk_enabled !== true && !evalMode) return json({ error: 'desk_off' }, 403, origin)

  if (op === 'warm') {
    later(loadBrief(svc, fixtures, true))
    return json({ ok: true }, 200, origin)
  }
  if (op === 'undo' || op === 'commit' || op === 'cancel') {
    return json(await settle(svc, userDb, userId, op, String(body.action_id ?? ''), dry), 200, origin)
  }
  if (op !== 'send') return json({ error: 'bad_op' }, 400, origin)
  return await send(req, origin, svc, userDb, userId, body as SendBody, { evalMode, fixtures, dry, t3Test, t3On: cfg.t3_enabled === true || evalMode })
})

// deno-lint-ignore no-explicit-any
async function send(_req: Request, origin: string | null, svc: any, userDb: any, userId: string, body: SendBody,
  mode: { evalMode: boolean; fixtures: boolean; dry: boolean; t3Test: boolean; t3On: boolean }): Promise<Response> {
  const t0 = Date.now()
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const clientKey = typeof body.client_key === 'string' ? body.client_key.slice(0, 80) : crypto.randomUUID()
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a): a is { kind: string; url: string; name?: string } => !!a && typeof a === 'object' && typeof (a as { url?: unknown }).url === 'string' && /^https:\/\//.test((a as { url: string }).url))
    .slice(0, MAX_ATTACH).map((a) => ({ kind: a.kind === 'photo' ? 'photo' : 'link', url: a.url.slice(0, 1000), ...(a.name ? { name: String(a.name).slice(0, 120) } : {}) }))
  if (!text && !attachments.length) return json({ error: 'empty' }, 400, origin)
  if (text.length > MAX_TEXT) return json({ error: 'too_long' }, 413, origin)

  const userMeta = { attachments, voice: body.voice === true, chip: body.chip === true, ...(mode.evalMode ? { test: true } : {}) }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const emit = (ev: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`))
      const timings: Record<string, number> = {}
      let toolCalls = 0
      try {
        // the user's row (idempotent on client_key: a retried send is the same message) and the
        // rate cap run alongside the brief read, so the model call starts as early as possible
        const saveUser = (async () => {
          const { data, error } = await svc.from('desk_messages').insert({ user_id: userId, role: 'user', origin: 'operator', body: text, meta: userMeta, client_key: clientKey }).select('id').single()
          if (!error) return data as { id: string }
          const { data: again } = await svc.from('desk_messages').select('id').eq('user_id', userId).eq('client_key', clientKey).maybeSingle()
          if (!again) throw new Error('save_failed')
          return again as { id: string }
        })()
        const rate = svc.from('desk_messages').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('role', 'user').gte('created_at', new Date(Date.now() - RATE_WINDOW_MS).toISOString())
        const rest = Promise.all([rate, loadBrief(svc, mode.fixtures), recentMessages(svc, userId, mode.evalMode), openJobs(svc, userId), visibleDrafts(userDb)])
        const userRow = await saveUser
        emit('ack', { user_message_id: userRow.id, client_key: clientKey })
        const [rateRes, brief, recent, jobs, visible] = await rest
        if ((rateRes.count ?? 0) > RATE_MAX) throw new LlmError('rate_limited', 'Too many messages in 10 minutes.')
        timings.ack_ms = Date.now() - t0
        timings.brief_ms = brief.ms
        later(sweepT3Stalls(svc))
        const r = render(applyVisibility(brief.json, visible), recent.filter((m: { role: string; body: string; created_at: string }) => !(m.role === 'user' && m.body === text && Date.now() - Date.parse(m.created_at) < 60_000)).slice(-10), jobs)
        let prompt = buildPrompt({ brief: r.text, message: text || '(no text, see attachment)', attachments, voice: body.voice === true })
        // Token streaming through the proxy's opt-in stream (DESK_STREAM=1): the reply reaches
        // the phone as it is written. Otherwise the whole answer goes out the moment it exists.
        const streaming = env('DESK_STREAM') === '1'
        let streamed = false
        const onReply = (t: string) => {
          if (!t) return
          if (!streamed) { streamed = true; timings.ttft_ms = Date.now() - t0 }
          emit('delta', { text: plain(t) })
        }
        const ask = (p: string) => streaming ? askDeskStream(p, onReply) : askDesk(p)
        const m1 = await ask(prompt)
        timings.model_ms = m1.ms; if (m1.hedged) timings.hedged = 1
        let parsed = parse(m1.text)
        if (parsed.reads.length && !parsed.actions.length) {
          toolCalls += parsed.reads.length
          const results = await runReads(svc, r, parsed.reads)
          prompt = buildPrompt({ brief: r.text, message: text, attachments, voice: body.voice === true, readResults: results })
          const m2 = await ask(prompt)
          timings.model_ms += m2.ms
          parsed = parse(m2.text)
        }
        if (!parsed.reply && !parsed.actions.length && !parsed.reads.length) {
          // an empty answer is never shown as an answer: ask once more, buffered
          const again = await askDesk(prompt)
          timings.model_ms += again.ms; timings.retried = 1
          parsed = parse(again.text)
        }
        const reply = parsed.reply || (parsed.actions.length ? 'On it.' : 'I could not put an answer together. Send it again?')
        if (!streamed) {
          timings.ttft_ms = Date.now() - t0
          for (let i = 0; i < reply.length; i += 400) emit('delta', { text: reply.slice(i, i + 400) })
        }

        // insert the assistant row now so actions can reference it
        const { data: aRow } = await svc.from('desk_messages').insert({
          user_id: userId, role: 'assistant', origin: 'desk', body: reply, status: 'streaming',
          meta: { model: m1.model, ...(mode.evalMode ? { test: true } : {}) },
        }).select('id').single()
        const messageId = aRow?.id as string

        const ctx: Ctx = {
          userDb, svc, userId, messageId, brief: r, attachments, text, env,
          unfurl: async (u) => { try { const x = await unfurl(u); return x.ok ? { title: x.title, description: x.description, author: x.author } : null } catch { return null } },
          t3: mode.t3On ? async ({ title, brief: b }) => {
            const j = mode.t3Test
              ? await queueT3Job(svc, { userId, messageId, title: `[test] ${title}`, brief: `TEST RUN from the desk eval. Do NOT do this job. Reply with a 3-line plan for it, then stop.\n\nThe job:\n${b}` })
              : await queueT3Job(svc, { userId, messageId, title, brief: b })
            return { job_id: j.job_id ?? '', status: j.status, error: j.error }
          } : undefined,
        }
        const echoes: ActionEcho[] = []
        let chips = parsed.chips
        let wrote = false
        for (const act of parsed.actions.slice(0, 6)) {
          toolCalls++
          const p = await plan(ctx, act)
          if (mode.dry && p.run) { const label = p.echo.label; p.run = async () => ({ result: { dry: true, label } }) }
          const { data: aRec } = await svc.from('desk_actions').insert({
            user_id: userId, message_id: messageId, kind: p.echo.kind, target_id: p.echo.target ? ctx.brief.drafts.get(p.echo.target.handle)?.id ?? null : null,
            args: { ...act, ...(mode.fixtures ? { _fixtures: true } : {}), ...(mode.dry ? { _dry: true } : {}) }, result: { state: p.echo.state, refuse: p.refuse ?? null },
          }).select('id').single()
          const echo: ActionEcho = { id: aRec?.id ?? crypto.randomUUID(), ...p.echo }
          if (p.chips?.length) chips = [...p.chips, ...chips].slice(0, 3)
          if (p.run && p.echo.state === 'done') {
            try {
              const res = await p.run()
              wrote = true
              if (res.detail) echo.detail = res.detail
              if (res.t3_job) echo.t3_job = res.t3_job
              if (!res.undo) echo.undo = false
              await svc.from('desk_actions').update({ result: { state: 'done', value: res.result ?? null }, undo: res.undo ?? null }).eq('id', echo.id)
            } catch (e) {
              echo.state = 'failed'; echo.undo = false
              echo.label = `Could not do it: ${plain(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
              await svc.from('desk_actions').update({ result: { state: 'failed', error: String(e).slice(0, 300) } }).eq('id', echo.id)
            }
          }
          echoes.push(echo)
        }
        if (wrote) invalidate()
        // The reply streamed before the actions ran. If one failed, say so in the body too, so the
        // text never claims a change that did not happen.
        const failedEchoes = echoes.filter((e) => e.state === 'failed' && !['ambiguous', 'line_mismatch'].includes(e.detail ?? ''))
        let finalBody = reply
        if (failedEchoes.length) {
          const note = failedEchoes.map((e) => e.label).join(' ')
          finalBody = `${reply}\n\nThat did not go through: ${note}`
          emit('delta', { text: `\n\nThat did not go through: ${note}` })
        }
        timings.total_ms = Date.now() - t0
        const t3 = echoes.find((e) => e.t3_job)?.t3_job
        const meta = {
          model: m1.model, timings, tool_calls: toolCalls, brief_chars: r.text.length,
          ...(echoes.length ? { actions: echoes } : {}), ...(chips.length ? { chips } : {}), ...(t3 ? { t3_job: t3 } : {}),
          ...(mode.evalMode ? { test: true } : {}),
        }
        const { data: final } = await svc.from('desk_messages').update({ status: 'done', body: finalBody, meta, updated_at: new Date().toISOString() })
          .eq('id', messageId).select('*').single()
        emit('final', { message: final })
      } catch (e) {
        const code = e instanceof LlmError ? e.code : 'desk_failed'
        const detail = e instanceof Error ? e.message.slice(0, 300) : String(e)
        console.error('desk turn failed', code, detail)
        const { data: errRow } = await svc.from('desk_messages').insert({
          user_id: userId, role: 'assistant', origin: 'desk', status: 'error',
          body: 'The desk could not answer just now. Send it again in a moment.', meta: { error: code, ...(mode.evalMode ? { test: true } : {}) },
        }).select('*').single()
        emit('error', { error: code, detail })
        if (errRow) emit('final', { message: errRow })
      } finally {
        ctl.close()
      }
    },
  })
  return new Response(stream, {
    headers: { ...cors(origin), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'x-desk-model': DESK_MODEL() },
  })
}

// ---- undo / commit / cancel ------------------------------------------------
// deno-lint-ignore no-explicit-any
async function settle(svc: any, userDb: any, userId: string, op: string, actionId: string, dryReq = false) {
  if (!/^[0-9a-f-]{36}$/i.test(actionId)) return { ok: false, error: 'bad_action' }
  const { data: a } = await svc.from('desk_actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle()
  if (!a) return { ok: false, error: 'not_found' }
  const state = (a.result as { state?: string } | null)?.state
  let newState: ActionEcho['state'] | null = null
  let label: string | null = null
  if (op === 'undo') {
    if (state !== 'done' || a.undone_at || !a.undo) return { ok: false, error: 'nothing_to_undo' }
    try { await runUndo({ userDb, svc }, a.undo) } catch (e) { return { ok: false, error: String(e).slice(0, 200) } }
    await svc.from('desk_actions').update({ undone_at: new Date().toISOString(), result: { ...(a.result ?? {}), state: 'undone' } }).eq('id', actionId)
    newState = 'undone'; label = 'Undone.'
  } else if (op === 'cancel') {
    if (state !== 'held') return { ok: false, error: 'not_held' }
    await svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: 'cancelled' } }).eq('id', actionId)
    newState = 'cancelled'; label = 'Cancelled. Nothing changed.'
  } else {
    if (state !== 'held') return { ok: false, error: 'not_held' }
    if (Date.now() - Date.parse(a.created_at) > 5 * 60 * 1000) return { ok: false, error: 'hold_expired' }
    // rebuild the same plan against a fresh brief and run it
    const [b, recent] = await Promise.all([loadBrief(svc, !!(a.args as { _fixtures?: boolean })?._fixtures || false, true), recentMessages(svc, userId)])
    const r = render(b.json, recent)
    const ctx: Ctx = { userDb, svc, userId, messageId: a.message_id, brief: r, attachments: [], text: '', env }
    // the brief may be rebuilt without fixtures; retry with fixtures when the draft is a fixture
    let p = await plan(ctx, a.args as Act)
    if (p.refuse === 'unknown_draft') {
      const b2 = await loadBrief(svc, true, true)
      ctx.brief = render(b2.json, recent)
      p = await plan(ctx, a.args as Act)
    }
    if (!p.run || p.echo.state !== 'held') {
      await svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: 'failed', error: p.refuse ?? 'changed' } }).eq('id', actionId)
      newState = 'failed'; label = 'The post changed since, so I did nothing.'
    } else {
      try {
        const isDry = dryReq || (a.args as { _dry?: boolean })?._dry === true
        const res = isDry ? { result: { dry: true } } : await p.run()
        await svc.from('desk_actions').update({ result: { state: 'done', value: res.result ?? null } }).eq('id', actionId)
        newState = 'done'
        label = p.echo.label.replace(/^Approving/, 'Approved').replace(/^Deleting/, 'Deleted').replace(/^Taking (.*) off the schedule$/, 'Took $1 off the schedule')
      } catch (e) {
        await svc.from('desk_actions').update({ result: { state: 'failed', error: String(e).slice(0, 300) } }).eq('id', actionId)
        newState = 'failed'; label = `Could not do it: ${plain(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
      }
    }
    invalidate()
  }
  if (op === 'undo') invalidate()
  // reflect the new state in the message's echo
  const { data: msg } = await svc.from('desk_messages').select('id, meta').eq('id', a.message_id).maybeSingle()
  if (msg) {
    const meta = msg.meta ?? {}
    // after a commit, undo, cancel or failure nothing more can be undone from the echo
    const actions = (meta.actions ?? []).map((x: ActionEcho) => x.id === actionId ? { ...x, state: newState, label: label ?? x.label, undo: false } : x)
    const { data: updated } = await svc.from('desk_messages').update({ meta: { ...meta, actions }, updated_at: new Date().toISOString() }).eq('id', msg.id).select('*').single()
    return { ok: newState !== 'failed', message: updated }
  }
  return { ok: newState !== 'failed' }
}

// ---- proactive tick -----------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function tick(svc: any, opts: { dry: boolean }) {
  const cfg = await flags(svc)
  if (cfg.triggers_enabled !== true && !opts.dry) return { ok: true, skipped: 'triggers_off' }
  await sweepT3Stalls(svc)
  const b = await loadBrief(svc, false, true)
  const r = render(b.json)
  const { data: ledger } = await svc.from('desk_triggers').select('kind, dedupe_key, fired_at, suppressed')
    .gte('fired_at', new Date(Date.now() - 21 * 86400e3).toISOString())
  const { data: done } = await svc.from('desk_t3_jobs').select('id, title, updated_at').in('status', ['done', 'failed'])
    .gte('updated_at', new Date(Date.now() - 2 * 86400e3).toISOString())
  const cap = Number(cfg.proactive_week_cap ?? 5) || 5
  const planned = planTriggers({
    now: new Date().toISOString(), weeks: r.weeks,
    posts: ((b.json.posts as { posts?: [] }).posts ?? []),
    callLines: b.json.call_lines ?? [], queue: b.json.queue ?? [],
    drafts: (b.json.drafts ?? []).map((d) => ({ first_line: d.first_line, belief: d.belief, vehicle: d.vehicle, is_copy: d.is_copy, status: d.status, scheduled_at: d.scheduled_at })),
    t3Done: (done ?? []).map((j: { id: string; title: string; updated_at: string }) => ({ id: j.id, title: j.title, at: j.updated_at })),
    ledger: ledger ?? [], cap,
  })
  if (opts.dry) return { ok: true, dry: true, planned }
  const fired: string[] = []
  for (const p of planned) {
    // claim the dedupe key first: a second tick racing this one cannot fire it twice
    const { data: claim, error } = await svc.from('desk_triggers').insert({ kind: p.kind, dedupe_key: p.dedupe_key, payload: { artifact: p.artifact } }).select('id').single()
    if (error || !claim) continue
    if (p.kind === 't3_done') { fired.push(p.dedupe_key); continue } // the report RPC already wrote the message
    const { data: m } = await svc.from('desk_messages').insert({
      user_id: ALLOWED, role: 'assistant', origin: 'proactive', body: plain(p.body),
      meta: { trigger: p.kind, artifact: p.artifact, ...(p.chips.length ? { chips: p.chips } : {}) },
    }).select('id').single()
    if (m) {
      await svc.from('desk_triggers').update({ message_id: m.id }).eq('id', claim.id)
      try {
        await notify(svc, { family: 'content_desk', source: 'content-desk', dedupe_key: `desk:${p.dedupe_key}`, severity: 'info',
          title: 'Content Desk', body: plain(p.body).slice(0, 140), url: DESK_URL, push: true, tenant: 'ivan' })
      } catch (e) { console.warn('desk push failed', String(e).slice(0, 200)) }
    }
    fired.push(p.dedupe_key)
  }
  return { ok: true, fired }
}
