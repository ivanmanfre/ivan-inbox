/** Pure contract shared by the radar, replay tests and operator UI. */
export const POLICY_VERSION = 'market-v1'
export type Receipt = {
 id: string; client_id: string; platform: string; native_id: string; url: string;
 person_key: string; author_id: string; author_name: string; author_bio: string;
 role: string; role_quote: string; ownership: string; thread_id: string; origin_key: string;
 text: string; quote: string; relevant: boolean; substantive: boolean;
 proof_kind: string; is_reply: boolean; published_at: string; fetched_at: string; source_kind: string;
}
export type SourceCheck = { source: string; status: 'ok' | 'error'; checked_at: string }
export type EvidencePack = {
 client_id: string; event_at: string; post_by: string; buyer_reason: string;
 buyer_evidence_ids: string[]; factual_evidence_ids: string[]; receipts: Receipt[];
 snapshots: { at: string; receipt_ids: string[] }[]; checks: SourceCheck[];
 baselines?: { receipt_id: string; platform: string; age_bucket: string; metric: string; current: number; values: number[] }[];
}
export type MarketValidation = {
 status: 'validated' | 'watch' | 'unavailable'; policy_version: string; validated_at: string;
 evidence_item_ids: string[]; independent_people: number; original_threads: number; qualified_people: number;
 traction_route: 'growing_people' | 'substantive_replies' | 'above_baseline' | null;
 traction: Record<string, unknown>; buyer_reason: string; source_health: SourceCheck[]; failure_reasons: string[];
}
export function evaluateMarketEvidence(pack: EvidencePack, now: number): MarketValidation {
 const H = 3600000, failures: string[] = []
 const time = (s: string) => Date.parse(s)
 const recent = (s: string, ms: number) => Number.isFinite(time(s)) && time(s) <= now && now-time(s) <= ms
 const cited = (r: Receipt) => !!r.quote?.trim() && r.text?.includes(r.quote) && /^https:\/\//.test(r.url)
 const receipts = (pack.receipts || []).filter(r=>r.client_id==='swishdm' && cited(r) && recent(r.fetched_at,H))
 const eligible = receipts.filter(r=>['x','linkedin','reddit'].includes(r.platform) && r.relevant===true && r.substantive===true && r.ownership==='independent' && !!r.person_key && !!r.author_id && !!r.thread_id && !!r.origin_key && !!r.native_id && recent(r.published_at,6*H))
 // Syndicated copies have one origin; a person's cross-posts count once.
 const groups = new Set<string>(), people = new Map<string,Receipt>()
 for (const r of eligible) if (!groups.has(r.origin_key) && !people.has(r.person_key)) { groups.add(r.origin_key); people.set(r.person_key,r) }
 const voices = [...people.values()]
 const qualified = voices.filter(r=>['buyer','practitioner'].includes(r.role) && !!r.role_quote?.trim() && r.author_bio?.includes(r.role_quote))
 const threads = new Set(voices.map(r=>r.platform+':'+r.thread_id))
 const checks = (pack.checks||[]).filter(c=>recent(c.checked_at,H))
 const healthy = checks.some(c=>c.status==='ok' && ['x','linkedin','reddit'].includes(c.source))
 if (pack.client_id!=='swishdm') failures.push('wrong_client')
 if (!pack.buyer_reason?.trim() || !(pack.buyer_evidence_ids||[]).some(id=>voices.some(r=>r.id===id))) failures.push('buyer_relevance_missing')
 const fact = receipts.filter(r=>(pack.factual_evidence_ids||[]).includes(r.id))
 if (!fact.some(r=>r.proof_kind==='primary') && new Set(fact.filter(r=>r.proof_kind==='observation' && r.ownership==='independent').map(r=>r.person_key)).size<2) failures.push('factual_support_missing')
 if (voices.length<3) failures.push('independent_people_below_3')
 if (threads.size<2) failures.push('original_threads_below_2')
 if (qualified.length<2) failures.push('qualified_people_below_2')
 if (!Number.isFinite(time(pack.event_at)) || time(pack.event_at)>now) failures.push('event_time_missing')
 else if (now-time(pack.event_at)>24*H) failures.push('event_too_old')
 if (!Number.isFinite(time(pack.post_by)) || time(pack.post_by)-now<2*H) failures.push('review_window_short')
 let route: MarketValidation['traction_route']=null, traction: Record<string,unknown>={}
 const snapshots=(pack.snapshots||[]).filter(s=>recent(s.at,6*H)).sort((a,b)=>time(a.at)-time(b.at))
 for (const b of snapshots) for (const a of snapshots) {
  const mins=(time(b.at)-time(a.at))/60000
  if (mins<30 || mins>90) continue
  const before=new Set(voices.filter(r=>a.receipt_ids.includes(r.id)).map(r=>r.person_key))
  const added=voices.filter(r=>b.receipt_ids.includes(r.id) && !before.has(r.person_key) && r.source_kind==='live')
  if (added.length>=2 && now-time(b.at)<=H) { route='growing_people';traction={before:before.size,after:before.size+added.length,minutes:mins,from:a.at,to:b.at};break }
 }
 if (!route) for (const t of new Set(eligible.map(r=>r.platform+':'+r.thread_id))) {
  const replies=new Set(eligible.filter(r=>r.platform+':'+r.thread_id===t && r.is_reply && r.source_kind==='live').map(r=>r.person_key))
  if (replies.size>=5) {route='substantive_replies';traction={thread:t,replies:replies.size};break}
 }
 if (!route) for (const base of pack.baselines||[]) {
  const r=voices.find(r=>r.id===base.receipt_id && r.platform===base.platform && r.source_kind==='live')
  if (!r || base.values.length<10 || !['likes','replies'].includes(base.metric) || !Number.isFinite(base.current) || base.current<0 || base.values.some(v=>!Number.isFinite(v)||v<0)) continue
  const age=(now-time(r.published_at))/H, bucket=age<2?'0-2h':age<6?'2-6h':age<12?'6-12h':'12-24h'
  if (bucket!==base.age_bucket) continue
  const vs=[...base.values].sort((a,b)=>a-b), m=vs.length/2, median=vs.length%2?vs[Math.floor(m)]:(vs[m-1]+vs[m])/2
  if (median>0 && base.current>=2*median) {route='above_baseline';traction={receipt_id:r.id,metric:base.metric,current:base.current,median,sample:vs.length,multiple:base.current/median};break}
 }
 if (!route) failures.push('traction_missing')
 if (!healthy) failures.push('market_sources_unavailable')
 return {status:!healthy?'unavailable':failures.length?'watch':'validated',policy_version:POLICY_VERSION,validated_at:new Date(now).toISOString(),evidence_item_ids:receipts.map(r=>r.id),independent_people:voices.length,original_threads:threads.size,qualified_people:qualified.length,traction_route:route,traction,buyer_reason:pack.buyer_reason||'',source_health:checks,failure_reasons:failures}
}
