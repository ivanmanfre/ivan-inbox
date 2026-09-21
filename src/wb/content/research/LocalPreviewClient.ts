/* A DEV-only transport for the actual Strategy panels. It records every call
   and never opens a network connection or mutates the frozen seed files. */
import type { EditorialBrief, EditorialClient, SourceSnapshot } from '../../../lib/editorialTypes'
import type { ContentLane } from '../../../lib/content'

// content-brain-05 Task B2/B03 proof: `response` was added alongside the
// pre-existing `name`/`params` so a capture script can bind a view's
// "response" artifact to something this transport ACTUALLY returned, not a
// value reconstructed after the fact. Every branch below now computes its
// `data` first and logs it with the call that produced it, then returns the
// exact same object — the log is a mirror, never a second computation that
// could drift from what the UI received.
declare global { interface Window { __editorialPreviewCalls?: { name: string; params: Record<string, unknown>; response: unknown }[]; __editorialPreviewRefreshFailure?: boolean; __editorialPreviewRefreshRunningOnce?: boolean } }

type Data = { briefs: Record<ContentLane, EditorialBrief[]> }
const lanes: ContentLane[] = ['ivan','risedtc','arch']
export function makeLocalPreviewClient(data: Data): EditorialClient {
  const receipts = new Map<string, Record<string, unknown>>()
  const write = (name: string, params: Record<string, unknown>, response: unknown) => { window.__editorialPreviewCalls ??= []; window.__editorialPreviewCalls.push({ name, params, response }) }
  const laneOf = (raw: unknown): ContentLane => lanes.includes(raw as ContentLane) ? raw as ContentLane : 'ivan'
  const briefs = (lane: ContentLane) => data.briefs[lane]
  const sources = (lane: ContentLane) => { const found = new Map<string, SourceSnapshot>(); for (const b of briefs(lane)) for (const e of b.evidence) if (!found.has(e.source_id)) found.set(e.source_id, { ...e, snapshot_hash:e.source_content_hash ?? '', seen_version:1, curation_state:'unseen', permission_state:'granted', age_days:null, derived_field_names:[], body_state:e.passage ? 'full' : 'unavailable', source_identity:{ platform:'preview', native_id:e.source_id, collector_row_id:null }, observed_metrics:typeof e.candidate_fields?.observed_metrics === 'object' && e.candidate_fields.observed_metrics !== null ? e.candidate_fields.observed_metrics as Record<string, unknown> : null, metric_provenance:{ source:null, denominator:null, observation_window:null }, candidate_fields:e.candidate_fields ? { ...e.candidate_fields, angle_options:e.candidate_fields.angle_options } : null } as SourceSnapshot); return [...found.values()] }
  return {
    async rpc(name, params) {
      const lane = laneOf(params.p_client_id)
      if (name === 'editorial_read_briefs') { const list = briefs(lane), start = Number(params.p_cursor ?? 0), limit = Number(params.p_limit ?? 25); const resp = { client_id:lane, batch_id:`local-${lane}`, state:'ready', items:list.slice(start,start+limit), total:list.length, next_cursor:start+limit < list.length ? String(start+limit) : null, coverage_gaps:[] }; write(name, params, resp); return { data:resp, error:null } }
      if (name === 'editorial_read_research') { const kinds = (params.p_filters as { kinds?: string[] } | undefined)?.kinds; const list = sources(lane).filter(s => !kinds?.length || kinds.includes(s.source_kind)), start = Number(params.p_cursor ?? 0), limit = Number(params.p_limit ?? 25); const resp = { client_id:lane, state:'ready', items:list.slice(start,start+limit), total:list.length, independent_source_count:list.filter(s=>s.independent).length, next_cursor:start+limit < list.length ? String(start+limit) : null, gaps:[], health:{source_cutoff:'2026-09-21',new_evidence_awaiting_refresh:0,stale_inputs:0} }; write(name, params, resp); return { data:resp, error:null } }
      if (name === 'editorial_read_direction') { const resp = {client_id:lane, active_version:'local-v1', status:'active', direction:{statement:'Frozen seed direction'}, source:'Run 1 frozen seed', updated_at:'2026-09-21'}; write(name, params, resp); return { data:resp, error:null } }
      if (name === 'editorial_record_decision') { const key=String(params.p_request_id); if(!receipts.has(key)) receipts.set(key,{decision_id:`local-${key}`,request_id:key,target:{kind:params.p_target_kind,id:params.p_target_id,version:params.p_target_version},action:params.p_action,scope:params.p_scope,reason:params.p_reason,expected_version:params.p_expected_version,observed_version:params.p_expected_version,outcome:'recorded',recorded_at:'2026-09-21T00:00:00Z',promoted:false}); const resp = receipts.get(key); write(name, params, resp); return {data:resp,error:null} }
      if (name === 'editorial_read_refresh') { const status = window.__editorialPreviewRefreshFailure ? 'failed' : window.__editorialPreviewRefreshRunningOnce ? 'running' : 'complete'; window.__editorialPreviewRefreshRunningOnce = false; const resp = {status,last_usable_batch_id:`local-${lane}`,collection_health:{new_evidence_awaiting_refresh:0,stale_inputs:0},synthesis_health:{last_failure_reason:window.__editorialPreviewRefreshFailure?'Simulated provider failure':null}}; write(name, params, resp); return {data:resp,error:null} }
      write(name, params, null)
      return {data:null,error:{message:`Local preview has no ${name} response`}}
    },
    functions:{ async invoke(name, options) { const p=options.body, key=String(p.request_id); if(name==='editorial-review') { if (!receipts.has(key)) receipts.set(key,{state:'accepted',brief_id:p.brief_id,version:Number(p.version)+1,content_hash:p.expected_hash}); const resp=receipts.get(key); write(name, options.body, resp); return {data:resp,error:null} } if(name==='editorial-draft') { if (!receipts.has(key)) receipts.set(key,{state:'accepted',brief_id:p.brief_id,version:p.version,request_id:key}); const resp=receipts.get(key); write(name, options.body, resp); return {data:resp,error:null} } if(name==='editorial-refresh') { const resp={status:'accepted',refresh_id:`local-${key}`}; write(name, options.body, resp); return {data:resp,error:null} } if(name==='editorial-results') { const resp={client_id:p.client_id,brief_id:p.brief_id,brief_version:p.version,state:'empty',post:null,resource:null,unknowns:['No local post-publication outcome snapshot.']}; write(name, options.body, resp); return {data:resp,error:null} } write(name, options.body, null); return {data:null,error:{message:`Local preview has no ${name} response`}} } },
  }
}
