// swishdm-report-check: the brand check on every SwishDM AI search report request
// (madebyswishdm.com/ai-search-report/, table swishdm_lm_requests, lead_magnet 'ai-search-report').
//
// Called server to server only: the insert trigger and the retry sweep (db/20261105_swishdm_report_check*.sql)
// post {request_id} with x-inbox-secret = INBOX_PUSH_SECRET, the same gate inbox-notify uses. Answers 202 at
// once and does the work in the background so pg_net's timeout never cuts a check short.
//
// The check: does the store open, StoreLeads size + platform + country + product count from the same
// local storeleads_domains table the outbound SwishDM lanes read (no paid API call), does the email
// match the store, then one reasoned fit read through the Railway Claude proxy (rubric in the user turn,
// no system field). A failed or refused model call is 'unchecked' and retried by the sweep, never a
// made-up verdict. The result is written back to the row, then onto the request's inbox card as its own
// step (card_synced_at), so a card write that fails is retried without a second model call.
// Nothing is sent to the requester. Nothing here ever pushes to the phone: only the insert trigger rings.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { notify } from '../_shared/notify.ts'
import {
  buildPrompt, cardBody, cardTitle, emailMatch, htmlFacts, normDomain, parseVerdict, publicHost,
  type Evidence, type RequestRow, type SiteFacts, type StoreLeadsFacts, type Verdict,
} from './check.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const MODEL = Deno.env.get('SWISHDM_REPORT_CHECK_MODEL') || 'claude-sonnet-5-5'
const MAX_ATTEMPTS = 3
/** Before this age a missing card means the trigger's card is still on its way; after it, raise one (silently). */
const CARD_FALLBACK_AFTER_MS = 10 * 60 * 1000
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Row = RequestRow & {
  check_state: string | null; check_attempts: number; checked_at: string | null; card_synced_at: string | null
  brand_check: { evidence?: Evidence | null; note?: string | null } | null; fit: Verdict['fit'] | null; fit_why: string | null
  is_test?: boolean; created_at: string
}

/** The body, read as a stream and cut at `max` bytes, so a huge response cannot exhaust the worker (Sol r1 #4). */
async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body) return ''
  const reader = r.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value.length + total > max ? value.subarray(0, max - total) : value)
      total += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const buf = new Uint8Array(Math.min(total, max))
  let o = 0
  for (const p of parts) { buf.set(p, o); o += p.length }
  return new TextDecoder().decode(buf)
}

/** GET that follows at most 5 redirects itself, checking every hop is a public name (Sol r1 #3). */
async function safeGet(url: string, accept: string, timeoutMs: number): Promise<{ r: Response; url: string } | { error: string }> {
  const signal = AbortSignal.timeout(timeoutMs)
  let cur = url
  for (let hop = 0; hop <= 5; hop++) {
    let u: URL
    try { u = new URL(cur) } catch { return { error: 'bad redirect address' } }
    if (!/^https?:$/.test(u.protocol) || !publicHost(u.hostname) || (u.port && !['80', '443'].includes(u.port))) return { error: 'redirects to an address we do not fetch' }
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept }, signal })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      await r.body?.cancel().catch(() => {})
      cur = new URL(r.headers.get('location')!, u).toString()
      continue
    }
    return { r, url: u.toString() }
  }
  return { error: 'too many redirects' }
}

async function fetchSite(domain: string | null): Promise<SiteFacts> {
  const empty: SiteFacts = { resolves: false, status: null, final_url: null, final_domain: null, error: null, title: null,
    description: null, platform_hint: null, password_page: false, shopify_products: null }
  if (!domain || !publicHost(domain)) return { ...empty, error: 'not a public web address' }
  let last: SiteFacts = empty
  for (const host of domain.startsWith('www.') ? [domain] : [domain, 'www.' + domain]) {
    try {
      const got = await safeGet(`https://${host}/`, 'text/html', 15_000)
      if ('error' in got) { last = { ...empty, error: got.error }; continue }
      const { r, url: finalUrl } = got
      const html = await readCapped(r, 500_000)
      const path = new URL(finalUrl).pathname
      const site: SiteFacts = { ...empty, status: r.status, final_url: finalUrl, final_domain: normDomain(finalUrl),
        resolves: r.status >= 200 && r.status < 300, password_page: /^\/password\/?$/.test(path), ...htmlFacts(html) }
      // A bot wall (403/429/503 from Cloudflare or Shopify) still proves the host is up and serving.
      if (!site.resolves && [401, 403, 429, 503].includes(r.status)) site.error = `HTTP ${r.status}, the site blocked our check (it is online)`
      if (site.resolves && site.platform_hint === 'shopify' && !site.password_page) site.shopify_products = await shopifyCount(finalUrl)
      if (site.resolves || site.error) return site
      last = site
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      last = { ...empty, error: /dns|lookup|resolve|name or service/i.test(msg) ? 'the address does not exist' : /timed? ?out|abort/i.test(msg) ? 'no answer in 15 seconds' : msg.slice(0, 120) }
    }
  }
  return last
}

async function shopifyCount(baseUrl: string): Promise<number | null> {
  try {
    const got = await safeGet(new URL('/products.json?limit=250', baseUrl).toString(), 'application/json', 10_000)
    if ('error' in got || !got.r.ok) return null
    const j = JSON.parse(await readCapped(got.r, 3_000_000)) as { products?: unknown[] }
    return Array.isArray(j.products) ? j.products.length : null
  } catch { return null }
}

async function storeLeads(db: SupabaseClient, domains: string[]): Promise<StoreLeadsFacts | null> {
  if (!domains.length) return null
  const { data, error } = await db.from('storeleads_domains')
    .select('domain, domain_norm, merchant_name, platform, plan, country_code, est_sales_yearly_usd, product_count, employee_count, categories')
    .in('domain_norm', domains).limit(5)
  if (error) throw new Error('storeleads lookup failed: ' + error.message)
  const rows = (data ?? []) as (StoreLeadsFacts & { domain_norm: string })[]
  // The domain they typed first, then the one it redirects to.
  const hit = domains.map(d => rows.find(r => r.domain_norm === d)).find(Boolean)
  if (!hit) return null
  return { domain: hit.domain_norm, merchant_name: hit.merchant_name, platform: hit.platform, plan: hit.plan, country_code: hit.country_code,
    est_sales_yearly_usd: hit.est_sales_yearly_usd == null ? null : Number(hit.est_sales_yearly_usd), product_count: hit.product_count,
    employee_count: hit.employee_count, categories: hit.categories }
}

/** One Railway proxy call. Returns the text, or null for any outage, refusal or empty answer. */
async function askProxy(prompt: string): Promise<{ text: string | null; note: string | null }> {
  const base = (Deno.env.get('RAILWAY_CLAUDE_URL') ?? '').replace(/\/v1\/messages\/?$/, '').replace(/\/$/, '')
  const key = Deno.env.get('RAILWAY_CLAUDE_API_KEY')
  if (!base || !key || /api\.anthropic\.com/.test(base)) return { text: null, note: 'proxy not configured' }
  try {
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(110_000),
    })
    if (!r.ok) return { text: null, note: `model service ${r.status}` }
    const body = await r.json() as { stop_reason?: string; content?: { type?: string; text?: string }[] }
    if (body.stop_reason === 'refusal') return { text: null, note: 'model refused' }
    const text = (body.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('').trim()
    // A limit notice or refusal is prose; parseVerdict only accepts an answer that is entirely the JSON verdict.
    return text ? { text, note: null } : { text: null, note: 'empty model answer' }
  } catch (e) {
    return { text: null, note: /timed? ?out|abort/i.test(String(e)) ? 'model call timed out' : 'model call failed' }
  }
}

/** Write the saved result onto the request's card. Never pushes. Returns what happened. */
async function syncCard(db: SupabaseClient, row: Row): Promise<string> {
  const state = row.check_state === 'checked' ? 'checked' : 'unchecked'
  const verdict = row.fit && row.fit_why ? { fit: row.fit, why: row.fit_why } : null
  const note = row.brand_check?.note ?? undefined
  const title = cardTitle(row, verdict, state)
  let body = cardBody(row, row.brand_check?.evidence ?? null, verdict, state, note)
  if (!verdict && row.check_attempts >= MAX_ATTEMPTS) body = body.replace('The check retries on its own.', 'The check stopped retrying.')
  const media = { kind: 'lead_request', lane: 'swishdm', request_id: row.id, qualifies: row.qualifies, sales_band: row.sales_band,
    urgency: row.urgency, check_state: state, fit: verdict?.fit ?? null, is_test: !!row.is_test }

  let card: { id: string; media: Record<string, unknown> | null } | null = null
  for (let i = 0; i < 3 && !card; i++) {
    if (i) await sleep(5000)
    const { data, error } = await db.from('inbox_notifications').select('id, media').eq('dedupe_key', 'swishdm_report_request:' + row.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error('card lookup failed: ' + error.message)
    card = data as typeof card
  }
  let action: string
  if (card) {
    // An in-place edit of the trigger's card: no count bump, no second buzz.
    const { data, error } = await db.from('inbox_notifications').update({ title, body, media: { ...(card.media ?? {}), ...media } })
      .eq('id', card.id).select('id')
    if (error) throw new Error('card update failed: ' + error.message)
    if (!data?.length) throw new Error('card update matched no row')
    action = 'updated'
  } else if (Date.now() - Date.parse(row.created_at) < CARD_FALLBACK_AFTER_MS) {
    // The trigger's card may still be on its way; raising one now could be folded over by the late
    // pending card (Sol r1 #8). The sweep comes back for it.
    return 'card_pending'
  } else {
    // The trigger's card never landed: raise one so the request still reaches Ivan, feed-only.
    await notify(db, { family: 'lead_request_notice', source: 'db:swishdm_report_request', dedupe_key: 'swishdm_report_request:' + row.id,
      severity: row.qualifies ? 'attention' : 'info', title, body, url: './#exp/brain-b/today', media, push: false })
    action = 'created'
  }
  // Stamp only the result we just wrote; a newer result keeps its own unsynced mark.
  await db.from('swishdm_lm_requests').update({ card_synced_at: new Date().toISOString() })
    .eq('id', row.id).eq('check_state', row.check_state).eq('check_attempts', row.check_attempts)
  return action
}

async function loadRow(db: SupabaseClient, id: string): Promise<Row | null> {
  const { data, error } = await db.from('swishdm_lm_requests').select('*').eq('id', id).eq('lead_magnet', 'ai-search-report').maybeSingle()
  if (error) throw new Error('load failed: ' + error.message)
  return data as Row | null
}

async function runCheck(db: SupabaseClient, requestId: string, claimedRef: { attempt: number | null }): Promise<Record<string, unknown>> {
  const { data: claimed, error: claimErr } = await db.rpc('swishdm_report_check_claim', { p_id: requestId })
  if (claimErr) throw new Error('claim failed: ' + claimErr.message)
  const row = (Array.isArray(claimed) ? claimed[0] : claimed) as Row | null
  if (!row || !row.id) {
    // Not ours to check (done, running elsewhere, over budget or waiting its turn). A finished result whose
    // card write failed earlier is synced here without a second model call.
    const cur = await loadRow(db, requestId)
    const final = cur && (cur.check_state === 'checked' || (cur.check_state === 'unchecked' && cur.check_attempts >= MAX_ATTEMPTS))
    if (cur && final && !cur.card_synced_at) return { skipped: 'not claimable', card: await syncCard(db, cur) }
    return { skipped: 'not claimable' }
  }
  claimedRef.attempt = row.check_attempts

  let ev: Evidence | null = null
  let verdict: Verdict | null = null
  let note: string | null = null
  try {
    const storeDomain = normDomain(row.product_url)
    const site = await fetchSite(storeDomain)
    const doms = [...new Set([storeDomain, site.final_domain].filter((d): d is string => !!d))]
    const sl = await storeLeads(db, doms)
    const emailDomain = normDomain(String(row.email).split('@')[1] ?? '')
    ev = { store_domain: storeDomain, site, storeleads: sl, email_domain: emailDomain, email_match: emailMatch(row.email, doms) }
    const ans = await askProxy(buildPrompt(row, ev))
    verdict = parseVerdict(ans.text)
    note = verdict ? null : ans.note ?? 'model answer was not a usable verdict'
  } catch (e) {
    note = (e instanceof Error ? e.message : String(e)).slice(0, 160)
  }

  const state = verdict ? 'checked' : 'unchecked'
  const finalNote = !verdict && row.check_attempts >= MAX_ATTEMPTS ? `${note}; gave up after ${MAX_ATTEMPTS} tries` : note
  // Saved only while this run still owns the claim (same attempt number, still running) (Sol r1 #5).
  const { data: saved, error: saveErr } = await db.from('swishdm_lm_requests').update({
    check_state: state, checked_at: new Date().toISOString(), card_synced_at: null,
    brand_check: { v: 1, evidence: ev, model: verdict ? MODEL + ' via Railway proxy' : null, note: finalNote, attempt: row.check_attempts },
    fit: verdict?.fit ?? null, fit_why: verdict?.why ?? null,
  }).eq('id', row.id).eq('check_state', 'running').eq('check_attempts', row.check_attempts).select('*')
  if (saveErr) throw new Error('save failed: ' + saveErr.message)
  if (!saved?.length) return { skipped: 'claim lost before save' }
  claimedRef.attempt = null
  const card = await syncCard(db, saved[0] as Row)
  return { state, fit: verdict?.fit ?? null, card }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return reply(503, { error: 'not_configured' })
  if (req.headers.get('x-inbox-secret') !== secret) return reply(401, { error: 'unauthorized' })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })
  let body: { request_id?: unknown; wait?: unknown }
  try { body = await req.json() } catch { return reply(400, { error: 'bad_json' }) }
  const id = typeof body.request_id === 'string' ? body.request_id : ''
  if (!UUID_RE.test(id)) return reply(400, { error: 'bad_request_id' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const claimedRef: { attempt: number | null } = { attempt: null }
  const job = runCheck(db, id, claimedRef).catch(async (e) => {
    console.error('swishdm-report-check failed', id, e)
    // Release only a claim this run holds, so the sweep can retry it; never another worker's (Sol r1 #5).
    if (claimedRef.attempt != null) {
      // checked_at + note so a release on the last attempt is still picked up for its card (Sol r2 #2).
      const last = claimedRef.attempt >= MAX_ATTEMPTS
      await db.from('swishdm_lm_requests').update({ check_state: 'unchecked', card_synced_at: null, checked_at: new Date().toISOString(),
        brand_check: { v: 1, evidence: null, model: null, attempt: claimedRef.attempt,
          note: 'the check hit an error' + (last ? `; gave up after ${MAX_ATTEMPTS} tries` : '') } })
        .eq('id', id).eq('check_state', 'running').eq('check_attempts', claimedRef.attempt)
    }
    return { error: String(e instanceof Error ? e.message : e).slice(0, 200) }
  })
  // wait:true is for a person testing by hand; the trigger and the sweep never wait.
  if (body.wait === true) return reply(200, await job)
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job)
  return reply(202, { accepted: id })
})
