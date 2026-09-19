/* AUDN RUN 06 - Recommendation Writer (CONTRACTS 2.3). Secrets come from the Secrets node
   (n8n credential -> integration_config), never from a literal in this file. The resolver
   line below is copied VERBATIM from the Run 04 deployable pattern. */
const _S = (() => { for (const n of ["Secrets", "Secrets 2", "Secrets 3", "Secrets 4"]) { try { const r = $(n).all(); if (r && r.length) { const o = {}; for (const i of r) { if (i.json && i.json.key) o[i.json.key] = i.json.value; } if (o.n8n_sb_key) return o; } } catch (e) {} } throw new Error("harden_secrets_unavailable: no Secrets node ran before this Code node"); })();

// WHAT THIS NODE WRITES: ops_drafts rows of kind 'audn_recommendation' and NOTHING ELSE.
// It never touches client_ideas or lm_idea_candidates (only the approve RPC does, on
// Ivan's hand), and it has no path to outreach, carousels, schedules or any sender.
const START = Date.now();
// Actual runner task timeout2700s verified at build cutoff. Bound this node to900s.
const BUDGET_MS = 900000;
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1';
const KEY = _S.n8n_sb_key;
const HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const claudeUrl = 'https://claude-code-railway-production.up.railway.app/v1/messages';
const claudeKey = _S.railway_proxy_key;
const http = async (opts) => {
  const remaining = BUDGET_MS - (Date.now() - START) - 5000;
  if (remaining <= 0) throw new Error('audn_run_deadline');
  return this.helpers.httpRequest({ ...opts, timeout: Math.min(opts.timeout || (opts.method === 'GET' ? 45000 : 20000), remaining) });
};

const PROMPT_SLUG = 'audn-recommendation-writer';
const KIND = 'audn_recommendation';
const SOURCE_WINDOW_DAYS = 45;

const RUN_ISO = new Date().toISOString();
const enc = encodeURIComponent;
// Scheduled and manual runs share one immutable UTC week, including accepted slots.
const REQUEST = (() => {
  try { for (const it of $input.all()) { const j = it && it.json || {}; const b = j.body || j; if (b && ['preview','client_id','week_start','force_review_gap'].some(k => Object.prototype.hasOwnProperty.call(b,k))) return b; } } catch (e) {}
  return {};
})();
const PREVIEW = REQUEST.preview === true;
const monday = new Date(RUN_ISO.slice(0,10) + 'T00:00:00.000Z');
const weekday = monday.getUTCDay();
monday.setUTCDate(monday.getUTCDate() - (weekday + 6) % 7);
const CURRENT_WEEK = monday.toISOString().slice(0,10);
monday.setUTCDate(monday.getUTCDate() + 7);
const NEXT_WEEK = monday.toISOString().slice(0,10);
const WEEK_START = REQUEST.week_start === undefined ? (weekday === 0 || weekday === 6 ? NEXT_WEEK : CURRENT_WEEK) : REQUEST.week_start;
if (typeof WEEK_START !== 'string' || ![CURRENT_WEEK,NEXT_WEEK].includes(WEEK_START)) throw new Error('audn_invalid_week: current or next UTC Monday required');
const CYCLE_ID = 'weekly:' + WEEK_START;
const FORCE_GAP = false; // Weekly RPC branch owns the cap; legacy gap override is irrelevant.

const nz = (v) => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
const dOnly = (v) => { if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : null; };
const sourceGroup = url => {
  if (!url) return null;
  let u = String(url).replace(/#.*$/, '').replace(/^https?:\/\/(?:www\.)?([^/]+)/i, (_,host) => 'https://' + host.toLowerCase());
  const activity = u.match(/(?:linkedin\.com.*(?:activity-|urn:li:activity:))(\d+)/i);
  if (activity) return 'linkedin:' + activity[1];
  const tweet = u.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i);
  if (tweet) return 'x:' + tweet[1];
  const [path,query] = u.split('?');
  const kept = (query || '').split('&').filter(x => x && !/^(?:utm_[^=]*|fbclid|gclid|trk)=/i.test(x));
  return path.replace(/\/$/,'') + (kept.length ? '?' + kept.sort().join('&') : '');
};
const fresh = date => date !== null && Date.parse(date) <= Date.parse(RUN_ISO) && Date.parse(WEEK_START) - Date.parse(date) <= 14 * 864e5;
const shortName = (a) => { const s = String(a === null || a === undefined ? '' : a); const i = s.indexOf(' ('); return (i > 0 ? s.slice(0, i) : s).trim(); };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const medianOf = (xs) => {
  const a = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const getJson = async (path) => {
  const r = await http({ method: 'GET', url: SB + path, headers: HDR, json: true });
  if (!Array.isArray(r)) throw new Error('audn_required_read_shape:' + path.split('?')[0]);
  return r;
};

const getAll = async (path) => {
  const rows=[];
  for (let offset=0; ;offset+=500) {
    const page=await getJson(path+'&limit=500&offset='+offset);
    rows.push(...page);
    if (page.length<500) return rows;
  }
};

// Pure projection: full evidence remains local for validation and saved provenance.
function makeModelPack(pack) {
  const pick = (r,keys) => Object.fromEntries(keys.filter(k => r[k] !== undefined).map(k => [k,r[k]]));
  const short = v => String(v || '').toLowerCase().split(' (')[0].trim();
  const evidence = pack.evidence_items || [];
  const competitors = evidence.filter(e => e.kind === 'competitor').slice(0,12);
  const own = evidence.filter(e => e.kind === 'own_post').sort((a,b) => String(b.source_date || '').localeCompare(String(a.source_date || '')));
  const ownChosen = own.slice(0,4);
  const matched = (pack.measurement.matched_age || []).filter(r => Number.isFinite(r.standing_pct) && r.eligible_n >= (r.minimum_n || 20)).sort((a,b) => b.standing_pct-a.standing_pct);
  for (const row of [matched[0],matched[matched.length-1]]) {
    const found = row && own.find(e => String(e.native_id) === String(row.canonical_post_id));
    if (found && !ownChosen.includes(found)) ownChosen.push(found);
  }
  for (const e of own) if (ownChosen.length<6 && !ownChosen.includes(e)) ownChosen.push(e);
  const ownIds = new Set(ownChosen.map(e => String(e.native_id)));
  const publicQueues = ['news','trend'].map(kind => evidence.filter(e => e.kind===kind).sort((a,b) => String(b.source_date || '').localeCompare(String(a.source_date || ''))));
  const discovery = [];
  for (let i=0;discovery.length<6;i++) {
    let added=false;
    for (const queue of publicQueues) if (queue[i] && discovery.length<6) {discovery.push(queue[i]);added=true;}
    if (!added) break;
  }
  const selected = [...competitors,...ownChosen,...evidence.filter(e => ['founder','buyer_question'].includes(e.kind)),...discovery];
  const definitions = {}, definitionIds = new Map();
  const modelEvidence = selected.map(e => {
    const limitations = (e.limitations || []).map(text => {if (!definitionIds.has(text)) {const id='L'+(definitionIds.size+1);definitionIds.set(text,id);definitions[id]=text;}return definitionIds.get(text);});
    const out = {...pick(e,['id','kind','source_date','url','format','competitor_name','likes_count','comments_count','reposts_count','source_group']),excerpt:e.excerpt.slice(0,['founder','buyer_question'].includes(e.kind)?e.excerpt.length:1000),limitations};
    if (out.excerpt.length < e.excerpt.length) out.excerpt_truncated=true;
    if (e.location && e.location !== e.url) out.location=e.location;
    if (e.gate) out.gate=pick(e.gate,['is_gated','cta_kind','gate_keyword','offer','confidence','judged_at','rubric_version']);
    return out;
  });
  const measurement = {...pack.measurement};
  const relevant = r => ownIds.has(String(r.canonical_post_id || r.identity_post_social_id));
  const coverageRows = (measurement.coverage || []).filter(relevant);
  measurement.coverage = [...ownIds].map(id => {
    const rows=coverageRows.filter(r => String(r.canonical_post_id || r.identity_post_social_id)===id);
    const canonical=rows.find(r => r.row_kind==='canonical_post');
    return {canonical_post_id:id,source_rows:rows.length,canonical:canonical?pick(canonical,['collection_status','selected_snapshot_count','last_visited_at','resolution_status','unresolved_reason','note']):null,observed_status_counts:rows.reduce((o,r)=>{const k=r.collection_status || 'unknown';o[k]=(o[k] || 0)+1;return o;},{})};
  });
  const perMetric = new Map();
  for (const r of (measurement.matched_age || []).filter(relevant).sort((a,b)=>(b.target_age_days || 0)-(a.target_age_days || 0))) {
    const key=r.canonical_post_id+':'+r.metric;
    if (!perMetric.has(key)) perMetric.set(key,pick(r,['canonical_post_id','metric','value','status','minimum_n','missing_n','eligible_n','captured_at','cohort_basis','published_at','standing_pct','actual_age_days','target_age_days','p50','p75','p90']));
  }
  measurement.matched_age=[...perMetric.values()];
  measurement.classifications=(measurement.classifications || []).filter(relevant).map(r=>pick(r,['canonical_post_id','subject','hook','format','purpose','classified','confidence','classified_at','taxonomy_version']));
  // Monthly aggregates stay intact: re-summarizing them could change their cohort basis.
  const authors=new Set(competitors.map(e=>short(e.competitor_name)));
  const marketResearch={};
  for(const [table,rows]of Object.entries(pack.market_research || {})) marketResearch[table]=rows.slice(0,3).map(r=>({run_id:r.run_id,captured_at:r.created_at,freshness:r.freshness,limitation:r.limitation,theme:r.theme,section:r.section,headline:r.reading && String(r.reading.headline || '').slice(0,300),editorial_suggestion:r.reading && String(r.reading.change || '').slice(0,300)}));
  const prior = (pack.already_recommended || []).slice().sort((a,b)=>(a.source==='proposal'?0:1)-(b.source==='proposal'?0:1));
  const already=prior.slice(0,40).map(r=>({...pick(r,['source','recommendation_id','topic_key']),subject:String(r.subject || '').slice(0,160),original_angle:String(r.original_angle || '').slice(0,160)}));
  const feedbackDate = r => Math.max(Date.parse(r.decided_at || '') || 0,...(r.linked_results || []).map(x => Date.parse(x.captured_at || x.measured_at || x.published_at || '') || 0));
  const feedback=(pack.previous_decisions_and_results || []).slice().sort((a,b) => Number(b.decision_source === 'weekly_review') - Number(a.decision_source === 'weekly_review') || feedbackDate(b) - feedbackDate(a)).slice(0,12);
  const selectedKinds=Object.fromEntries(['competitor','own_post','founder','buyer_question','news','trend'].map(kind=>[kind,{available:selected.filter(e=>e.kind===kind).length,fresh:selected.filter(e=>e.kind===kind && e.source_date && Date.parse(pack.week_start)-Date.parse(e.source_date)<=14*864e5 && Date.parse(e.source_date)<=Date.parse(pack.generated_at)).length}]));
  const sourcePool=pack.coverage.source_pool_selection || pack.coverage.source_selection || pack.source_selection;
  const coverage={...pack.coverage,kinds:selectedKinds,source_pool_selection:sourcePool,source_selection:{...sourcePool,included_n:competitors.length,omitted_n:sourcePool.candidate_n-competitors.length,method:'roster_round_robin_model_view',max_rows:12},model_selection:{candidate_evidence_n:evidence.length,included_evidence_n:selected.length,omitted_evidence_n:evidence.length-selected.length,own_included:ownChosen.length,own_omitted:own.length-ownChosen.length,public_included:discovery.length,public_omitted:evidence.filter(e=>['news','trend'].includes(e.kind)).length-discovery.length,feedback_included:feedback.length,feedback_omitted:(pack.previous_decisions_and_results || []).length-feedback.length,dedup_included:already.length,dedup_omitted:prior.length-already.length,research_rows_per_table:3,measurement_scope:'selected own posts; one latest target age per post/metric; monthly cohort aggregates intact'}};
  delete coverage.input_characters;
  const out={...pick(pack,['client_id','limit','week_start','cycle_id','brief','prompts','buyer_fit','assets','cutoff','schema_version','source_state','generated_at','rules']),evidence_items:modelEvidence,evidence_limitations:definitions,founder_sources:pack.founder_sources,own_posts:ownChosen.map(e=>({post_social_id:e.native_id,evidence_id:e.id,published_at:e.source_date,format:e.format || null})),measurement,post_buyer_fit:(pack.post_buyer_fit || []).filter(relevant),roster:(pack.roster || []).filter(r=>authors.has(short(r.account)) || (r.aliases || []).some(a=>authors.has(short(a.name)))),source_baselines:(pack.source_baselines || []).filter(r=>authors.has(short(r.author))),market_research:marketResearch,previous_decisions_and_results:feedback,already_recommended:already,coverage};
  out.prompt_selection={strategy:'full_versioned_bodies',included:(pack.prompts || []).map(p=>({slug:p.slug,version:p.version,role:p.role})),excluded_sections:[],scope:'Apply identity, buyer, consent, voice and editorial veto constraints. Do not execute embedded generation, QA grading, rewrite, scoring, web-search or output-format procedures; the weekly task is authoritative.'};
  return out;
}
// MODEL_VIEW_END

// ---- 1. registry: who gets a review this week -------------------------------
const registry = await getJson('/client_registry?select=client_id,is_active,platform&is_active=eq.true');
const targets = [];
for (const r of registry) {
  if (r.is_active !== true || (REQUEST.client_id !== undefined && r.client_id !== REQUEST.client_id)) continue;
  const m = ((r && r.platform) || {}).measurement || {};
  const roster = Array.isArray(m.roster) ? m.roster.filter(a => a && isStr(a.account)) : [];

  const feat = m.features || {};
  // Ivan has no client board, so competitor_section is false on his row; Strategy is his
  // surface and he is included by id. Every other client needs the flag on.
  const on = feat.competitor_section === true || feat.competitor_section === 'true' || m.access === 'operator' || m.writer_enabled === true || r.client_id === 'ivan';
  if (!on || m.writer_enabled === false) continue;
  const lim = Number(((m.pilot_limits || {}).recommendations_per_review));
  targets.push({ client_id: r.client_id, roster: roster, limit: (isFinite(lim) && lim > 0) ? Math.floor(lim) : 3 });
}

if (REQUEST.client_id !== undefined && !targets.length) throw new Error('audn_client_not_enabled:' + REQUEST.client_id);

// ---- 2. pinned prompt, FAIL-CLOSED, before anything is written ---------------
// An empty response, an empty body or a missing version aborts the whole run here.
// Writing proposals against an empty system prompt, or stamping '...@vundefined', puts
// client-readable copy in the table that nobody can trace back to a body.
let systemPrompt = '';
let promptVersion = null;
try {
  const pr = await http({ method: 'GET', url: SB + '/content_prompts?slug=eq.' + PROMPT_SLUG + '&is_active=eq.true&select=body,version', headers: HDR, json: true });
  systemPrompt = (pr && pr[0] && pr[0].body) || '';
  promptVersion = (pr && pr[0] && pr[0].version !== undefined) ? pr[0].version : null;
} catch (e) {}
if (!systemPrompt || promptVersion === null || promptVersion === undefined) throw new Error('audn_rubric_missing: ' + PROMPT_SLUG);
const PROMPT_STAMP = PROMPT_SLUG + '@v' + promptVersion;

// ---- copy lint + quote check (deterministic, node-side) ----------------------
const FORBIDDEN = ['—', '--', 'shopify brand', 'guarantee', 'will book', 'revenue', 'pipeline will'];
const quotedSpans = (s) => {
  const out = [];
  const str = String(s || '');
  let m;
  const re1 = /"([^"]{25,})"/g;
  while ((m = re1.exec(str)) !== null) out.push(m[1]);
  const re2 = /“([^”]{25,})”/g;
  while ((m = re2.exec(str)) !== null) out.push(m[1]);
  return out;
};

const summary = { run_at: RUN_ISO, cycle_id: CYCLE_ID, prompt: PROMPT_STAMP, preview: PREVIEW, week_start: WEEK_START, clients: [] };

const prepared = [];
for (const t of targets) {
  const cid = t.client_id;
  const rec = { client_id: cid, skipped: false, reason: null, pack_ids: [], proposed: 0, dropped: [], writer_bail: false, prompt: PROMPT_STAMP };
  summary.clients.push(rec);
  if (Date.now() - START > BUDGET_MS - 280000) { rec.skipped = true; rec.reason = 'run_budget_exhausted'; continue; }

  // An existing cycle is final even if its proposals have since been accepted.
  const cycles = await getJson('/audn_writer_cycles?select=*&client_id=eq.' + enc(cid) + '&cycle_id=eq.' + enc(CYCLE_ID) + '&limit=1');
  if (cycles.length) { rec.skipped = true; rec.already_committed = true; rec.reason = 'already_committed'; continue; }
  // Recent history includes every status, with a fixed input bound independent of queue size.
  const historySince = new Date(Date.now() - 90 * 864e5).toISOString();
  const historyRows = await getJson('/ops_drafts?select=id,body,context,created_at,approved_at,sent_at&kind=eq.' + KIND + '&client_id=eq.' + enc(cid) + '&created_at=gte.' + enc(historySince) + '&order=created_at.desc,id.asc&limit=121');
  const openRows = historyRows.slice(0,120);
  const historyCoverage = {window_days:90,included:openRows.length,max_rows:120,omitted_at_least:Math.max(0,historyRows.length - openRows.length),older_history_excluded:true,exhaustive:historyRows.length <= 120};

  // ---- 4. Required scoped evidence. Read failures throw before model or writes.
  const context = await http({ method: 'POST', url: SB + '/rpc/audn_writer_context', headers: HDR, body: { p_client_id: cid }, json: true, timeout:45000 });
  if (!context || context.client_id !== cid || !context.brief || !Array.isArray(context.own_posts) || !context.measurement || !context.buyer_fit || !Array.isArray(context.previous_decisions_and_results)) {
    throw new Error('audn_required_context_invalid:' + cid);
  }
  context.own_posts = context.own_posts.filter(r => !r.client_id || r.client_id === cid);
  // Retain recent material plus measured standing extremes; never crop serialized JSON.
  const allOwn = context.own_posts.slice().sort((a,b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
  const matched = Array.isArray(context.measurement.matched_age) ? context.measurement.matched_age : [];
  const measured = matched.filter(r => Number.isFinite(r.standing_pct) && r.eligible_n >= (r.minimum_n || 20)).sort((a,b) => b.standing_pct - a.standing_pct);
  const ownIds = new Set(allOwn.slice(0,18).map(r => String(r.post_social_id)));
  for (const r of [...measured.slice(0,6),...measured.slice(-6)]) if (allOwn.some(p => String(p.post_social_id) === String(r.canonical_post_id))) ownIds.add(String(r.canonical_post_id));
  for (const r of allOwn) if (ownIds.size < 30) ownIds.add(String(r.post_social_id));
  context.own_posts = allOwn.filter(r => ownIds.has(String(r.post_social_id)));
  const ownSelection = {candidate_n:allOwn.length,included_n:context.own_posts.length,omitted_n:allOwn.length-context.own_posts.length,method:'18_most_recent_plus_matched_age_standing_extremes_then_recent_to_30',maximum_posts:30,excerpt_max_characters:1800};
  const measurementSelection = {};
  const compactMeasurement = {...context.measurement};
  for (const key of ['coverage','classifications','matched_age']) {
    const rows = Array.isArray(context.measurement[key]) ? context.measurement[key] : [];
    const selected = rows.filter(r => [r.canonical_post_id,r.identity_post_social_id].some(id => ownIds.has(String(id))));
    compactMeasurement[key] = selected;
    measurementSelection[key] = {candidate_n:rows.length,included_n:selected.length,omitted_n:rows.length-selected.length,scope:'selected_own_posts_only',whole_account_summary:key === 'coverage' ? rows.reduce((out,r) => {const status=r.collection_status || 'unknown';out[status]=(out[status] || 0)+1;return out;},{}) : null};
  }
  if (Array.isArray(context.post_buyer_fit)) context.post_buyer_fit = context.post_buyer_fit.filter(r => ownIds.has(String(r.canonical_post_id)));
  context.previous_decisions_and_results = context.previous_decisions_and_results.filter(r => !r.client_id || r.client_id === cid);
  for (const r of openRows) {
    const decision = (r.context || {}).weekly_decision;
    if (!decision || decision.decision !== 'rejected') continue;
    const prior = context.previous_decisions_and_results.find(x => x.recommendation_id === r.id);
    const rejection = {client_id:cid,recommendation_id:r.id,decision:'rejected',decision_reason:decision.reason || null,decided_at:decision.decided_at || null,decision_source:'weekly_review',linked_results:prior && prior.linked_results || []};
    if (prior) Object.assign(prior,rejection); else context.previous_decisions_and_results.push(rejection);
  }
  const allowedSubjects = Array.isArray(context.brief.subjects) ? context.brief.subjects : [];
  if (!allowedSubjects.length) throw new Error('audn_subject_contract_missing:' + cid);
  const approvedSources = (context.sources || []).filter(x => x.client_id === cid && x.writer_eligible === true && x.state === 'approved' && x.source_id && x.location && x.excerpt && x.consent && x.consent.state === 'approved' && Array.isArray(x.consent.purpose) && x.consent.purpose.includes('drafting') && x.revoked_at == null && !/(?:consent|permission)/i.test(x.source_id) && x.content_evidence !== false);

  // roster accounts, matched to the collector's competitor_name (the part before ' (')
  const rosterOut = t.roster.map(a => ({ account: String(a.account), role: a.role === undefined ? null : a.role, url: a.url === undefined ? null : a.url, reason: a.reason || null, aliases: Array.isArray(a.aliases) ? a.aliases.filter(x => x && isStr(x.name) && isStr(x.url_owner)).map(x => ({ name: String(x.name), url_owner: String(x.url_owner).toLowerCase() })) : [] }));
  const roleByName = {};
  const accountByName = {};
  for (const a of rosterOut) {
    roleByName[nz(a.account)] = a.role;
    accountByName[nz(a.account)] = a.account;
    const s = shortName(a.account);
    if (s && !roleByName[nz(s)]) { roleByName[nz(s)] = a.role; accountByName[nz(s)] = a.account; }
    for (const alias of a.aliases) {
      roleByName[nz(alias.name)] = a.role;
      accountByName[nz(alias.name)] = a.account;
    }
  }
  const names = [];
  for (const a of rosterOut) {
    for (const name of [shortName(a.account), ...a.aliases.map(x => x.name)]) if (name && names.indexOf(name) < 0) names.push(name);
  }

  let compRows = [];
  if (names.length) {
    const sinceIso = new Date(Date.now() - SOURCE_WINDOW_DAYS * 864e5).toISOString();
    const inList = '(' + names.map(n => '"' + n.replace(/"/g, '') + '"').join(',') + ')';
    // Ivan's lane still lives in competitor_posts; every client lane was moved to
    // audn_competitor_posts on 2026-09-12 (migration 13) because five active Ivan
    // workflows read competitor_posts with no client filter. Reading the wrong table
    // here returns zero rows and the week's review is written from nothing.
    if (cid === 'ivan') {
      compRows = await getAll('/competitor_posts?select=id,competitor_name,post_date,likes_count,comments_count,reposts_count,linkedin_post_url,post_text,post_type,post_topic,hook_pattern&post_date=gte.' + enc(sinceIso) + '&competitor_name=in.' + enc(inList) + '&order=post_date.desc,id.asc');
    } else {
      // audn_competitor_posts carries no post_topic / hook_pattern; suggested_angle is
      // the nearest column the harvest fills, and the writer treats it as the topic hint.
      const cr = await getAll('/audn_competitor_posts?select=id,competitor_name,post_date,likes_count,comments_count,reposts_count,linkedin_post_url,post_text,post_type,suggested_angle&client_id=eq.' + enc(cid) + '&post_date=gte.' + enc(sinceIso) + '&competitor_name=in.' + enc(inList) + '&order=post_date.desc,id.asc');
      compRows = cr.map(r => ({ ...r, post_topic: (r.suggested_angle === undefined ? null : r.suggested_angle), hook_pattern: null }));
    }
  }
  const aliasOwnerByName = {};
  for (const a of rosterOut) for (const alias of a.aliases) aliasOwnerByName[nz(alias.name)] = alias.url_owner;
  compRows = compRows.filter(r => {
    const owner = aliasOwnerByName[nz(r.competitor_name)];
    return !owner || String(r.linkedin_post_url || '').toLowerCase().includes('/posts/' + owner + '_');
  });
  if (new Set(compRows.map(r => String(r.id))).size !== compRows.length) throw new Error('audn_duplicate_source_identity:' + cid);
  const SOURCE_TEXT_BUDGET = 72000;
  const MAX_SOURCE_ROWS = 80;
  const sourceQueues = names.map(name => compRows.filter(r => nz(shortName(r.competitor_name)) === nz(name)));
  const selectedSources = [];
  const selectedIds = new Set();
  let sourceTextRemaining = SOURCE_TEXT_BUDGET;
  for (let round = 0; selectedSources.length < MAX_SOURCE_ROWS && sourceTextRemaining > 0; round++) {
    let any = false;
    for (const queue of sourceQueues) {
      const r = queue[round];
      if (!r || selectedIds.has(String(r.id))) continue;
      any = true;
      const excerpt = String(r.post_text || '').slice(0, Math.min(1800, sourceTextRemaining));
      sourceTextRemaining -= excerpt.length;
      selectedIds.add(String(r.id));
      selectedSources.push({...r, selected_excerpt: excerpt});
      if (selectedSources.length >= MAX_SOURCE_ROWS || sourceTextRemaining <= 0) break;
    }
    if (!any) break;
  }
  const sourceBaselines = names.map(name => {
    const values = compRows.filter(r => nz(shortName(r.competitor_name)) === nz(name)
      && Number.isFinite(r.likes_count) && r.likes_count >= 0 && Number.isFinite(r.comments_count) && r.comments_count >= 0)
      .map(r => r.likes_count + r.comments_count);
    return {author:name, metric:'engagement_count', basis:'latest_observed_reactions_plus_comments',
      n:values.length, minimum_n:8, supported:values.length>=8, median:values.length>=8?medianOf(values):null,
      window_days:SOURCE_WINDOW_DAYS, age_comparability:'not_matched', impressions:'unknown'};
  });
  const packRows = selectedSources.map(r => ({
    id: String(r.id),
    competitor_name: r.competitor_name,
    post_date: dOnly(r.post_date),
    likes_count: r.likes_count === undefined ? null : r.likes_count,
    comments_count: r.comments_count === undefined ? null : r.comments_count,
    reposts_count: r.reposts_count === undefined ? null : r.reposts_count,
    linkedin_post_url: r.linkedin_post_url === undefined ? null : r.linkedin_post_url,
    post_text: r.selected_excerpt,
    format: r.post_type || null,
    text_coverage: String(r.post_text || '').length > r.selected_excerpt.length ? 'excerpt_truncated' : 'stored_text',
    post_topic: r.post_topic === undefined ? null : r.post_topic,
    hook_pattern: r.hook_pattern === undefined ? null : r.hook_pattern,
  }));
  const gateByUrl = {};
  const gateRefs = packRows.map(r => r.linkedin_post_url).filter(Boolean);
  for (let i=0;i<gateRefs.length;i+=25) {
    const refs = '(' + gateRefs.slice(i,i+25).map(u => '"' + u.replace(/"/g,'') + '"').join(',') + ')';
    const gates = await getJson('/competitor_gated_posts?select=post_ref,client_id,is_gated,cta_kind,gate_keyword,offer,confidence,why,judged_at,model,rubric_version&client_id=eq.' + enc(cid) + '&post_ref=in.' + enc(refs) + '&limit=25');
    for (const g of gates) if (g.client_id === cid && gateRefs.includes(g.post_ref)) gateByUrl[g.post_ref] = {is_gated:g.is_gated,cta_kind:g.cta_kind,gate_keyword:g.gate_keyword,offer:g.offer,confidence:g.confidence,why:g.why,judged_at:g.judged_at,model:g.model,rubric_version:g.rubric_version};
  }
  const evidenceItems = packRows.map(r => ({
    id:'competitor:' + r.id, native_id:r.id, kind:'competitor', client_id:cid,competitor_name:r.competitor_name,likes_count:r.likes_count,comments_count:r.comments_count,reposts_count:r.reposts_count,post_topic:r.post_topic,hook_pattern:r.hook_pattern,
    source_date:r.post_date, location:r.linkedin_post_url, url:r.linkedin_post_url, excerpt:r.post_text,
    source_group:sourceGroup(r.linkedin_post_url),format:r.format,gate:gateByUrl[r.linkedin_post_url] || null,
    table:cid === 'ivan' ? 'competitor_posts' : 'audn_competitor_posts',
    limitations:['Observed reactions/comments are not a performance forecast; ages and impressions are not matched.', r.text_coverage]
  }));
  for (const r of context.own_posts) {
    if ((r.client_id && r.client_id !== cid) || !r.post_social_id || !isStr(r.text)) continue;
    evidenceItems.push({id:'own_post:' + r.post_social_id,native_id:String(r.post_social_id),kind:'own_post',client_id:cid,source_date:dOnly(r.published_at),location:r.url || null,url:r.url || null,excerpt:r.text.slice(0,1800),table:'audn_writer_context.own_posts',format:r.format || null,limitations:['Own post text proves what was published, not that it succeeded. Only supplied eligible measurement can support performance claims.']});
  }
  for (const r of approvedSources) evidenceItems.push({id:(r.kind === 'buyer_question' ? 'buyer_question:' : 'founder:') + r.source_id,native_id:r.source_id,kind:r.kind === 'buyer_question' ? 'buyer_question' : 'founder',client_id:cid,source_date:dOnly(r.source_date || r.published_at),location:r.location,url:r.url || null,excerpt:r.excerpt,table:'audn_writer_context.sources',limitations:[...(r.restrictions || []),'Drafting permission is not publication approval.']});
  // Reuse stored public discovery only. No new scraping and no private mixed call bank.
  const PUBLIC_SOURCES = ['breaking_news','novelty','hacker_news','reddit_se','x_search','youtube_watch'];
  const leads = cid === 'ivan'
    ? await getJson('/lm_idea_candidates?select=id,source,raw_topic,normalized_topic,evidence,ingested_at&source=in.(' + PUBLIC_SOURCES.join(',') + ')&order=ingested_at.desc&limit=100')
    : await getJson('/client_ideas?select=id,client_id,source_label,source_ref,meta,created_at&client_id=eq.' + enc(cid) + '&order=created_at.desc&limit=100');
  let unsupportedLeads = 0;
  for (const r of leads) {
    const origin = cid === 'ivan' ? r.source : (r.meta || {}).source;
    if (!PUBLIC_SOURCES.includes(origin) || (cid !== 'ivan' && r.client_id !== cid)) { unsupportedLeads++; continue; }
    const evs = cid === 'ivan' ? r.evidence : (r.meta || {}).evidence;
    let included = false;
    for (const [idx,e] of (Array.isArray(evs) ? evs : []).entries()) {
      if (!e || (e.client_id && e.client_id !== cid) || (e.source && !PUBLIC_SOURCES.includes(e.source))) continue;
      const url = e.url || e.thread_url;
      const excerpt = e.excerpt || e.quote;
      if (!/^https?:\/\//.test(url || '') || !isStr(excerpt)) continue;
      const kind = ['breaking_news','novelty','hacker_news'].includes(origin) ? 'news' : 'trend';
      // These timestamps are nested source metadata, never idea creation/ingestion dates.
      const date = dOnly(e.published_at || e.shipped_at || e.source_date || e.created_at);
      evidenceItems.push({id:kind + ':' + r.id + ':' + idx,native_id:r.id,kind,source_origin:origin,client_id:cid,source_date:date,location:url,url,excerpt:excerpt.slice(0,1800),table:cid === 'ivan' ? 'lm_idea_candidates.evidence' : 'client_ideas.meta.evidence',limitations:['Stored public source excerpt, not independently verified in this run.','Discovery angle and generated interpretations are not factual evidence.',...(e.unverified_stats ? ['Source includes unverified statistics; do not repeat them as facts.'] : []),...(date ? [] : ['Source date unavailable; ineligible for timely slot.'])]});
      included = true;
    }
    if (!included) unsupportedLeads++;
  }
  // The same public source may be discovered in several idea rows or feeds.
  const sourceGroups = new Set();
  let duplicateEvidence = 0;
  for (let i=0;i<evidenceItems.length;) {
    const r = evidenceItems[i];
    r.source_group = sourceGroup(r.url) || r.id;
    if (sourceGroups.has(r.source_group)) { evidenceItems.splice(i,1); duplicateEvidence++; }
    else { sourceGroups.add(r.source_group); i++; }
  }
  const discoveryCandidates = evidenceItems.filter(r => ['news','trend'].includes(r.kind));
  const discoveryQueues = PUBLIC_SOURCES.map(origin => discoveryCandidates.filter(r => r.source_origin === origin));
  const discoverySelected = new Set();
  for (let round=0;discoverySelected.size<24;round++) {
    let found = false;
    for (const queue of discoveryQueues) {
      if (queue[round]) { discoverySelected.add(queue[round].id); found=true; }
      if (discoverySelected.size>=24) break;
    }
    if (!found) break;
  }
  for (let i=evidenceItems.length-1;i>=0;i--) if (['news','trend'].includes(evidenceItems[i].kind) && !discoverySelected.has(evidenceItems[i].id)) evidenceItems.splice(i,1);
  const rowById = {};
  for (const r of evidenceItems) rowById[r.id] = r;
  rec.pack_ids = evidenceItems.map(r => r.id);
  const research = {};
  const researchSelection = {};
  for (const table of ['client_research_insights','client_research_themes']) {
    const latest = await getJson('/' + table + '?select=run_id,created_at&client_id=eq.' + enc(cid) + '&order=created_at.desc&limit=1');
    const rows = latest.length ? await getJson('/' + table + '?select=*&client_id=eq.' + enc(cid) + '&run_id=eq.' + enc(latest[0].run_id) + '&limit=13') : [];
    researchSelection[table] = {fetched_n:rows.length,included_n:Math.min(12,rows.length),omitted_at_least:Math.max(0,rows.length-12),max_rows:12,exhaustive:rows.length<=12};
    research[table] = rows.filter(r => r.client_id === cid).slice(0,12).map(r => ({...r,freshness:fresh(dOnly(r.created_at)) ? 'recent_capture' : 'historical',limitation:'Generated research context, not primary evidence. Captured date is not event date. Recompute baselines from current roster rows.'}));
  }
  rec.coverage = {own_selection:ownSelection,measurement_selection:measurementSelection,research_selection:researchSelection,discovery_selection:{fetched_leads:leads.length,max_leads:100,eligible_distinct_sources:discoveryCandidates.length,included_n:discoverySelected.size,omitted_at_least:discoveryCandidates.length-discoverySelected.size,max_evidence_items:24,method:'round_robin_public_source_types_then_recent',exhaustive:leads.length<100 && discoveryCandidates.length===discoverySelected.size},recommendation_history:historyCoverage,kinds:Object.fromEntries(['competitor','own_post','founder','buyer_question','news','trend'].map(kind => [kind,{available:evidenceItems.filter(e => e.kind === kind).length,fresh:evidenceItems.filter(e => e.kind === kind && fresh(e.source_date)).length}])),unsupported_discovery_leads:unsupportedLeads,duplicate_evidence_omitted:duplicateEvidence,unavailable_sources:(context.sources || []).filter(x => !approvedSources.includes(x)).map(x => ({source_id:x.source_id,state:'unavailable'})),research_captures:Object.fromEntries(Object.entries(research).map(([k,v])=>[k,v.length ? {run_id:v[0].run_id,captured_at:v[0].created_at,freshness:v[0].freshness} : null]))};

  // already recommended: the lane's idea store plus this lane's open proposals
  const already = [];
  if (cid === 'ivan') {
    const lm = await getJson('/lm_idea_candidates?select=source_ref,raw_topic,raw_context&source=eq.audience_review&order=ingested_at.desc&limit=120');
    for (const r of lm) already.push({ source: 'idea', subject: String(r.raw_topic || '').slice(0, 400), source_ids: [] });
  } else {
    const ci = await getJson('/client_ideas?select=source_ref,hook,meta&client_id=eq.' + enc(cid) + '&source_ref=like.audn-rec:*&order=created_at.desc&limit=120');
    for (const r of ci) {
      const ev = (((r.meta || {}).audn) || {}).evidence || {};
      already.push({ source: 'idea', subject: String(r.hook || '').slice(0, 400), source_ids: Array.isArray(ev.source_ids) ? ev.source_ids : [] });
    }
  }
  for (const r of openRows) {
    const ev = (((r.context || {}).audn) || {}).evidence || {};
    already.push({ source: 'proposal', recommendation_id:r.id, subject: String(r.body || '').slice(0, 400), topic_key:(((r.context || {}).audn || {}).weekly || {}).topic_key || null, original_angle:((r.context || {}).audn || {}).original_angle || null, source_groups:((r.context || {}).source_rows || []).map(x => x.source_group || sourceGroup(x.url)).filter(Boolean), source_ids: Array.isArray(ev.source_ids) ? ev.source_ids : [] });
  }

  const pack = {
    ...context,
    client_id: cid,
    limit: t.limit,
    week_start: WEEK_START,
    cycle_id: CYCLE_ID,
    evidence_items: evidenceItems,
    coverage: rec.coverage,
    market_research: research,
    roster: rosterOut,
    own_posts: context.own_posts.map(({text,...r}) => ({...r,evidence_id:'own_post:' + r.post_social_id})),
    measurement: compactMeasurement,
    source_baselines: sourceBaselines,
    source_selection: {candidate_n:compRows.length,included_n:packRows.length,omitted_n:compRows.length-packRows.length,method:'roster_round_robin_most_recent_first',text_budget_characters:SOURCE_TEXT_BUDGET,max_rows:MAX_SOURCE_ROWS,exhaustive:compRows.length===packRows.length},
    founder_sources: approvedSources.map(({excerpt,...r}) => ({...r,evidence_id:(r.kind === 'buyer_question' ? 'buyer_question:' : 'founder:') + r.source_id})),
    sources: [],
    already_recommended: already,
    generated_at: RUN_ISO,
    rules: {
      subject_ids: allowedSubjects,
      required_output: ['client_id','subject','buyer_relevance','original_angle','next_action'],
      own_performance: 'Use only supplied metric, eligible_n, target_age_days and capture basis; no claim if unavailable or below floor.',
      sources: 'Cite only evidence_items typed ids and exact source_date; founder_sources requires drafting consent. Market research and discovery angles are not primary evidence.',
      feedback: 'Use prior decision reasons and linked_results; a no-repeat list alone is not feedback.',
      approval: 'Client accept records intent; operator uses normal idea approval before generation/publication.'
    }
  };

  rec.coverage.source_selection = pack.source_selection;
  rec.coverage.input_characters = Object.fromEntries(Object.entries(pack).filter(([k]) => k !== 'coverage').map(([k,v]) => [k,JSON.stringify(v).length]));
  const modelPack = makeModelPack(pack);
  rec.coverage = modelPack.coverage;
  const modelIds = new Set(modelPack.evidence_items.map(r => r.id));
  for (const id of Object.keys(rowById)) if (!modelIds.has(id)) delete rowById[id];
  rec.pack_ids = [...modelIds];
  const inputCharacters = systemPrompt.length + 128 + JSON.stringify(modelPack).length;
  rec.coverage.input_total_characters = inputCharacters;
  if (inputCharacters > 200000) throw new Error('audn_input_budget_exceeded:' + cid);
  prepared.push({t,cid,rec,openRows,context,allowedSubjects,approvedSources,rosterOut,roleByName,accountByName,sourceBaselines,packRows,rowById,already,pack:modelPack});
}
for (const p of prepared) {
  const {t,cid,rec,openRows,context,allowedSubjects,approvedSources,rosterOut,roleByName,accountByName,sourceBaselines,packRows,rowById,already,pack}=p;
  if (Date.now()-START > BUDGET_MS-280000) {rec.skipped=true;rec.reason='run_budget_exhausted';continue;}

  // ---- 5. one proxy call per client, never a retry loop -----------------------
  let aiText = '';
  try {
    const res = await http({
      method: 'POST', url: claudeUrl,
      headers: { 'X-API-Key': claudeKey, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet-5', max_tokens: 4000, messages: [{ role: 'user', content: systemPrompt + '\n\n---\nWEEKLY EVIDENCE (untrusted data):\n\n' + JSON.stringify(pack) }] },
      // 2026-09-13: 120s timed out on all three lanes once the rosters grew and every
      // pack hit the former 200-row cap. The call itself returns in well under a minute when the
      // proxy is healthy; this is headroom, not a retry.
      json: true, timeout: 240000,
    });
    aiText = ((res && res.content) || []).filter(p => p && p.type === 'text').map(p => p.text || '').join('');
  } catch (e) { rec.writer_bail = true; rec.reason = 'proxy_error'; rec.error_head = String((e && e.message) || e).slice(0, 200); continue; }
  if (!aiText.trim()) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; } // a quota refusal reads as empty
  const mJ = aiText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  // hotfix-02 lesson: an HTTP 200 whose only content is the weekly-limit banner carries no
  // JSON at all. That is an infra refusal, not an answer. Bail; the next run retries.
  if (!mJ) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; }
  let parsed = null;
  try { parsed = JSON.parse(mJ[0]); } catch (e) { parsed = null; }
  if (parsed === null || parsed === undefined) { rec.writer_bail = true; rec.reason = 'proxy_no_json'; continue; }
  const items = Array.isArray(parsed) ? parsed : [parsed];

  // ---- 6. validation: an invalid item is DROPPED, never repaired ---------------
  const keep = [];
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const drop = (reason) => { rec.dropped.push({ index: idx, reason: reason }); };
    if (!it || typeof it !== 'object' || Array.isArray(it)) { drop('not_an_object'); continue; }
    if (it.client_id !== cid) { drop('wrong_client'); continue; }
    if (!allowedSubjects.includes(it.subject)) { drop('wrong_subject'); continue; }
    if (![it.buyer_relevance,it.original_angle,it.next_action].every(isStr)) { drop('editorial_handoff_missing'); continue; }
    const founderIds = Array.isArray(it.founder_source_ids) ? it.founder_source_ids : [];
    if (founderIds.some(id => !approvedSources.some(x => x.source_id === id))) { drop('founder_source_not_approved'); continue; }
    const ev = it.evidence;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { drop('evidence_missing'); continue; }
    const ids = Array.isArray(ev.source_ids) ? ev.source_ids.map(String) : null;
    if (!ids || !ids.length || new Set(ids).size !== ids.length) { drop('source_ids_empty'); continue; }
    let unknownId = false;
    for (const id of ids) if (!rowById[id]) unknownId = true;
    if (unknownId) { drop('source_id_not_in_pack'); continue; }
    const cited = ids.map(id => rowById[id]);
    if (cited.filter(r => ['founder','buyer_question'].includes(r.kind)).some(r => !founderIds.includes(r.native_id)) || founderIds.some(id => !cited.some(r => r.native_id === id && ['founder','buyer_question'].includes(r.kind)))) { drop('founder_citation_mismatch'); continue; }
    const dates = Array.isArray(ev.source_dates) ? ev.source_dates : null;
    const want = cited.map(r => r.source_date);
    if (!dates || dates.length !== want.length || JSON.stringify(dates) !== JSON.stringify(want)) { drop('source_dates_mismatch'); continue; }
    if (ev.sample_n !== ids.length) { drop('sample_n_mismatch'); continue; }
    if (typeof ev.unknowns !== 'string') { drop('unknowns_missing'); continue; }
    if (!isStr(it.what_changed) || !isStr(it.why_it_matters) || !isStr(it.could_publish) || !isStr(it.proof_needed)) { drop('text_field_empty'); continue; }
    if (!isStr(it.title) || it.title.length > 80) { drop('title_invalid'); continue; }
    const accs = Array.isArray(it.roster_accounts) ? it.roster_accounts.map(String) : null;
    const competitorCited = cited.filter(r => r.kind === 'competitor');
    if (!accs || (competitorCited.length && !accs.length)) { drop('roster_accounts_empty'); continue; }
    if (!competitorCited.length && (accs.length || it.roster_role !== null)) { drop('unrelated_roster_claim'); continue; }
    if (competitorCited.length) {
      const roles = [...new Set(accs.map(a => roleByName[nz(a)]))];
      if (roles.includes(undefined)) { drop('roster_account_not_in_roster'); continue; }
      if (roles.length !== 1) { drop('roster_role_mixed'); continue; }
      if (String(it.roster_role) !== String(roles[0])) { drop('roster_role_mismatch'); continue; }
      if (competitorCited.some(r => !accs.some(a => accountByName[nz(a)] === accountByName[nz(r.competitor_name)]))) { drop('cited_author_not_in_roster_accounts'); continue; }
    }
    const weekly = it.weekly;
    if (!weekly || weekly.week_start !== WEEK_START || !['supported','timely','experiment'].includes(weekly.slot)
      || !['high','medium','low'].includes(weekly.evidence_confidence)
      || ![weekly.hook,weekly.intended_response,weekly.why_now,weekly.success_metric,weekly.confidence_reason,weekly.priority_reason,weekly.topic_key,it.format].every(isStr)
      || !Number.isInteger(weekly.rank) || weekly.rank < 1 || weekly.rank > t.limit) { drop('weekly_package_invalid'); continue; }
    if (!weekly.learning || !Array.isArray(weekly.learning.recommendation_ids) || !isStr(weekly.learning.explanation)
      || weekly.learning.recommendation_ids.some(id => !pack.previous_decisions_and_results.some(r => r.recommendation_id === id))) { drop('learning_reference_invalid'); continue; }
    if (weekly.slot === 'timely' && !cited.some(r => fresh(r.source_date))) { drop('timely_evidence_not_fresh'); continue; }
    const topic = nz(weekly.topic_key).replace(/[^a-z0-9]+/g,' ');
    if (keep.some(k => nz(k.item.weekly.topic_key).replace(/[^a-z0-9]+/g,' ') === topic || nz(k.item.original_angle) === nz(it.original_angle))
      || already.some(r => (r.topic_key && nz(r.topic_key).replace(/[^a-z0-9]+/g,' ') === topic) || (r.original_angle && nz(r.original_angle) === nz(it.original_angle)))) { drop('duplicate_topic'); continue; }
    const publicStories = cited.filter(r => ['news','trend'].includes(r.kind)).map(r => r.source_group);
    if (publicStories.some(group => keep.some(k => k.cited.some(r => r.source_group === group)) || already.some(r => (r.source_groups || []).includes(group)))) { drop('duplicate_source_story'); continue; }
    if (keep.some(k => k.item.weekly.rank === weekly.rank)) { drop('duplicate_rank'); continue; }
    if (!(it.asset_required === false || isStr(it.asset_required))) { drop('asset_required_invalid'); continue; }
    const texts = [it.what_changed, it.why_it_matters, it.could_publish, it.proof_needed,it.buyer_relevance,it.original_angle,it.next_action,weekly.hook,weekly.why_now,weekly.intended_response,weekly.success_metric,weekly.confidence_reason,weekly.priority_reason,weekly.learning.explanation];
    const prose = [...texts,it.title,ev.unknowns,typeof it.asset_required === 'string' ? it.asset_required : ''].join(' ').trim();
    if (prose.split(/\s+/).filter(Boolean).length > 250) { drop('package_word_budget_exceeded'); continue; }
    if (/\d+(?:\.\d+)?\s*%/.test(weekly.confidence_reason) || /\b(?:will|guaranteed to)\s+(?:increase|boost|generate|deliver|drive|convert|outperform|win)\b/i.test(texts.join(' '))) { drop('unsupported_forecast'); continue; }
    const lintBlob = nz(texts.join(' \n ') + ' \n ' + it.title);
    let badWord = null;
    for (const f of FORBIDDEN) if (lintBlob.indexOf(nz(f)) >= 0) { badWord = f; break; }
    if (badWord !== null) { drop('copy_lint:' + (badWord === '—' ? 'em_dash' : badWord.replace(/\s+/g, '_'))); continue; }
    const hay = cited.map(r => nz(r.excerpt)).concat(approvedSources.filter(x => founderIds.includes(x.source_id)).map(x => nz(x.excerpt))).join(' \n ');
    let badQuote = false;
    for (const s of texts) for (const span of quotedSpans(s)) if (hay.indexOf(nz(span)) < 0) badQuote = true;
    if (badQuote) { drop('quote_not_in_source'); continue; }
    if (keep.length >= t.limit) { drop('over_limit'); continue; }
    keep.push({ item: it, cited: cited });
  }

  // ---- 7. write: ops_drafts only ---------------------------------------------
  rec.coverage.requested = t.limit;
  rec.coverage.proposed = keep.length;
  rec.coverage.shortfall = t.limit - keep.length;
  if (!keep.length) {
    if (PREVIEW) rec.rows = [];
    if (items.length) { rec.reason = 'no_valid_candidates'; rec.writer_bail = true; continue; }
    rec.reason = 'no_supported_candidates';
    // A deliberate [] completes the week. Invalid/refused responses remain retryable.
    if (PREVIEW) continue;
  }
  keep.sort((a,b) => a.item.weekly.rank - b.item.weekly.rank);
  const rows = keep.map(k => {
    const it = k.item;
    const cited = k.cited;
    const authors = {};
    for (const r of cited.filter(r => r.kind === 'competitor')) authors[nz(shortName(r.competitor_name))] = true;
    let baseline = null;
    const authorKeys = Object.keys(authors);
    if (authorKeys.length === 1) {
      baseline = sourceBaselines.find(x => nz(shortName(x.author)) === authorKeys[0]) || null;

    }
    return {
      client_id: cid,
      kind: KIND,
      slack_channel: null,
      body: it.what_changed,
      context: {
        audn: {
          weekly: it.weekly,
          what_changed: it.what_changed,
          why_it_matters: it.why_it_matters,
          could_publish: it.could_publish,
          proof_needed: it.proof_needed,
          evidence: { source_ids: it.evidence.source_ids.map(String), source_dates: cited.map(r => r.source_date), sample_n: it.evidence.source_ids.length, unknowns: it.evidence.unknowns },
          roster_role: it.roster_role,
          roster_accounts: it.roster_accounts.map(a => accountByName[nz(a)] || String(a)),
          asset_required: it.asset_required === false ? false : String(it.asset_required),
          asset_state: it.asset_required === false ? 'none' : 'missing',
          pillar: (it.pillar === undefined || it.pillar === null || it.pillar === '') ? null : String(it.pillar),
          format: (it.format === undefined || it.format === null || it.format === '') ? null : String(it.format),
          title: it.title,
          subject: it.subject,
          buyer_relevance: it.buyer_relevance,
          original_angle: it.original_angle,
          next_action: it.next_action,
          founder_source_ids: Array.isArray(it.founder_source_ids) ? it.founder_source_ids : [],
        },
        source_rows: cited.map(r => ({ table:r.table,id:r.id,native_id:r.native_id,kind:r.kind,client_id:cid,author:r.competitor_name || null,date:r.source_date,url:r.url,location:r.location,excerpt:r.excerpt,source_group:r.source_group,format:r.format || null,gate:r.gate || null,limitations:r.limitations,reactions:r.likes_count ?? null,comments:r.comments_count ?? null,shares:r.reposts_count ?? null })),
        source_coverage: rec.coverage,
        author_baseline: baseline,
        proposed_at: RUN_ISO,
        cycle_id: CYCLE_ID,
        prompt: PROMPT_STAMP,
        provenance: 'production',
        context_schema: context.schema_version,
        evidence_cutoff: context.cutoff,
        client_brief_version: context.brief.version,
        feedback_ids: context.previous_decisions_and_results.map(x => x.recommendation_id),
        seed: null,
        published: null,
      },
    };
  });
  if (PREVIEW) { rec.rows = rows; rec.proposed = rows.length; continue; }
  const commit = await http({ method: 'POST', url: SB + '/rpc/audn_recommendation_commit', headers: HDR,
    body: { p_client_id: cid, p_cycle_id: CYCLE_ID, p_rows: rows, p_limit: t.limit, p_force_gap: FORCE_GAP }, json: true });
  if (!commit || commit.ok !== true) { rec.writer_bail = true; rec.reason = commit && commit.reason || 'commit_failed'; continue; }
  rec.proposed = commit.written;
  rec.already_committed = commit.already === true;
}

return [{ json: summary }];
