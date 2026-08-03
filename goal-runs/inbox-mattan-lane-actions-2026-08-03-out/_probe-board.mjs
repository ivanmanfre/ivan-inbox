// _probe-board.mjs — what does Mattan's board actually READ, and what would a
// delete break?
//
// Question 1 (item 3): does promoting really move a row between the two
// categories the inbox draws, and does the board JSON agree with board_visible?
// Question 2 (item 5): does the board's queue reference DRAFT IDs? If a
// never-promoted row can never be referenced there, hard-deleting one is as
// safe as deleting an Ivan row. If the queue references ids, a delete can
// leave a ghost on a paying client's board and must not ship.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const session = JSON.parse(readFileSync(new URL('../../.session.json', import.meta.url), 'utf8'))
const URLB = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const H = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
const out = (k, v) => console.log(`\n### ${k}\n${JSON.stringify(v, null, 2)}`)
const rest = async (p, i = {}) => {
  const r = await fetch(`${URLB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers || {}) } })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { httpStatus: r.status, body: j }
}
const rpc = async (n, a) => {
  const r = await fetch(`${URLB}/rest/v1/rpc/${n}`, { method: 'POST', headers: H, body: JSON.stringify(a) })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { httpStatus: r.status, body: j }
}

// 1 — the client_boards row for Mattan.
const b = await rest('client_boards?select=slug,client_id,company_name,is_live,board&limit=20')
const boards = Array.isArray(b.body) ? b.body : []
out('client_boards reachable', {
  httpStatus: b.httpStatus,
  n: boards.length,
  slugs: boards.map(x => ({ slug: x.slug, client_id: x.client_id, is_live: x.is_live })),
})
const rise = boards.find(x => x.client_id === 'risedtc') ?? boards[0]
if (rise?.board) {
  const jb = rise.board
  out('board JSON shape', {
    slug: rise.slug,
    topKeys: Object.keys(jb),
    queueLen: Array.isArray(jb.queue) ? jb.queue.length : null,
    queueKeys: Array.isArray(jb.queue) && jb.queue[0] ? Object.keys(jb.queue[0]) : null,
    queueSample: Array.isArray(jb.queue) ? jb.queue.slice(0, 3) : null,
    weekKeys: jb.week ? Object.keys(jb.week) : null,
  })
  // Does the queue carry draft ids, and do they line up with board_visible?
  const ids = []
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(x)) ids.push([k, x])
        else walk(x)
      }
    }
  }
  walk(jb)
  const uniq = [...new Set(ids.map(([, v]) => v))]
  out('uuid-shaped values anywhere in the board JSON', {
    keysUsed: [...new Set(ids.map(([k]) => k))],
    n: uniq.length,
    sample: uniq.slice(0, 8),
  })
  if (uniq.length) {
    const q = await rest(`carousel_drafts?id=in.(${uniq.slice(0, 60).join(',')})&select=id,status,board_visible,client_id`)
    const hit = Array.isArray(q.body) ? q.body : []
    out('do those uuids resolve to carousel_drafts rows?', {
      probed: Math.min(uniq.length, 60),
      matchedDrafts: hit.length,
      ofWhichNotVisible: hit.filter(r => r.board_visible !== true).length,
      sample: hit.slice(0, 5),
    })
  }
}

// 2 — what the CLIENT-FACING read returns. get_client_board is the anon path
// the board page itself uses; operator_client_drafts is the operator path.
// Comparing their draft sets tells us what board_visible actually gates.
{
  const od = await rpc('operator_client_drafts', { p_gate: 'clientops', p_client_id: 'risedtc' })
  const drafts = od.body?.drafts ?? []
  out('operator_client_drafts vs board_visible', {
    n: drafts.length,
    visible: drafts.filter(d => d.board_visible === true).length,
    notVisible: drafts.filter(d => d.board_visible !== true).length,
    note: 'the OPERATOR read returns both — so board_visible is a CLIENT-side gate, not an operator-side filter',
  })
}

// 3 — the client action log: does promoting write one? (memory: "panel log
// misses service-key writes"). Read-only.
{
  const a = await rest('client_board_actions?select=id,action,ref,created_at,slug&order=created_at.desc&limit=12')
  out('client_board_actions (most recent 12)', {
    httpStatus: a.httpStatus,
    rows: Array.isArray(a.body) ? a.body.map(r => ({ action: r.action, slug: r.slug, at: r.created_at })) : a.body,
  })
}
