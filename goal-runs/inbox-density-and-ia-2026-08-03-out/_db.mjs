// Shared read-only DB helper for this goal run. Refreshes the stored session
// when the JWT has expired (the run outlives one hour of token life).
import fs from 'fs'
const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const env = Object.fromEntries(
  fs.readFileSync(`${ROOT}/.env.local`, 'utf8').trim().split('\n').map(l => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)
export const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
let sess = JSON.parse(fs.readFileSync(`${ROOT}/.session.json`, 'utf8'))

async function refresh() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  })
  if (!r.ok) throw new Error('refresh failed ' + r.status + ' ' + await r.text())
  sess = await r.json()
  fs.writeFileSync(`${ROOT}/.session.json`, JSON.stringify(sess, null, 2))
}

async function raw(path, range) {
  const headers = { apikey: KEY, Authorization: `Bearer ${sess.access_token}` }
  if (range) headers.Range = range
  let r = await fetch(`${URL_}/rest/v1/${path}`, { headers })
  if (r.status === 401) {
    await refresh()
    headers.Authorization = `Bearer ${sess.access_token}`
    r = await fetch(`${URL_}/rest/v1/${path}`, { headers })
  }
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + await r.text())
  return r.json()
}

export const q = (path) => raw(path)

// PostgREST caps a response at 1000 rows regardless of limit (MEMORY trap).
export async function page(path) {
  const out = []
  for (let from = 0; from < 60000; from += 1000) {
    const d = await raw(path, `${from}-${from + 999}`)
    out.push(...d)
    if (d.length < 1000) break
  }
  return out
}
