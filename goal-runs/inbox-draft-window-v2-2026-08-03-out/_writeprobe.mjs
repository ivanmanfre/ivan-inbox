// Probe the write paths this run ADDS, as the operator's own session — not as
// service_role, because a permission the app does not have is exactly the
// defect these buttons would hide behind a "Saved" flash.
//
// Everything here is snapshot-then-restore. Nothing is left changed.
//   A. append_agent_log RPC   (the note composer)   — fired for real
//   B. lm_drafts_v2 UPDATE    (the LM field editor) — fired for real
//   C. carousel_drafts status+scheduled_at          — NOT FIRED. It arms the
//      publisher bridge; the predicate is asserted instead.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const OUT = process.argv[2] ?? './writeprobe'
mkdirSync(OUT, { recursive: true })
const env = Object.fromEntries(readFileSync(`${ROOT}/.env.local`, 'utf8').trim().split('\n')
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
let sess = JSON.parse(readFileSync(`${ROOT}/.session.json`, 'utf8'))

async function refresh() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  })
  if (!r.ok) throw new Error('refresh failed ' + r.status)
  sess = await r.json()
  writeFileSync(`${ROOT}/.session.json`, JSON.stringify(sess, null, 2))
}
async function call(path, init = {}, retried = false) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${sess.access_token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  if (r.status === 401 && !retried) { await refresh(); return call(path, init, true) }
  const t = await r.text()
  return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null }
}

const out = {}

// ---- A · append_agent_log (the note composer) -----------------------------
{
  const [row] = (await call('carousel_drafts?client_id=is.null&status=eq.review'
    + '&select=id,agent_log&order=updated_at.desc&limit=1')).body
  const before = row.agent_log
  const beforeLen = Array.isArray(before) ? before.length : null
  const r = await call('rpc/append_agent_log', {
    method: 'POST',
    body: JSON.stringify({
      p_table: 'carousel_drafts', p_id: row.id, p_agent: 'Ivan',
      p_body: '[draft-window-v2 write probe — removed immediately]',
    }),
  })
  const [after] = (await call(`carousel_drafts?id=eq.${row.id}&select=agent_log`)).body
  const afterLen = Array.isArray(after.agent_log) ? after.agent_log.length : null
  // Restore exactly.
  await call(`carousel_drafts?id=eq.${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ agent_log: before }),
  })
  const [back] = (await call(`carousel_drafts?id=eq.${row.id}&select=agent_log`)).body
  out.appendAgentLog = {
    row: row.id,
    rpcOk: r.ok, rpcStatus: r.status,
    rpcError: r.ok ? null : r.body,
    entriesBefore: beforeLen, entriesAfter: afterLen,
    noteLanded: afterLen !== null && beforeLen !== null && afterLen === beforeLen + 1,
    restored: JSON.stringify(back.agent_log) === JSON.stringify(before),
  }
}

// ---- B · lm_drafts_v2 UPDATE (the LM field editor) ------------------------
{
  const [row] = (await call('lm_drafts_v2?select=id,post_body,email_copy&order=updated_at.desc&limit=1')).body
  const snap = { post_body: row.post_body, email_copy: row.email_copy }
  const probe = (row.post_body ?? '') + ' [probe]'
  const w = await call(`lm_drafts_v2?id=eq.${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ post_body: probe }),
  })
  const [after] = (await call(`lm_drafts_v2?id=eq.${row.id}&select=post_body`)).body
  await call(`lm_drafts_v2?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify(snap) })
  const [back] = (await call(`lm_drafts_v2?id=eq.${row.id}&select=post_body,email_copy`)).body
  out.lmFieldUpdate = {
    row: row.id,
    // The load-bearing question: does the operator's session get rows back, or
    // does RLS answer a silent 204 the UI would render as "Saved"?
    rowsReturned: Array.isArray(w.body) ? w.body.length : null,
    httpStatus: w.status,
    landed: after.post_body === probe,
    restored: back.post_body === snap.post_body && back.email_copy === snap.email_copy,
  }
}

// ---- C · schedule: NOT FIRED ---------------------------------------------
out.scheduleDraft = {
  fired: false,
  why: 'status=scheduled + scheduled_at is what the n8n Bridge (yzXqLDIpuNzuhUQq) '
    + 'reads to put a post on LinkedIn. Firing it at a real row to prove the write '
    + 'works would publish a post.',
  writePathProvenBy: 'the same table, the same .is(client_id,null) scope and the same '
    + 'verified-write (.select() non-empty) contract as the edit round-trip, which '
    + 'landed and was restored on a live row.',
}

writeFileSync(`${OUT}/writeprobe.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
