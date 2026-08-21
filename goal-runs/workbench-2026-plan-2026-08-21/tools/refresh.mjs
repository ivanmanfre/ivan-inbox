// Refresh the Supabase session so the authed harness can run. Tokens rotate:
// never run two of these concurrently or the second one invalidates the first.
import { readFileSync, writeFileSync } from 'node:fs'

const REPO = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const env = Object.fromEntries(readFileSync(REPO + '/.env.local', 'utf8').trim().split('\n')
  .map(l => l.split('=')).map(([k, ...v]) => [k.trim(), v.join('=').trim()]))
const s = JSON.parse(readFileSync(REPO + '/.session.json', 'utf8'))

if (s.expires_at * 1000 > Date.now() + 10 * 60 * 1000) {
  console.log('valid until', new Date(s.expires_at * 1000).toISOString(), '- no refresh needed')
  process.exit(0)
}

const r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: s.refresh_token }),
})
if (!r.ok) { console.error('REFRESH FAILED', r.status, (await r.text()).slice(0, 300)); process.exit(1) }
const next = await r.json()
writeFileSync(REPO + '/.session.json', JSON.stringify(next))
console.log('refreshed, expires', new Date(next.expires_at * 1000).toISOString())
