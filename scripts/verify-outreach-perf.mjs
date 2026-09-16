// Replay the new RPC against the LIVE corpus for all three lanes and cross-check the
// DM reply rate against lane_chain_weekly. Prints a table; exits 1 on any mismatch
// larger than 5 points (the maturation window explains small gaps; see the replay note).
//
// lane_chain_weekly takes (p_client_id text, p_week_start date) -- argument shape copied from
// "Outreach - Connect Cap Watchdog (both seats).workflow.ts" lines 304-310, where Ivan is passed
// as p_client_id null. Its result columns (read live from pg_get_function_result) include
// lane text and reply_rate numeric, so the two field reads the brief assumed are correct.
// Its reply_rate denominator is `accepted` when the lane has an accept step and `sends`
// otherwise, and it is a single unmatured week, so it is a sanity bound and not an identity.
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1'
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_KEY missing'); process.exit(2) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const rpc = async (name, body) => {
  const r = await fetch(`${SB}/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${name} ${r.status} ${await r.text()}`)
  return r.json()
}
// last closed Monday-Sunday week, same derivation as the cap watchdog
const mondayOnOrBefore = (d) => {
  const dow = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 86400000)
}
const WEEK = new Date(mondayOnOrBefore(new Date()).getTime() - 7 * 86400000).toISOString().slice(0, 10)
console.log(`run ${new Date().toISOString()} · cross-check week_start ${WEEK}`)
let bad = 0
for (const lane of ['ivan', 'risedtc', 'arch']) {
  const p = await rpc('outreach_perf_payload', { p_client_id: lane, p_days: 90 })
  console.log(`\n== ${lane} · threaded ${p.reply_basis.threaded} · stamp_only ${p.reply_basis.stamp_only}`)
  for (const l of p.lanes) {
    for (const c of l.cells) console.log(`${l.lane.padEnd(20)} ${c.step.padEnd(6)} now ${c.replies}/${c.n} (${(c.rate * 100).toFixed(1)}%)  prior ${c.base_replies}/${c.base_n} (${(c.base_rate * 100).toFixed(1)}%)  ${c.status}`)
    for (const a of l.alarms) console.log(`  ALARM ${a.kind} ${a.step} ${a.variant ?? ''} ${(a.now_rate * 100).toFixed(1)}% vs ${(a.prior_rate * 100).toFixed(1)}% suspect=${a.suspect_dim ?? 'none'} share=${a.suspect_share ?? '-'}`)
  }
  console.log(`  lanes in payload: ${p.lanes.map(l => l.lane).join(', ') || '(none)'}`)
  // cross-check: lane_chain_weekly argument shape copied from the cap watchdog
  const weekly = await rpc('lane_chain_weekly', { p_client_id: lane === 'ivan' ? null : lane, p_week_start: WEEK })
  if (!Array.isArray(weekly) || !weekly.length) { console.log('  xcheck: lane_chain_weekly returned no rows'); continue }
  if (!('reply_rate' in weekly[0])) { console.log('  xcheck: raw row', JSON.stringify(weekly[0])); continue }
  for (const w of weekly) {
    const c = p.lanes.find(x => x.lane === w.lane)?.cells.find(x => x.step === 'dm1')
    if (!c) { console.log(`  xcheck ${w.lane}: no dm1 cell in payload (weekly sends ${w.sends}, replied ${w.replied})`); continue }
    const wr = Number(w.reply_rate ?? 0)
    const diff = Math.abs(wr - c.rate)
    const flag = diff > 0.05 ? 'CHECK' : 'ok'
    if (flag === 'CHECK') bad++
    console.log(`  xcheck ${w.lane}: weekly reply_rate ${(wr * 100).toFixed(1)}% (${w.replied} replied / ${w.sends} sent / ${w.accepted} acc, thin=${w.thin}) vs payload dm1 ${(c.rate * 100).toFixed(1)}% ${flag}`)
  }
}
process.exit(bad ? 1 : 0)
