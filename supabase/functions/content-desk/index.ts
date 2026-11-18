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

import { createClient } from 'npm:@supabase/supabase-js@2.119.0'   // pinned: 2.119.1's storage-js was missing from the bundler registry (11-18)
import { render, applyVisibility, warsaw, type BriefJson, type Rendered } from './brief.ts'
import { buildPrompt } from './prompt.ts'
import { parse, shortParagraphs, oneText, sanitize, HandleStream, type Act } from './parse.ts'
import { askDesk, askDeskStream, LlmError, DESK_MODEL } from './llm.ts'
import { planLive, planForTarget, runUndo, UndoRefused, lockCode, stillSame, actionKey, journalArgs, confirmMatches, draftRef, HOLD_EXPIRE_MS, type Confirmation, type ActionEcho, type Ctx, type Planned, type Snapshot } from './actions.ts'
import { authorize } from './auth.ts'
import { planTriggers } from './triggers.ts'
import { queueT3Job, sweepT3Stalls } from '../_shared/desk-t3.ts'
import { deskUnfurl } from './unfurl.ts'
import { notify } from '../_shared/notify.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
function later(p: PromiseLike<unknown>, op = 'after_response') {
  // logs a stable op name and an error code only, never the error text (Sol r2 #13)
  const q = Promise.resolve(p).catch((e) => console.error('desk later failed', op, e instanceof LlmError ? e.code : (e instanceof Error ? e.name : 'error')))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(q)
}

const env = (k: string) => Deno.env.get(k)
const SUPABASE_URL = env('SUPABASE_URL')
const ANON = env('SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const ALLOWED = env('INBOX_CLAUDE_ALLOWED_USER_ID')
const TICK_SECRET = env('DESK_TICK_SECRET')

const MAX_TEXT = 6000
// A held action can be committed for this long after it was proposed; the client auto-commits only
// holds delivered live while the desk is visible (older ones need an explicit tap).
const MAX_ATTACH = 4
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 60
const DESK_URL = 'https://ivanmanfre.github.io/ivan-inbox/#exp/d/content/desk'

/** Try a write up to three times; true when one succeeded. */
async function retry3(op: () => PromiseLike<{ error: unknown }>): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try { const { error } = await op(); if (!error) return true } catch { /* try again */ }
    await new Promise((r) => setTimeout(r, 150 * (i + 1)))
  }
  return false
}

// Stable codes and fixed client text: no upstream or database text ever reaches the browser or the logs.
const CLIENT_TEXT: Record<string, string> = {
  rate_limited: 'Too many messages in 10 minutes. Give it a minute.',
  desk_llm_unavailable: 'The desk model did not answer. Send it again in a moment.',
  desk_llm_not_configured: 'The desk is not set up right now.',
  turn_in_progress: 'That message is still being answered.',
  key_mismatch: 'That message id was already used for a different message.',
  desk_failed: 'The desk could not answer just now. Send it again in a moment.',
}
const safeCode = (c: string) => (c in CLIENT_TEXT ? c : 'desk_failed')
// Plain, fixed reasons for a failed action (no raw database text in the chat).
function failText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (e instanceof UndoRefused) return m === 'changed_since' ? 'It was changed again since, so I left it as it is.' : 'That post is gone.'
  const known: Record<string, string> = {
    qa_override_missing: 'It failed its quality check, and you did not say to approve it anyway.',
    queue_cancel_failed: 'I could not clear its queued copy, so I deleted nothing.',
    writer_unavailable: 'The writer did not take it. Nothing changed.',
    writer_unconfirmed: 'The writer did not confirm in time. It may still run.',
    idea_not_ours: 'That call line belongs to another workspace, so I left it.',
    t3_queue_failed: 'The cloud job could not be queued.',
    past_date: 'That time is in the past.', bad_status: 'The post is not in a state that allows this.',
    not_found: 'That post is gone.', changed: 'The post changed since, so I did nothing.',
    no_queue_row: 'Its queued copy is no longer there, so I pulled nothing.', queue_changed: 'Its queued copy changed since, so I pulled nothing.',
    write_failed: 'The write did not confirm. Check the post before trying again.', queue_still_live: 'It still has a queued copy, so I deleted nothing.',
    gone: 'That post is gone or no longer in your Review.', queue_read_failed: 'I could not read its queue, so I did nothing.',
    brain_draft: 'Brain drafts take Keep or Drop in Review.', pull_instead: 'It has a queued copy, so I did nothing. Pull it instead.', failed_release: 'The writer did not run, and the draft may show as generating. Open it in Review.',
    dated_mismatch: 'That post is not on the day you named, so I did nothing.', not_saved: 'That answer was never saved, so this action cannot run.',
    posting_now: 'It is being published right now, so I left it.', next_changed: 'Its queued copy changed since, so I pulled nothing.',
    next_gone: 'It is no longer scheduled, so I pulled nothing.', next_busy: 'It is being changed right now, so I did nothing. Try again in a minute.',
    calendar_busy: 'The calendar is busy right now, so I did nothing. Try again in a minute.', duplicate_photo: 'That photo is already on the post.',
    too_many_photos: 'The post already has the most photos it can take.', not_single_photo: 'That post type does not take a photo.',
    published: 'It is already published.', refused: 'The app refused it, so nothing changed.',
    human_edited: 'It has your hand edits, and the writer will not overwrite them.',
    in_queue: 'This one is already in the queue. Move it in the calendar.', no_action: 'I could not match this to its saved action, so I did nothing.',
    claim_failed: 'I could not reach the database, so nothing ran. Tap again.', undo_failed: 'The undo did not go through, so I left it as it is.',
  }
  // the exact code first (queue_changed must never read as changed), then a code inside a longer message
  if (known[m]) return known[m]
  for (const [k, v] of Object.entries(known)) if (m.includes(k)) return v
  return 'Something went wrong, so nothing changed.'
}

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
let panelCache: { at: number; panel: Record<string, unknown>; pv: string } | null = null
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
  // the panel is reused only while its profile-view fingerprint is unchanged: a new or newly classified
  // view changes the 48h counts, so the panel is rebuilt (round 12, S06)
  const stamp: string = await stampP
  const pvPart = stamp.split('|').find((x: string) => x.startsWith('pv:')) ?? ''
  const panelFresh = !force && !!panelCache && Date.now() - panelCache.at < PANEL_MAX_AGE_MS && !!pvPart && panelCache.pv === pvPart
  const { data, error } = await svc.rpc('desk_brief_core', { p_fixtures: fixtures, p_with_panel: !panelFresh })
  if (error || !data) throw new Error(`brief failed: ${error?.message ?? 'empty'}`)
  const json = data as BriefJson
  // published draft -> its published post URLs (own_posts link), so the last-post list matches posts by link, never by text (Sol r5 B7)
  const pubIds = (json.drafts ?? []).filter((d) => d.status === 'published').map((d) => d.id)
  if (pubIds.length) json.post_links = await postLinks(svc, pubIds)
  else json.post_links = {}
  json.post_vehicles = await postVehicles(svc, ((json.posts as { posts?: { url?: string }[] }).posts ?? []).map((p) => p.url).filter((u): u is string => !!u))
  if (panelFresh) json.panel = panelCache!.panel
  else if ((json.panel as { ok?: boolean })?.ok !== false) panelCache = { at: Date.now(), panel: json.panel, pv: pvPart }
  briefCache = { at: Date.now(), fixtures, stamp, json }
  return { json, ms: Date.now() - t0, cached: false }
}

function invalidate() { briefCache = null }

let bannedCache: { at: number; words: string[] } | null = null
/**
 * The live banned-word list (content_prompts slug forbidden-language, §1 "Banned Words"), read-only and
 * parsed exactly as the G4 check reads it. Cached like the brief (10 min). A failed read keeps the last list.
 */
// deno-lint-ignore no-explicit-any
async function bannedWords(svc: any): Promise<string[]> {
  if (bannedCache && Date.now() - bannedCache.at < BRIEF_MAX_AGE_MS) return bannedCache.words
  const { data, error } = await svc.from('content_prompts').select('body').eq('slug', 'forbidden-language').eq('scope', 'system').eq('is_active', true)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  if (error || !data?.body) return bannedCache?.words ?? []
  const fl = String(data.body)
  let sec = fl.slice(Math.max(0, fl.indexOf('1) Banned Words')))
  const end = sec.indexOf('2)')
  sec = sec.slice(0, end > 0 ? end : 6000)
  const words = [...new Set([...sec.matchAll(/\d+:1 ([^|\\]+?) \|/g)].map((m) => m[1].trim().toLowerCase())
    .filter((w) => !w.includes('(') && w !== 'banned word'))].sort()
  bannedCache = { at: Date.now(), words }
  return words
}

/**
 * Published post URL -> its labeled vehicle (the post labeler, cp17_post_labels, newest label), so a
 * lane's quota can sit next to the posts it governs (round 9 #5). Any failed read gives {}: no label.
 */
// deno-lint-ignore no-explicit-any
async function postVehicles(svc: any, urls: string[]): Promise<Record<string, string>> {
  if (!urls.length) return {}
  const { data: own, error } = await svc.from('own_posts').select('id, linkedin_url').in('linkedin_url', urls.slice(0, 60))
  if (error || !Array.isArray(own) || !own.length) return {}
  const urlOf = new Map<string, string>(own.map((o: { id: string; linkedin_url: string }) => [String(o.id), o.linkedin_url]))
  const { data: labels, error: lErr } = await svc.from('cp17_post_labels').select('own_post_id, vehicle, labeled_at').in('own_post_id', [...urlOf.keys()])
    .order('labeled_at', { ascending: false })
  if (lErr || !Array.isArray(labels)) return {}
  const out: Record<string, string> = {}
  for (const l of labels as { own_post_id: string; vehicle: string | null }[]) {
    const u = urlOf.get(String(l.own_post_id))
    if (u && l.vehicle && !(u in out)) out[u] = l.vehicle
  }
  return out
}

/**
 * Published draft id -> the URLs of its published post, by two links: own_posts.clickup_task_id = the
 * draft, and scheduled_posts.unipile_social_id (the post the publisher made) = own_posts.social_id
 * (Sol r5 B7, r6 #8). Any failed read gives null: the last-post list then guesses nothing.
 */
// deno-lint-ignore no-explicit-any
async function postLinks(svc: any, pubIds: string[]): Promise<Record<string, string[]> | null> {
  const [byTask, sent] = await Promise.all([
    svc.from('own_posts').select('clickup_task_id, linkedin_url').in('clickup_task_id', pubIds),
    svc.from('scheduled_posts').select('clickup_task_id, unipile_social_id').in('clickup_task_id', pubIds).not('unipile_social_id', 'is', null),
  ])
  if (byTask.error || sent.error) return null
  const m: Record<string, string[]> = {}
  const add = (id: string, u: string | null | undefined) => { if (id && u && !(m[id] ??= []).includes(u)) m[id].push(u) }
  for (const r of (byTask.data ?? []) as { clickup_task_id: string; linkedin_url: string | null }[]) add(r.clickup_task_id, r.linkedin_url)
  const bySocial = new Map<string, string>()
  for (const r of (sent.data ?? []) as { clickup_task_id: string; unipile_social_id: string }[]) bySocial.set(r.unipile_social_id, r.clickup_task_id)
  if (bySocial.size) {
    const { data, error } = await svc.from('own_posts').select('social_id, linkedin_url').in('social_id', [...bySocial.keys()])
    if (error) return null
    for (const r of (data ?? []) as { social_id: string; linkedin_url: string | null }[]) add(bySocial.get(r.social_id) ?? '', r.linkedin_url)
  }
  return m
}

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
async function runReads(svc: any, userDb: any, r: Rendered, reads: Act[]): Promise<string> {
  const out: string[] = []
  for (const rd of reads.slice(0, 3)) {
    if (rd.kind === 'read_draft') {
      const h = String(rd.draft ?? '').toLowerCase()
      const d = r.drafts.get(h.startsWith('#') ? h : '#' + h)
      if (!d) { out.push(`read_draft ${h}: no such draft`); continue }
      const { data } = await svc.from('carousel_drafts').select('post_body, qa, status').eq('id', d.id).is('client_id', null).maybeSingle()
      if (!data) { out.push(`read_draft ${h}: no such draft`); continue }
      if (['review', 'approved', 'error', 'generating'].includes(data.status) && !d.fixture) {
        const { data: vis } = await userDb.from('cb34_p2_safe_drafts').select('id').eq('id', d.id).maybeSingle()
        if (!vis) { out.push(`read_draft ${h}: not in his Review`); continue }
      }
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
    later(loadBrief(svc, fixtures, true), 'warm')
    return json({ ok: true }, 200, origin)
  }
  if (op === 'held_seen') {
    // the UI sends this when a held row is first visibly rendered; only then does the server clock run
    const ids = (Array.isArray(body.action_ids) ? body.action_ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10)
    return json(await heldSeen(svc, userDb, userId, ids, evalMode), 200, origin)
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

  // Sol r1 #5 / the UI's contract: one key = one turn. The user row is written before the stream:
  // a new key runs the turn; a known key with the same text and a stored answer gets ack + final and
  // runs nothing; a known key still being answered is 409 turn_in_progress; a known key with other
  // text or attachments is 409 key_mismatch. Nothing ever runs twice for one key.
  let userRow: { id: string }
  let replayAnswer: Record<string, unknown> | null = null
  {
    const { data, error } = await svc.from('desk_messages').insert({ user_id: userId, role: 'user', origin: 'operator', body: text, meta: userMeta, client_key: clientKey }).select('id').single()
    if (!error && data) userRow = data
    else {
      const { data: again, error: aErr } = await svc.from('desk_messages').select('id, body, meta, created_at').eq('user_id', userId).eq('client_key', clientKey).maybeSingle()
      if (aErr) return json({ error: 'turn_in_progress' }, 409, origin)   // a failed lookup is never "no turn" (Sol r6 #4)
      if (!again) return json({ error: 'desk_failed', detail: CLIENT_TEXT.desk_failed }, 500, origin)
      const prevAtt = ((again.meta as { attachments?: { kind?: string; url?: string; name?: string }[] } | null)?.attachments ?? [])
      const sameAtt = prevAtt.length === attachments.length &&
        prevAtt.every((a, i) => a?.kind === attachments[i].kind && a?.url === attachments[i].url && (a?.name ?? null) === ((attachments[i] as { name?: string }).name ?? null))
      if (again.body !== text || !sameAtt) return json({ error: 'key_mismatch' }, 409, origin)
      const { data: prior, error: pErr } = await svc.from('desk_messages').select('*').eq('user_id', userId).eq('role', 'assistant')
        .filter('meta->>reply_to', 'eq', again.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      // a failed answer lookup fails closed: it never reads as "no answer" (that would close a live turn)
      if (pErr) return json({ error: 'turn_in_progress' }, 409, origin)
      // Sol r5 B4: a turn without a terminal answer is "in progress" until no worker can still be alive
      // (RECOVER_AFTER_MS, far past the edge wall-clock limit). Only then may a same-key replay close it.
      if (!prior || prior.status === 'streaming') {
        const born = Date.parse(String((prior ?? again).created_at))
        if (!(Date.now() - born >= RECOVER_AFTER_MS)) return json({ error: 'turn_in_progress' }, 409, origin)
        const closed = prior ? await recoverTurn(svc, prior) : await closeUnanswered(svc, userId, again.id, clientKey, mode.evalMode)
        if (!closed) return json({ error: 'turn_in_progress' }, 409, origin)
        userRow = { id: again.id }
        replayAnswer = closed
      } else {
        userRow = { id: again.id }
        replayAnswer = prior
      }
    }
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const emit = (ev: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`))
      const timings: Record<string, number> = {}
      let toolCalls = 0
      let assistantId: string | null = null
      // this worker's claim on its answer row: the final and the error save are CAS'd on
      // (status streaming, this token), and so is recovery's close, so exactly one of them wins (Sol r5 B4)
      const turnToken = crypto.randomUUID()
      try {
        // the user's row (idempotent on client_key: a retried send is the same message) and the
        // rate cap run alongside the brief read, so the model call starts as early as possible
        const rate = svc.from('desk_messages').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('role', 'user').gte('created_at', new Date(Date.now() - RATE_WINDOW_MS).toISOString())
        const rest = Promise.all([rate, loadBrief(svc, mode.fixtures), recentMessages(svc, userId, mode.evalMode), openJobs(svc, userId), visibleDrafts(userDb), bannedWords(svc)])
        emit('ack', { user_message_id: userRow.id, client_key: clientKey })
        if (replayAnswer) { rest.catch(() => {}); emit('final', { message: forClient(replayAnswer) }); return }
        const [rateRes, brief, recent, jobs, visible, banned] = await rest
        if (!mode.evalMode && (rateRes.count ?? 0) > RATE_MAX) throw new LlmError('rate_limited', 'Too many messages in 10 minutes.')
        timings.ack_ms = Date.now() - t0
        timings.brief_ms = brief.ms
        later(sweepT3Stalls(svc), 't3_sweep')
        const r = render(applyVisibility(brief.json, visible ?? new Map()), recent.filter((m: { role: string; body: string; created_at: string }) => !(m.role === 'user' && m.body === text && Date.now() - Date.parse(m.created_at) < 60_000)).slice(-10), jobs)
        let prompt = buildPrompt({ brief: r.text, message: text || '(no text, see attachment)', attachments, voice: body.voice === true, banned })
        // Token streaming through the proxy's opt-in stream (DESK_STREAM=1): the reply reaches
        // the phone as it is written. Otherwise the whole answer goes out the moment it exists.
        const streaming = env('DESK_STREAM') === '1'
        let streamed = false
        // any model prose already shown: a write in the same turn is refused (Sol r10 #6)
        let proseReleased = false
        // call-line handles are stripped BEFORE a delta goes out: a short tail is held back across
        // delta boundaries so a split "L" + "1" is never shown (Sol r7 #8)
        const hs = new HandleStream(r.lines.keys())
        const onReply = (t: string) => {
          if (!t) return
          if (!streamed) { streamed = true; timings.ttft_ms = Date.now() - t0 }
          const out = hs.push(t)
          if (out) { proseReleased = true; emit('delta', { text: out }) }
        }
        // a write turn shows only server text (Sol r9 #4): the model acts first, no prose streams, and
        // one fixed status line goes out at once; the final body is the server echo from action results
        const WORKING = 'Working on it.'
        let writeShown = false
        const onWrite = () => {
          if (writeShown) return
          writeShown = true
          if (!streamed) { streamed = true; timings.ttft_ms = Date.now() - t0 }
          emit('delta', { text: WORKING })
        }
        const ask = (p: string) => streaming ? askDeskStream(p, onReply, { onWrite }) : askDesk(p)
        const m1 = await ask(prompt)
        timings.model_ms = m1.ms; if (m1.hedged) timings.hedged = 1
        let parsed = parse(m1.text)
        if (parsed.reads.length && !parsed.actions.length) {
          toolCalls += parsed.reads.length
          const results = await runReads(svc, userDb, r, parsed.reads)
          prompt = buildPrompt({ brief: r.text, message: text, attachments, voice: body.voice === true, readResults: results, banned })
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
        { const tail = hs.flush(); if (tail) { proseReleased = true; emit('delta', { text: tail }) } }
        if (!streamed) {
          timings.ttft_ms = Date.now() - t0
          if (parsed.actions.length) emit('delta', { text: WORKING })
          else {
            const shown = sanitize(reply, r.lines.keys())
            for (let i = 0; i < shown.length; i += 400) emit('delta', { text: shown.slice(i, i + 400) })
          }
        }

        // insert the assistant row now so actions can reference it
        const { data: aRow } = await svc.from('desk_messages').insert({
          user_id: userId, role: 'assistant', origin: 'desk', body: parsed.actions.length ? WORKING : sanitize(reply, r.lines.keys()), status: 'streaming',
          meta: { model: m1.model, reply_to: userRow.id, client_key: clientKey, turn_token: turnToken, ...(mode.evalMode ? { test: true } : {}) },
        }).select('id').single()
        if (!aRow?.id) throw new LlmError('desk_failed', 'answer row')
        const messageId = aRow.id as string
        assistantId = messageId

        const ctx: Ctx = {
          userDb, svc, userId, messageId, brief: r, attachments, text, env, fixtures: mode.fixtures,
          unfurl: (u) => deskUnfurl(u),
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
        // 1) plan every proposed action (no writes), and read the live row of every target BEFORE
        //    authorization, so the verifier sees the real state and every write is pinned to it
        const planned: { act: Act; p: Planned; snap: Snapshot | null }[] = []
        const seenKeys = new Set<string>()
        for (const act of parsed.actions.slice(0, 6)) {
          toolCalls++
          // resolve the handle, then plan from the LIVE row: what the verifier reads is what runs (Sol r3 P1a)
          const { p, snap } = await planLive(ctx, act)
          // one action per (kind, resolved target, the canonical args that kind's write consumes), before
          // authorization and journaling; a repeat is dropped, never verified, journaled or run (Sol r6 #3, r7 #2)
          const key = actionKey(p)
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          planned.push({ act, p, snap })
        }
        // 2) one reasoned check: did Ivan's own message ask for exactly this, with these values? (Sol r1 #1, r2 #1)
        const writable = planned.filter((x) => x.p.run)
        const describe = (x: { act: Act; p: Planned; snap: Snapshot | null }) => {
          const parts = [x.p.describe ?? x.p.echo.label]
          if (x.snap) parts.push(`(post status now: ${x.snap.status}; dated now: ${x.snap.scheduled_at ? warsaw(x.snap.scheduled_at) : 'no date'}${x.snap.queue ? `; queued copy ${x.snap.queue.status}` : ''})`)
          if (x.act.kind === 'approve') parts.push(`QA override: ${x.snap?.status === 'error' ? 'yes, it failed its check' : 'no'}`)
          if (x.act.kind === 'photo_attach' || x.act.kind === 'photo_stage') {
            const n = Number(x.act.photo ?? 1); const att = attachments.filter((a) => a.kind === 'photo')[n - 1]
            parts.push(`photo: attachment ${n}${att?.name ? ` (${att.name})` : ''}`)
          }
          // the canonical args (canonArgs) are what the write consumes: the verifier reads exactly those
          if (x.act.kind === 't3') parts.push(`job title: ${String(x.p.canon?.title ?? '')}; job brief: ${String(x.p.canon?.brief ?? '')}`)
          if (x.act.kind === 'link') parts.push(`url: ${String(x.p.canon?.url ?? '')}`)
          if (x.p.context) parts.push(x.p.context)
          return parts.join(' ')
        }
        const verdicts = await authorize(text, writable.map(describe))
        writable.forEach((x, i) => {
          if (verdicts[i]) {
            // server-owned: the override comes from the live status + the verifier, never from the model
            if (x.act.kind === 'approve' && x.snap?.status === 'error') x.act._qa_override = true
            return
          }
          // fixed text only, never the proposal or the verifier description; no chip carries it (Sol r7 #3)
          x.p.run = undefined
          x.p.refuse = 'not_asked'
          x.p.chips = undefined
          x.p.echo = { ...x.p.echo, state: 'failed', undo: false, hold_ms: undefined, detail: 'not_asked',
            label: 'I did not do that: you did not ask for it in this message.' }
        })
        // at most one cloud job per turn, chosen among the AUTHORIZED ones (Sol r7 #7)
        let t3s = 0
        for (const x of writable) {
          if (x.act.kind !== 't3' || !x.p.run) continue
          if (++t3s > 1) {
            x.p.run = undefined; x.p.refuse = 'one_t3'
            x.p.echo = { ...x.p.echo, state: 'failed', undo: false, label: 'I did not do that: one cloud job per message.' }
          }
        }
        // Sol r10 #6: model prose already reached his screen before the actions block: every write of the
        // turn is refused (the shown text could have claimed something the actions do not do)
        if (proseReleased) for (const x of planned) if (x.p.run) {
          x.p.run = undefined; x.p.refuse = 'prose_first'
          x.p.echo = { ...x.p.echo, state: 'failed', undo: false, hold_ms: undefined, label: 'I did not do that: say it again and I will set it up for your tap.' }
        }
        // Sol r8 #3: on any refusal, every model chip is dropped; only the server's own chips remain
        // (built from draft identity: an opener excerpt and a day, never a rejected argument)
        if (planned.some((x) => !x.p.run)) chips = []
        timings.auth_ms = Date.now() - t0
        // 3) a durable journal row first ('pending'), then the guarded write, then the terminal state
        const bodyLines: string[] = []
        for (const { act, p, snap } of planned) {
          if (p.display) {
            // an ambiguous or unresolved reference: a line and chips only, NO action entry (Sol r10 #10)
            bodyLines.push(p.echo.label)
            if (p.chips?.length) chips = [...p.chips, ...chips].slice(0, 3)
            continue
          }
          if (mode.dry && p.run) { const label = p.echo.label; p.run = async () => ({ result: { dry: true, label } }) }
          const immediate = !!p.run && p.echo.state === 'done'
          const { data: aRec, error: recErr } = await svc.from('desk_actions').insert({
            user_id: userId, message_id: messageId, kind: p.echo.kind, target_id: p.target_id ?? null,
            args: journalArgs(act, p, snap, mode, text),
            result: { state: immediate ? 'pending' : p.echo.state, refuse: p.refuse ?? null,
              ...(p.echo.state === 'held' ? { hold_ms: p.echo.hold_ms ?? 8000, expires_at: new Date(Date.now() + HOLD_EXPIRE_MS).toISOString() } : {}) },
          }).select('id').single()
          if (recErr || !aRec?.id) {
            echoes.push({ id: crypto.randomUUID(), ...p.echo, state: 'failed', undo: false, label: 'I could not record this action, so I did not do it.' })
            continue
          }
          const echo: ActionEcho = { id: aRec.id, ...p.echo }
          if (p.chips?.length) chips = [...p.chips, ...chips].slice(0, 3)   // server chips (identity only) first
          if (immediate) {
            let terminal: Record<string, unknown>
            let undo: Record<string, unknown> | null = null
            // a draft write's undo images were stored by its SQL function on this row: never overwritten here
            let undoInDb = false
            try {
              if (snap && !mode.dry && !await stillSame(svc, snap)) throw new Error('changed')
              const res = await p.run!(echo.id)
              wrote = true
              if (res.detail) echo.detail = res.detail
              if (res.t3_job) echo.t3_job = res.t3_job
              if (res.label) echo.label = res.label
              if (!res.undo && !res.undoInDb) echo.undo = false
              undo = res.undo ?? null
              undoInDb = res.undoInDb === true
              terminal = { state: 'done', value: res.result ?? null }
            } catch (e) {
              echo.state = 'failed'; echo.undo = false
              const stuck = e instanceof Error && e.message === 'failed_release'
              // a writer that refused but left the claim in place gets its own line and journal state (Sol r7 #5)
              echo.label = stuck ? failText(e) : `Could not do it: ${failText(e)}`
              console.error('desk action failed', echo.kind)
              terminal = { state: stuck ? 'failed_release' : 'failed', error: failText(e) }
            }
            if (!await retry3(() => svc.from('desk_actions').update(undoInDb ? { result: terminal } : { result: terminal, undo }).eq('id', echo.id))) {
              // the write happened; only its record failed: never invite a repeat (Sol r3 lost receipt)
              echo.detail = 'Done, but I could not record it. Check before repeating it.'
              echo.undo = false
            }
          }
          echoes.push(echo)
          // the body line: for a held draft action, a fixed label naming exactly what he will tap on
          if (echo.state === 'held') echo.label = proposedLine(act, p, snap)
          bodyLines.push(echo.state === 'held' ? `${echo.label} It runs only when you tap Do it now.` : echo.label + (echo.detail && !/^[a-z_]+$/.test(echo.detail) ? ` ${echo.detail}` : ''))
        }
        if (wrote) invalidate()
        // Sol r8 #5: write confirmations come only from action results. A turn that proposed a write
        // stores the server's own echo lines; the model's prose stays only when every proposed action
        // was done or held. If any was refused or failed, the body is the echo lines alone, and the UI
        // replaces the streamed text with this final body.
        // Sol r9 #4/#5: a turn with any action stores the server's echo lines only, never model prose.
        // A held action's line names what was asked with a fixed label that stays true ("Delete:
        // <opener>, held for Undo"); its live state lives only in the structured echo.
        let finalBody = reply
        if (parsed.actions.length) finalBody = bodyLines.length ? bodyLines.join('\n\n') : 'I did not do anything.'
        // lists render as plain Markdown (display only): no numbered references exist (round 14 #1)
        finalBody = shortParagraphs(sanitize(finalBody, r.lines.keys()))
        const sideEffects = await turnSideEffects(svc, messageId)
        timings.total_ms = Date.now() - t0
        const t3 = echoes.find((e) => e.t3_job)?.t3_job
        const meta = {
          model: m1.model, reply_to: userRow.id, client_key: clientKey, timings, tool_calls: toolCalls, brief_chars: r.text.length,
          ...(echoes.length ? { actions: echoes } : {}), ...(chips.length ? { chips: oneText(chips) } : {}), ...(t3 ? { t3_job: t3 } : {}),
          turn_token: turnToken, side_effects: sideEffects, ...(mode.evalMode ? { test: true } : {}),
        }
        // The final row (with its echoes) is the only thing that lets a hold arm: held_seen and commit
        // both require it (echoDurable). It is written only over this turn's own streaming row (a
        // replay that already rebuilt the turn wins), and a save whose response was lost is confirmed
        // by a reread before anything is cancelled (Sol r4 #7).
        let final: Record<string, unknown> | null = null
        for (let i = 0; i < 3 && !final; i++) {
          const { data } = await svc.from('desk_messages').update({ status: 'done', body: finalBody, meta, updated_at: new Date().toISOString() })
            .eq('id', messageId).eq('status', 'streaming').filter('meta->>turn_token', 'eq', turnToken).select('*').maybeSingle()
          final = data ?? null
          if (!final) {
            const { data: cur } = await svc.from('desk_messages').select('*').eq('id', messageId).maybeSingle()
            const cm = (cur?.meta ?? {}) as { recovered?: boolean; turn_token?: string }
            if (cur?.status === 'done' && !cm.recovered && cm.turn_token === turnToken && cur.body === finalBody) final = cur
            else if (cur && cur.status !== 'streaming') break   // recovery closed this turn: its record stands
          }
        }
        if (!final) {
          // The echo with its holds is not durably saved, so no hold may ever arm: cancel them all
          // (CAS held -> cancelled) and say so. Done actions stand; never invite a repeat (Sol r4).
          const held = echoes.filter((e) => e.state === 'held')
          for (const e of held) {
            const { data: a } = await svc.from('desk_actions').select('id, result').eq('id', e.id).maybeSingle()
            if (a) await claimState(svc, a, 'held', 'cancelled')
            e.state = 'cancelled'; e.undo = false; e.label = 'Cancelled: I could not save this answer.'
          }
          final = { id: messageId, role: 'assistant', origin: 'desk', status: 'done',
            body: shortParagraphs(`${finalBody}\n\n(I could not save this answer.${held.length ? ' The held actions were cancelled.' : ''} If an action is listed as done, check before repeating it.)`),
            meta: { ...meta, actions: echoes }, created_at: new Date().toISOString() }
        }
        emit('final', { message: forClient(final) })
      } catch (e) {
        const code = safeCode(e instanceof LlmError ? e.code : 'desk_failed')
        const detail = CLIENT_TEXT[code]
        console.error('desk turn failed', code)
        // settle the answer row this turn already opened, or open one, so nothing stays "streaming"
        // side effects of this turn (Sol r5 B11): no answer row yet = no action could have run = 'none'
        const sideEffects = assistantId ? await turnSideEffects(svc, assistantId) : 'none'
        const errFields = { status: 'error', body: detail,
          meta: { error: code, client_key: clientKey, reply_to: userRow.id, turn_token: turnToken, side_effects: sideEffects, ...(mode.evalMode ? { test: true } : {}) }, updated_at: new Date().toISOString() }
        let errRow: Record<string, unknown> | null = null
        if (assistantId) {
          const { data } = await svc.from('desk_messages').update(errFields).eq('id', assistantId).eq('status', 'streaming')
            .filter('meta->>turn_token', 'eq', turnToken).select('*').maybeSingle()
          errRow = data ?? null
          if (!errRow) { const { data: cur } = await svc.from('desk_messages').select('*').eq('id', assistantId).maybeSingle(); errRow = cur ?? null }
        } else {
          const { data } = await svc.from('desk_messages').insert({ user_id: userId, role: 'assistant', origin: 'desk', ...errFields }).select('*').single()
          errRow = data ?? null
          if (!errRow) {
            // one answer per user message (unique index) refused the insert: reread the row that holds it (Sol r7 #6)
            const won = await answerFor(svc, userRow.id)
            const wm = (won?.meta ?? {}) as { turn_token?: string }
            if (won && won.status === 'streaming' && wm.turn_token === turnToken) {
              // our own answer row whose insert response was lost: close it with the status+token CAS
              const { data: closed } = await svc.from('desk_messages').update(errFields).eq('id', won.id).eq('status', 'streaming')
                .filter('meta->>turn_token', 'eq', turnToken).select('*').maybeSingle()
              errRow = closed ?? await answerFor(svc, userRow.id)
            } else errRow = won
          }
        }
        // ONE place decides what goes out (Sol r8 #4): reread the answer; still streaming (another
        // worker's live turn, or our own close did not land) = turn_in_progress and never a final
        const settled = (await answerFor(svc, userRow.id)) ?? errRow
        if (!settled || settled.status === 'streaming') { emit('error', { error: 'turn_in_progress' }); return }
        emit('error', { error: code, detail })
        emit('final', { message: forClient(settled) })
      } finally {
        ctl.close()
      }
    },
  })
  return new Response(stream, {
    headers: { ...cors(origin), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'x-desk-model': DESK_MODEL() },
  })
}

const clipLine = (s: string, n = 70) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/**
 * Confirm-to-act (round 11): the held card's fixed body line names the exact resolved draft (its first
 * line up to 120 chars and its day, or "(no date)") and, for a move, the new date. It stays true after
 * the tap or a cancel: it says what was proposed, and the structured echo carries the state.
 */
function proposedLine(act: Act, p: Planned, snap: Snapshot | null): string {
  const VERB: Record<string, string> = { approve: 'approve', date: 'move', undate: 'remove the date from', pull: 'pull', delete: 'delete', redo: 'rewrite', photo_attach: 'add your photo to' }
  // the FULL opener (the UI wraps), a short distinct reference, the source date and, for a move, the new date (Sol r11 #2)
  const line = (p.echo.target?.first_line ?? '').replace(/\s+/g, ' ').trim()
  const ref = p.ref ?? ((act as { _ref?: string })._ref) ?? draftRef(p.target_id ?? '')
  const day = snap?.scheduled_at ? warsaw(snap.scheduled_at) : 'no date'
  const to = act.kind === 'date' && typeof p.canon?.at === 'string' ? ` to ${warsaw(p.canon.at)}` : ''
  return `Proposed (ref ${ref}): ${VERB[act.kind] ?? act.kind} "${line}" (${day})${to}.`
}


// ---- turn recovery and side effects (Sol r5 B4, B11) ----------------------------
/** No worker can still be alive after this (the edge wall-clock limit is far below it). */
const RECOVER_AFTER_MS = 10 * 60_000

/** 'none' only when the turn's journal has zero entries and no cloud job was queued for it; a failed read is 'unknown'. */
// deno-lint-ignore no-explicit-any
async function turnSideEffects(svc: any, messageId: string): Promise<'none' | 'some' | 'unknown'> {
  try {
    const [a, j] = await Promise.all([
      svc.from('desk_actions').select('id', { count: 'exact', head: true }).eq('message_id', messageId),
      svc.from('desk_t3_jobs').select('id', { count: 'exact', head: true }).eq('message_id', messageId),
    ])
    if (a.error || j.error || typeof a.count !== 'number' || typeof j.count !== 'number') return 'unknown'
    return a.count === 0 && j.count === 0 ? 'none' : 'some'
  } catch { return 'unknown' }
}

/**
 * Close a turn whose worker is gone (only called past RECOVER_AFTER_MS): held actions are CAS'd to
 * cancelled, anything still pending/committing is "Not confirmed", and the row is closed by a CAS on
 * status = streaming, so a late worker save and this close can never both land.
 */
// deno-lint-ignore no-explicit-any
async function recoverTurn(svc: any, prior: Record<string, any>): Promise<Record<string, unknown> | null> {
  const { data: acts, error } = await svc.from('desk_actions').select('id, kind, result').eq('message_id', prior.id)
  if (error) return null
  for (const a of (acts ?? []) as { id: string; result: Record<string, unknown> | null }[]) if (a.result?.state === 'held') await claimState(svc, a, 'held', 'cancelled')
  const { data: again } = await svc.from('desk_actions').select('id, kind, result').eq('message_id', prior.id)
  const actions = ((again ?? acts ?? []) as { id: string; kind: string; result: { state?: string } | null }[]).map((a) => {
    const st = a.result?.state ?? ''
    if (st === 'done') return { id: a.id, kind: a.kind, state: 'done', undo: false, label: 'Done (recorded).' }
    if (st === 'failed') return { id: a.id, kind: a.kind, state: 'failed', undo: false, label: 'Not done.' }
    if (st === 'failed_release') return { id: a.id, kind: a.kind, state: 'failed', undo: false, label: failText('failed_release') }
    if (st === 'cancelled' || st === 'undone') return { id: a.id, kind: a.kind, state: st, undo: false, label: st === 'cancelled' ? 'Cancelled. Nothing changed.' : 'Undone.' }
    return { id: a.id, kind: a.kind, state: 'failed', undo: false, detail: 'unconfirmed', label: 'Not confirmed: check before repeating it.' }
  })
  const sideEffects = await turnSideEffects(svc, String(prior.id))
  const { data: closed } = await svc.from('desk_messages').update({ status: 'done',
    body: 'This answer did not finish. Here is what was recorded; check Review before repeating anything.',
    meta: { ...(prior.meta ?? {}), actions, recovered: true, side_effects: sideEffects }, updated_at: new Date().toISOString() })
    .eq('id', prior.id).eq('status', 'streaming').select('*').maybeSingle()
  if (closed) return closed
  // the worker's own save won after all: that stored answer is the record
  const { data: cur } = await svc.from('desk_messages').select('*').eq('id', prior.id).maybeSingle()
  return cur && cur.status !== 'streaming' ? cur : null
}

/** A turn that died before it opened an answer row: nothing ran (actions need that row), so close it with side_effects 'none'. */
// deno-lint-ignore no-explicit-any
async function closeUnanswered(svc: any, userId: string, userMessageId: string, clientKey: string, evalMode: boolean): Promise<Record<string, unknown> | null> {
  const { data } = await svc.from('desk_messages').insert({ user_id: userId, role: 'assistant', origin: 'desk', status: 'error', body: CLIENT_TEXT.desk_failed,
    meta: { error: 'desk_failed', reply_to: userMessageId, client_key: clientKey, recovered: true, side_effects: 'none', ...(evalMode ? { test: true } : {}) } }).select('*').single()
  if (data) return data
  // the unique answer index refused a second row: reread the one that won; still streaming = in progress
  const won = await answerFor(svc, userMessageId)
  return won && won.status !== 'streaming' ? won : null
}

/** The one assistant answer of a user message (desk_messages_one_answer), or null. */
// deno-lint-ignore no-explicit-any
async function answerFor(svc: any, userMessageId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await svc.from('desk_messages').select('*').eq('role', 'assistant').filter('meta->>reply_to', 'eq', userMessageId).maybeSingle()
  return error ? null : (data ?? null)
}

/**
 * Every message the endpoint hands back goes through here (Sol r6 #5): stored chips are shown as one
 * text (label = send) whatever wrote them, and an older terminal answer with no side_effects says 'unknown'.
 */
// deno-lint-ignore no-explicit-any
function forClient(m: any): any {
  if (!m || typeof m !== 'object') return m
  const meta = { ...((m.meta ?? {}) as Record<string, unknown>) }
  if (Array.isArray(meta.chips)) meta.chips = oneText(meta.chips as { send: unknown }[])
  if (m.role === 'assistant' && m.origin !== 'proactive' && m.status !== 'streaming' && !['none', 'some', 'unknown'].includes(String(meta.side_effects))) meta.side_effects = 'unknown'
  return { ...m, meta }
}

// ---- undo / commit / cancel ------------------------------------------------
/**
 * A hold may arm (held_seen) or commit only once the answer that carries its echo is durably saved:
 * the message row is done, is not a rebuilt replay, and its echo list holds this action id (Sol r4 #7).
 */
// deno-lint-ignore no-explicit-any
async function echoDurable(svc: any, messageId: string, actionId: string): Promise<boolean | null> {
  const { data, error } = await svc.from('desk_messages').select('status, meta').eq('id', messageId).maybeSingle()
  if (error) return null
  const meta = (data?.meta ?? {}) as { actions?: { id?: string }[]; recovered?: boolean; rebuilt?: boolean }
  return !!data && data.status === 'done' && !meta.recovered && !meta.rebuilt && Array.isArray(meta.actions) && meta.actions.some((e) => e?.id === actionId)
}

/**
 * held -> committing in ONE SQL UPDATE on the DATABASE clock (desk_claim_commit). Its outcome is distinct:
 * 'claimed' | 'expired' (still held, deadline passed) | 'not_held'; an RPC error is 'error' and never
 * cancels a hold (round 14 #5).
 */
// deno-lint-ignore no-explicit-any
async function claimCommit(svc: any, a: { id: string; user_id?: string }): Promise<'claimed' | 'expired' | 'not_held' | 'error'> {
  const { data, error } = await svc.rpc('desk_claim_commit', { p_action: a.id, p_user: a.user_id })
  if (error) return 'error'
  return data === 'claimed' || data === 'expired' || data === 'not_held' ? data : 'error'
}

const EXPIRED_LABEL = 'Expired after 24 hours. Nothing changed.'
const STALE_LABEL = 'Cancelled: this proposal is from an older version. Ask again.'

/**
 * A hold that will never run: desk_expire_hold cancels it in SQL only while it is still held AND its
 * deadline has passed on the DATABASE clock or it has no v2 confirmation; the message's echo then says so.
 * Returns the state that actually won (and why), or null when the database could not be read.
 */
// deno-lint-ignore no-explicit-any
async function expireHold(svc: any, a: { id: string; user_id?: string; message_id?: string }): Promise<{ state: string | null; reason: string | null } | null> {
  const { data, error } = await svc.rpc('desk_expire_hold', { p_action: a.id, p_user: a.user_id })
  if (error || !data || typeof data !== 'object') return null
  const r = data as { state?: string | null; reason?: string | null }
  if (r.state === 'cancelled' && r.reason) {
    const messageId = a.message_id ?? (await svc.from('desk_actions').select('message_id').eq('id', a.id).maybeSingle()).data?.message_id
    const label = r.reason === 'expired' ? EXPIRED_LABEL : STALE_LABEL
    if (messageId) for (let i = 0; i < 3; i++) {
      const { data: ok } = await svc.rpc('desk_patch_action_echo', { p_message: messageId, p_action: a.id, p_patch: { state: 'cancelled', undo: false, label } })
      if (ok) break
    }
  }
  return { state: r.state ?? null, reason: r.reason ?? null }
}

// deno-lint-ignore no-explicit-any
async function claimState(svc: any, a: { id: string; result: Record<string, unknown> | null }, from: string, to: string): Promise<boolean> {
  const { data } = await svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: to } })
    .eq('id', a.id).filter('result->>state', 'eq', from).select('id')
  return Array.isArray(data) && data.length === 1
}

// deno-lint-ignore no-explicit-any
async function settle(svc: any, userDb: any, userId: string, op: string, actionId: string, dryReq = false) {
  if (!/^[0-9a-f-]{36}$/i.test(actionId)) return { ok: false, error: 'bad_action' }
  const { data: a, error: aErr } = await svc.from('desk_actions').select('*').eq('id', actionId).eq('user_id', userId).maybeSingle()
  if (aErr) return { ok: false, error: 'read_failed' }   // a failed read is an error, never "legacy" (Sol r12 #6)
  if (!a) return { ok: false, error: 'not_found' }
  const state = (a.result as { state?: string } | null)?.state
  let newState: ActionEcho['state'] | null = null
  let label: string | null = null
  let receiptLost = false
  let canUndo = false
  let resDetail: string | undefined
  if (op === 'undo') {
    if (state !== 'done' || a.undone_at || !a.undo) return { ok: false, error: 'nothing_to_undo' }
    if ((a.undo as { op?: string }).op === 'draft_v4') {
      // a draft write (date, remove date, photo): ONE locked SQL call takes only the action id, claims the
      // owned row (done -> undoing), loads target, before and applied from it, compares the whole columns
      // with applied and restores before; any refusal rolls the claim back (round 14 #4)
      const { data, error } = await svc.rpc('desk_undo', { p_action: actionId })
      if (error) return { ok: false, error: lockCode(error) ? 'changed_since' : 'undo_failed', detail: failText(lockCode(error) ? new UndoRefused('changed_since') : 'undo_failed') }
      const r = (data ?? {}) as { ok?: boolean; error?: string }
      if (r.ok !== true) {
        const code = String(r.error ?? 'undo_failed')
        if (code === 'nothing_to_undo') return { ok: false, error: 'nothing_to_undo' }
        const refused = code === 'changed_since' || code === 'gone'
        return { ok: false, error: code === 'in_queue' ? 'in_queue' : refused ? 'changed_since' : 'undo_failed', detail: refused ? failText(new UndoRefused(code)) : failText(code) }
      }
    } else {
      if (!await claimState(svc, a, 'done', 'undoing')) return { ok: false, error: 'nothing_to_undo' }
      try { await runUndo({ svc }, a.undo) } catch (e) {
        await svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: 'done' } }).eq('id', actionId)
        return { ok: false, error: e instanceof UndoRefused ? 'changed_since' : 'undo_failed', detail: failText(e) }
      }
      await svc.from('desk_actions').update({ undone_at: new Date().toISOString(), result: { ...(a.result ?? {}), state: 'undone' } }).eq('id', actionId)
    }
    newState = 'undone'; label = 'Undone.'
    invalidate()
  } else if (op === 'cancel') {
    if (state !== 'held' || !await claimState(svc, a, 'held', 'cancelled')) return { ok: false, error: 'not_held' }
    newState = 'cancelled'; label = 'Cancelled. Nothing changed.'
  } else {
    if (state !== 'held') return { ok: false, error: 'not_held' }
    // Confirm-to-act: ONLY this op, Ivan's "Do it now" tap, runs a draft write. No server clock.
    // A hold without the v2 confirmation (made before round 11) is cancelled, never run (Sol r11 #2).
    const conf = (a.args as { _confirm?: Confirmation } | null)?._confirm
    if (conf?.v !== 2) { await expireHold(svc, a); return { ok: false, error: 'stale_hold' } }
    const durable = await echoDurable(svc, a.message_id, actionId)
    if (durable === null) return { ok: false, error: 'read_failed' }
    if (!durable) return { ok: false, error: 'not_saved', detail: failText('not_saved') }
    // exactly one commit wins, a cancel that already won makes this one refuse, and the 24 h deadline is
    // part of the SAME atomic claim: held -> committing only while now < expires_at (Sol r11 #6)
    const claim = await claimCommit(svc, a)
    // an RPC error never cancels a hold: nothing ran, the card stays held (round 14 #5)
    if (claim === 'error') return { ok: false, error: 'claim_failed', detail: failText('claim_failed') }
    if (claim === 'expired') {
      const won = await expireHold(svc, a)
      return { ok: false, error: won?.state === 'cancelled' ? 'hold_expired' : won ? 'not_held' : 'claim_failed' }
    }
    if (claim !== 'claimed') return { ok: false, error: 'not_held' }
    try {
      const args = (a.args ?? {}) as Act & { _snapshot?: Snapshot; _dry?: boolean; _fixtures?: boolean }
      const snap = args._snapshot
      if (!snap?.target_id) throw new Error('changed')
      // re-plan from the stored target UUID only (Sol r1 #2): never a handle, never a fuzzy match
      const emptyBrief: Rendered = { text: '', drafts: new Map(), handleOf: new Map(), lines: new Map(), queueByDraft: new Map(), weeks: [] }
      const ctx: Ctx = { userDb, svc, userId, messageId: a.message_id, brief: emptyBrief, attachments: [], text: '', env }
      const p = await planForTarget(ctx, { ...args }, snap)
      if (!('echo' in p) || !p.run || p.echo.state !== 'held') throw new Error(('refuse' in p && p.refuse) || 'changed')
      // the live row and the re-planned args must still be exactly what the card showed (planForTarget
      // checked the live row against the snapshot; the card was built from that same snapshot)
      if (!confirmMatches(args._confirm as Confirmation, { id: snap.target_id, updated_at: snap.updated_at, scheduled_at: snap.scheduled_at }, p.canon)) throw new Error('changed')
      const isDry = dryReq || args._dry === true
      const res = isDry ? { result: { dry: true } } : await p.run(actionId)
      // the undo payload of a committed write is kept, so Undo works after the tap (date, photo)
      const recorded = await retry3(() => svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: 'done', value: res.result ?? null }, undo: (res as { undo?: unknown }).undo ?? null }).eq('id', actionId))
      newState = 'done'
      if (!recorded) receiptLost = true
      canUndo = !!(res as { undo?: unknown }).undo && recorded
      resDetail = (res as { detail?: string }).detail
      label = proposedLine(args as Act, { ...p, target_id: snap.target_id }, snap).replace(/^Proposed/, 'Done') || p.echo.label.replace(/^Approving/, 'Approved').replace(/^Deleting/, 'Deleted').replace(/^Taking (.*) off the schedule$/, 'Took $1 off the schedule')
        .replace(/^Moving/, 'Moved').replace(/^Removing the date/, 'Removed the date').replace(/^Adding your photo/, 'Added your photo')
        .replace(/^Rewriting (.*) through your writer\. It takes a few minutes\.$/, 'Sent $1 to your writer. It takes a few minutes.')
    } catch (e) {
      // a claimed action that throws anywhere ends failed, never stuck in "committing"
      await svc.from('desk_actions').update({ result: { ...(a.result ?? {}), state: 'failed', error: failText(e) } }).eq('id', actionId)
      const why = typeof (a.args as { reason?: unknown } | null)?.reason === 'string' ? String((a.args as { reason: string }).reason).replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      newState = 'failed'; label = `Not done: ${failText(e)}${why ? ` Your reason was: "${why}".` : ''}`
    }
    invalidate()
  }
  // reflect the new state in the message's echo (the stored action is the source of truth)
  const patch: Record<string, unknown> = { state: newState, undo: canUndo }
  if (label) patch.label = label
  if (resDetail) patch.detail = resDetail
  if (receiptLost) patch.detail = 'Done, but I could not record it. Check before repeating it.'
  let updated: unknown = null
  for (let i = 0; i < 3 && !updated; i++) {
    const { data } = await svc.rpc('desk_patch_action_echo', { p_message: a.message_id, p_action: actionId, p_patch: patch })
    updated = data ?? null
  }
  return { ok: newState !== 'failed', ...(updated ? { message: forClient(updated) } : { detail: receiptLost || newState === 'done' ? 'Done, but I could not record it. Check before repeating it.' : undefined }) }
}

// The held row is on Ivan's screen: record seen_at once (only while held) and start the server clock.
// deno-lint-ignore no-explicit-any
async function heldSeen(svc: any, userDb: any, userId: string, ids: string[], evalMode: boolean) {
  const results: { id: string; state?: string; seen_at?: string | null; hold_until?: string | null; error?: string }[] = []
  for (const id of ids) {
    try {
      const { data: a, error } = await svc.from('desk_actions').select('id, result, message_id, created_at').eq('id', id).eq('user_id', userId).maybeSingle()
      if (error) { results.push({ id, error: 'read_failed' }); continue }
      if (!a) { results.push({ id, error: 'not_found' }); continue }
      let r = (a.result ?? {}) as { state?: string; seen_at?: string; hold_ms?: number }
      if (r.state === 'held') {
        // a hold past its deadline on the DATABASE clock, or without the v2 confirmation, will never run:
        // desk_expire_hold decides both in SQL and cancels it there; the echo is persisted (round 14 #5)
        const won = await expireHold(svc, { id, user_id: userId, message_id: a.message_id })
        if (won == null || won.state == null) { results.push({ id, error: 'read_failed' }); continue }
        r = { ...r, state: won.state }
      }
      const ms = Number(r.hold_ms ?? 8000)
      if (r.state === 'held' && !r.seen_at) {
        // the clock starts only for an echo that is durably saved (Sol r4 #7)
        const durable = await echoDurable(svc, a.message_id, id)
        if (durable === null) { results.push({ id, error: 'read_failed' }); continue }
        if (!durable) { results.push({ id, error: 'not_saved' }); continue }
        const seenAt = new Date().toISOString()
        const { data: won, error: wErr } = await svc.from('desk_actions').update({ result: { ...r, seen_at: seenAt } })
          .eq('id', id).filter('result->>state', 'eq', 'held').is('result->>seen_at', null).select('id, result')
        if (wErr) { results.push({ id, error: 'write_failed' }); continue }
        if (Array.isArray(won) && won.length) {
          // confirm-to-act (round 11): seen_at is recorded, and NO timer is armed; only the commit op writes
          r = won[0].result
        } else {
          // lost the CAS: report only what a successful reread shows
          const { data: again, error: rErr } = await svc.from('desk_actions').select('result').eq('id', id).maybeSingle()
          if (rErr || !again) { results.push({ id, error: 'read_failed' }); continue }
          r = again.result as typeof r
        }
      }
      // the stored row is the truth; there is no deadline (hold_until null): the UI shows Undo and Do it now
      results.push({ id, state: r.state, seen_at: r.seen_at ?? null, hold_until: null })
    } catch { results.push({ id, error: 'failed' }) }
  }
  return { ok: results.every((x) => !x.error), results }
}

// ---- proactive tick -----------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function tick(svc: any, opts: { dry: boolean }) {
  const cfg = await flags(svc)
  // one-flag rollback (Sol r5 B10): desk_enabled off alone stops every proactive message
  if (cfg.desk_enabled !== true && !opts.dry) return { ok: true, skipped: 'desk_off' }
  if (cfg.triggers_enabled !== true && !opts.dry) return { ok: true, skipped: 'triggers_off' }
  if (!opts.dry) await sweepT3Stalls(svc)
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
    // dedupe + Warsaw-week cap + the message itself in ONE transaction (desk_fire_trigger)
    const { data: res, error } = await svc.rpc('desk_fire_trigger', {
      p_kind: p.kind, p_dedupe_key: p.dedupe_key, p_payload: { artifact: p.artifact }, p_cap: cap, p_user: ALLOWED,
      p_body: p.kind === 't3_done' ? null : sanitize(p.body, []),
      p_meta: { trigger: p.kind, artifact: p.artifact, ...(p.chips.length ? { chips: oneText(p.chips) } : {}) },
    })
    if (error || !(res as { fired?: boolean } | null)?.fired) continue
    if (p.kind !== 't3_done' && (res as { message_id?: string }).message_id) {
      try {
        // no content in the notification row or the push: the words stay in the owner-only desk (Sol r1 #3)
        await notify(svc, { family: 'content_desk', source: 'content-desk', dedupe_key: `desk:${p.dedupe_key}`, severity: 'info',
          title: 'Content Desk', body: 'You have a new message in your Content Desk.', url: DESK_URL, push: true, tenant: 'ivan' })
      } catch { console.warn('desk push failed') }
    }
    fired.push(p.dedupe_key)
  }
  return { ok: true, fired }
}
