// Replay outreach_perf_payload against the LIVE corpus for all three lanes, and cross-check its
// dm1 reply rate against lane_chain_weekly on a LIKE-FOR-LIKE basis.
//
// Exit codes are distinct on purpose, so a red run means one specific thing:
//   3  transport or shape failure: an RPC returned non-OK, or the payload is missing
//      `reply_basis` / `lanes`. Nothing was verified. Never reported as a data problem.
//   1  the payload contains an IMPOSSIBLE value: a rate above 1, a negative count, or a lane
//      carrying sends with no campaigns behind it. That is a bug in the SQL.
//   0  everything else, including rate mismatches against the weekly RPC, which are printed as
//      WARN rather than failing the run.
//
// Why a mismatch is a WARN and not a failure: `lane_chain_weekly.reply_rate` divides by `accepted`
// on any accept-gated lane (see "Outreach - Connect Cap Watchdog (both seats).workflow.ts" line
// 286: `replyDen = r.has_accept ? Number(r.accepted) : Number(r.sends)`), while the payload
// divides by matured DM sends. Comparing those two directly would fire forever on every
// accept-gated lane, so the gate could never pass. This script instead rebuilds the weekly rate
// like-for-like as `replied / sends` and prints both denominators on the line, and it skips the
// comparison entirely when either side is too thin to mean anything.
//
// lane_chain_weekly takes (p_client_id text, p_week_start date); Ivan is passed as null. Argument
// shape copied from the cap watchdog at lines 304-310; result columns (lane, sends, replied,
// accepted, reply_rate, thin) confirmed live with pg_get_function_result.
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1'
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_KEY missing'); process.exit(2) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const FLOOR = 30

const die3 = (msg) => { console.error(`TRANSPORT/SHAPE FAILURE: ${msg}`); process.exit(3) }

const rpc = async (name, body) => {
  let r
  try {
    r = await fetch(`${SB}/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  } catch (e) { return die3(`${name} request threw: ${e.message}`) }
  if (!r.ok) return die3(`${name} ${r.status} ${await r.text()}`)
  try { return await r.json() } catch (e) { return die3(`${name} returned unparseable body: ${e.message}`) }
}

// last closed Monday-Sunday week, same derivation as the cap watchdog
const mondayOnOrBefore = (d) => {
  const dow = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 86400000)
}
const WEEK = new Date(mondayOnOrBefore(new Date()).getTime() - 7 * 86400000).toISOString().slice(0, 10)
console.log(`run ${new Date().toISOString()} · cross-check week_start ${WEEK}`)
console.log(`exit 3 = transport/shape · exit 1 = impossible value · WARN = like-for-like rate gap > 5 points`)

let impossible = 0
for (const lane of ['ivan', 'risedtc', 'arch']) {
  const p = await rpc('outreach_perf_payload', { p_client_id: lane, p_days: 90 })
  if (!p || typeof p !== 'object') die3(`outreach_perf_payload(${lane}) did not return an object`)
  if (!p.reply_basis || typeof p.reply_basis !== 'object') die3(`outreach_perf_payload(${lane}) is missing reply_basis`)
  if (!Array.isArray(p.lanes)) die3(`outreach_perf_payload(${lane}) is missing lanes`)

  console.log(`\n== ${lane} · threaded ${p.reply_basis.threaded} · stamp_only ${p.reply_basis.stamp_only}`)
  for (const l of p.lanes) {
    for (const c of l.cells) {
      console.log(`${l.lane.padEnd(20)} ${c.step.padEnd(6)} now ${c.replies}/${c.n} (${(c.rate * 100).toFixed(1)}%)  prior ${c.base_replies}/${c.base_n} (${(c.base_rate * 100).toFixed(1)}%)  ${c.status}`)
      // impossible values: these are SQL bugs, not corpus conditions
      for (const [what, v] of [['rate', c.rate], ['base_rate', c.base_rate]]) {
        if (Number(v) > 1) { console.log(`  IMPOSSIBLE ${l.lane} ${c.step}: ${what} ${v} is above 1`); impossible++ }
      }
      for (const [what, v] of [['n', c.n], ['replies', c.replies], ['base_n', c.base_n], ['base_replies', c.base_replies]]) {
        if (Number(v) < 0) { console.log(`  IMPOSSIBLE ${l.lane} ${c.step}: ${what} ${v} is negative`); impossible++ }
      }
    }
    const laneSends = l.cells.reduce((a, c) => a + Number(c.n) + Number(c.base_n), 0)
    if (laneSends > 0 && (!Array.isArray(l.campaigns) || l.campaigns.length === 0)) {
      console.log(`  IMPOSSIBLE ${l.lane}: ${laneSends} sends with zero campaigns behind them`); impossible++
    }
    for (const a of l.alarms) console.log(`  ALARM ${a.kind} ${a.step} ${a.variant ?? ''} ${(a.now_rate * 100).toFixed(1)}% vs ${(a.prior_rate * 100).toFixed(1)}% suspect=${a.suspect_dim ?? 'none'} share=${a.suspect_share ?? '-'}`)
  }
  console.log(`  lanes in payload: ${p.lanes.map(l => l.lane).join(', ') || '(none)'}`)

  const weekly = await rpc('lane_chain_weekly', { p_client_id: lane === 'ivan' ? null : lane, p_week_start: WEEK })
  if (!Array.isArray(weekly)) die3(`lane_chain_weekly(${lane}) did not return an array`)
  if (!weekly.length) { console.log('  xcheck: lane_chain_weekly returned no rows'); continue }
  if (!('sends' in weekly[0]) || !('replied' in weekly[0])) die3(`lane_chain_weekly(${lane}) row lacks sends/replied: ${JSON.stringify(weekly[0])}`)

  for (const w of weekly) {
    const c = p.lanes.find(x => x.lane === w.lane)?.cells.find(x => x.step === 'dm1')
    if (!c) { console.log(`  xcheck ${w.lane}: no dm1 cell in payload (weekly sends ${w.sends}, replied ${w.replied})`); continue }
    // LIKE FOR LIKE: rebuild the weekly rate over sends, not over accepted, so both sides answer
    // the same question. The RPC's own reply_rate is printed alongside for reference only.
    const wSends = Number(w.sends ?? 0)
    const wReplied = Number(w.replied ?? 0)
    const wLike = wSends > 0 ? wReplied / wSends : 0
    const base = `  xcheck ${w.lane}: weekly ${wReplied}/${wSends} sent = ${(wLike * 100).toFixed(1)}% (rpc reply_rate ${(Number(w.reply_rate ?? 0) * 100).toFixed(1)}% over ${w.accepted} acc) vs payload dm1 ${c.replies}/${c.n} = ${(c.rate * 100).toFixed(1)}%`
    if (w.thin === true || wSends < FLOOR || Number(c.n) < FLOOR) {
      console.log(`${base} skip (thin)`)
      continue
    }
    const diff = Math.abs(wLike - Number(c.rate))
    console.log(`${base} ${diff > 0.05 ? 'WARN' : 'ok'}`)
  }
}
if (impossible) { console.error(`\n${impossible} impossible value(s) in the payload: this is a SQL bug`); process.exit(1) }
process.exit(0)
