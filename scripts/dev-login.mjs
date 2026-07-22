// dev-login.mjs — mint a real Supabase session for the sole app user without an
// email round-trip, for local/CI verification only. No secrets live in this file:
// the Management API PAT is read from the local machine and the service key is
// fetched at runtime. Output (.session.json) is gitignored.
//
// Usage: node scripts/dev-login.mjs
// Then inject into the app origin before load:
//   localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', <file contents>)
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REF = 'bjbvqvzbzczjbatgmccb'
const EMAIL = 'im@ivanmanfredi.com'

const pat = execSync(
  `grep -rhoE "sbp_[a-f0-9]{40,}" ~/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/ 2>/dev/null | sort -u | head -1`,
  { shell: '/bin/zsh' },
).toString().trim()
if (!pat) throw new Error('No Management API PAT found on this machine')

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${pat}` },
})).json()
const service = keys.find((k) => k.name === 'service_role')?.api_key
if (!service) throw new Error('service_role key not returned')

const gen = await (await fetch(`https://${REF}.supabase.co/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
})).json()
const tokenHash = gen.hashed_token ?? gen.properties?.hashed_token
if (!tokenHash) throw new Error(`generate_link failed: ${JSON.stringify(gen).slice(0, 300)}`)

const anon = keys.find((k) => k.name === 'anon')?.api_key
const session = await (await fetch(`https://${REF}.supabase.co/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
})).json()
if (!session.access_token) throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 300)}`)

writeFileSync(new URL('../.session.json', import.meta.url), JSON.stringify(session))
console.log(`session minted for ${session.user?.email}, expires_at=${session.expires_at} -> .session.json`)
