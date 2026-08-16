// Evidence gather for "got a DM response but the reply draft isn't showing up".
// Reads as the OPERATOR's own session (same reach the app has) — a service_role
// read would hide an RLS-shaped defect.
// Writes rows.json (inbox_messages_v) + flagged.json (needs_manual_reply ids).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const OUT = process.argv[2] ?? `${ROOT}/goal-runs/dm-draft-invisible-2026-08-03`
mkdirSync(OUT, { recursive: true })
const env = Object.fromEntries(readFileSync(`${ROOT}/.env.local`, 'utf8').trim().split('\n')
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const sess = JSON.parse(readFileSync(`${ROOT}/.session.json`, 'utf8'))

const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: sess.refresh_token }),
})
if (!r.ok) throw new Error(`refresh ${r.status} ${await r.text()}`)
const tok = await r.json()
writeFileSync(`${ROOT}/.session.json`, JSON.stringify(tok, null, 2))
const H = { apikey: KEY, Authorization: `Bearer ${tok.access_token}` }

async function get(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

// Same paging the shipped fetchMessages does (PostgREST caps at 1000).
const all = []
for (let from = 0; from < 20000; from += 1000) {
  const page = await get(`inbox_messages_v?select=*&order=created_at.asc,id.asc&offset=${from}&limit=1000`)
  all.push(...page)
  if (page.length < 1000) break
}
writeFileSync(`${OUT}/rows.json`, JSON.stringify(all))

const flagged = await get('outreach_prospects?select=id&needs_manual_reply=eq.true&limit=1000')
writeFileSync(`${OUT}/flagged.json`, JSON.stringify(flagged.map(f => f.id)))

console.log(`rows=${all.length} flagged=${flagged.length}`)

// RAW draft census straight off the source table, so a view-shaped filter cannot
// hide a draft that genuinely exists.
const raw = await get('outreach_messages?select=id,prospect_id,direction,message_type,created_at,sent_at,approved_at,send_blocked_at,send_blocked_reason&direction=eq.outbound&sent_at=is.null&approved_at=is.null&send_blocked_at=is.null&order=created_at.desc&limit=200')
writeFileSync(`${OUT}/raw-drafts.json`, JSON.stringify(raw, null, 2))
console.log(`raw pending drafts in outreach_messages: ${raw.length}`)
for (const d of raw.slice(0, 25)) console.log(`  ${d.created_at}  ${d.message_type}  prospect=${d.prospect_id}`)

// Recent inbound, so we can name the DM response Ivan is talking about.
const inb = await get('outreach_messages?select=id,prospect_id,message_text,created_at,sent_at,channel&direction=eq.inbound&order=created_at.desc&limit=15')
writeFileSync(`${OUT}/recent-inbound.json`, JSON.stringify(inb, null, 2))
console.log('\nrecent inbound:')
for (const m of inb) console.log(`  ${m.created_at}  ${m.prospect_id}  ${JSON.stringify((m.message_text ?? '').slice(0, 70))}`)
