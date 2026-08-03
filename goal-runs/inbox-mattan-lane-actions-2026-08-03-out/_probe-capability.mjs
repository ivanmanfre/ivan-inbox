// _probe-capability.mjs — what is LEGAL on a Mattan (client_id='risedtc') row
// from the inbox app's own authenticated session.
//
// Plain fetch, not supabase-js: createClient() builds a realtime client, and
// Node 20 has no native WebSocket, so the constructor throws before a single
// request goes out. PostgREST is HTTP; this speaks it directly with the SAME
// anon key + the SAME authenticated JWT the app carries.
//
// Read-only first. Every RPC is probed with a BOGUS draft id: a function that
// does not exist answers PGRST202, one whose gate refuses answers ok:false
// 'gate', one that accepts us answers ok:false 'not_found'. That separates
// "callable" from "exists" without touching a client row.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const session = JSON.parse(readFileSync(new URL('../../.session.json', import.meta.url), 'utf8'))
const URLB = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const H = {
  apikey: env.VITE_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json',
}
const GATE = 'clientops'
const BOGUS = '00000000-0000-0000-0000-000000000000'
const out = (k, v) => console.log(`\n### ${k}\n${JSON.stringify(v, null, 2)}`)

async function rpc(name, args) {
  const r = await fetch(`${URLB}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = t }
  return { httpStatus: r.status, body: j }
}
async function rest(path, init = {}) {
  const r = await fetch(`${URLB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = t }
  return { httpStatus: r.status, body: j }
}

// 0 — who are we
{
  const r = await fetch(`${URLB}/auth/v1/user`, { headers: H })
  const u = await r.json()
  out('whoami', { httpStatus: r.status, email: u.email, role: u.role, id: u.id })
}

// 1 — do the operator RPCs answer us at all?
for (const [name, args] of [
  ['operator_set_board_visible', { p_gate: GATE, p_draft_id: BOGUS, p_visible: true }],
  ['operator_schedule_draft', { p_gate: GATE, p_draft_id: BOGUS, p_publish_at: new Date(Date.now() + 864e5).toISOString() }],
  ['operator_edit_draft_body', { p_gate: GATE, p_draft_id: BOGUS, p_body: 'probe' }],
]) {
  out(`rpc ${name}`, await rpc(name, args))
}
{
  const r = await rpc('operator_client_drafts', { p_gate: GATE, p_client_id: 'risedtc' })
  out('rpc operator_client_drafts', {
    httpStatus: r.httpStatus,
    ok: r.body?.ok, error: r.body?.error,
    drafts: Array.isArray(r.body?.drafts) ? r.body.drafts.length : null,
    sampleKeys: r.body?.drafts?.[0] ? Object.keys(r.body.drafts[0]) : null,
  })
}

// 1b — the gate is a plain string, so prove it is CHECKED.
out('rpc operator_set_board_visible WRONG GATE',
  await rpc('operator_set_board_visible', { p_gate: 'not-the-gate', p_draft_id: BOGUS, p_visible: true }))

// 2 — direct-table reach on a CLIENT row. Read first.
const rowsRes = await rest('carousel_drafts?client_id=eq.risedtc&select=id,status,board_visible,title,updated_at&order=updated_at.desc&limit=400')
const rows = Array.isArray(rowsRes.body) ? rowsRes.body : []
out('risedtc rows', {
  httpStatus: rowsRes.httpStatus,
  n: rows.length,
  byStatus: Object.entries(rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})),
  boardTrue: rows.filter(r => r.board_visible === true).length,
  boardFalse: rows.filter(r => r.board_visible === false).length,
  boardNull: rows.filter(r => r.board_visible === null).length,
  reviewInternal: rows.filter(r => r.status === 'review' && r.board_visible !== true).length,
  reviewOnBoard: rows.filter(r => r.status === 'review' && r.board_visible === true).length,
})

// 3 — can `authenticated` UPDATE a client row directly? Written as a TRUE
// no-op: post_body set to the value it already holds, taxonomy untouched. An
// empty result means RLS filtered the row away (PostgREST answers 204/[]).
const target = rows.find(r => r.status === 'disqualified') ?? rows.find(r => r.status === 'published') ?? rows[0]
if (target) {
  const cur = await rest(`carousel_drafts?id=eq.${target.id}&select=id,post_body,updated_at`)
  const before = Array.isArray(cur.body) ? cur.body[0] : null
  out('update probe target', {
    id: target.id, status: target.status, board_visible: target.board_visible,
    title: target.title, bodyLen: (before?.post_body ?? '').length, updated_at: before?.updated_at,
  })
  const upd = await rest(`carousel_drafts?id=eq.${target.id}&client_id=eq.risedtc&select=id,updated_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ post_body: before?.post_body ?? null }),
  })
  out('UPDATE on a client row (no-op body)', {
    httpStatus: upd.httpStatus,
    landed: Array.isArray(upd.body) ? upd.body.length : upd.body,
    updatedAtBefore: before?.updated_at,
    updatedAtAfter: Array.isArray(upd.body) ? upd.body[0]?.updated_at : null,
  })
}

// 4 — DELETE reach. BOGUS id scoped to the client lane, so nothing can be
// removed: this only catches a hard permission refusal (42501). Zero rows is
// expected either way, so it is INCONCLUSIVE by design and reported as such.
out('DELETE probe (bogus id, client lane)',
  await rest(`carousel_drafts?id=eq.${BOGUS}&client_id=eq.risedtc&select=id`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  }))
out('DELETE probe (bogus id, ivan lane — delete already ships here)',
  await rest(`carousel_drafts?id=eq.${BOGUS}&client_id=is.null&select=id`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  }))
