-- Rollback of 20261115a: restores editorial_project_audn_capture exactly as it was live before
-- (pg_get_functiondef md5 1462cf7cdece0b8f71662609b1035f3a) and drops the one-row helper.
-- After this, snapshot inserts cost ~0.3 s per row again: keep tracker chunks at 10.
--
-- It refuses to run when either function is no longer the one 20261115a installed, so it can
-- never undo a later change by accident. In that case write a new migration instead.

begin;

-- Hold both functions' catalog rows until commit (see the forward migration: a repeat GRANT rewrites
-- the row and can only touch the ACL), then check them.
set local lock_timeout = '10s';
grant execute on function public.editorial_project_audn_capture(bigint) to service_role;
grant execute on function public.audn_snapshot_eligibility_one(bigint) to service_role;

do $guard$
declare got text;
begin
  got := md5(pg_get_functiondef('public.editorial_project_audn_capture(bigint)'::regprocedure));
  if got is distinct from '7dd317f0344e24e1c4d9012f44bc9460' then
    raise exception 'editorial_project_audn_capture is not the 20261115a version (md5 %): rollback refused', got;
  end if;
  got := md5(pg_get_functiondef('public.audn_snapshot_eligibility_one(bigint)'::regprocedure));
  if got is distinct from 'c75b196b2d52380f2c045be8931fadbe' then
    raise exception 'audn_snapshot_eligibility_one is not the 20261115a version (md5 %): rollback refused', got;
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.editorial_project_audn_capture(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; sid text; val numeric; why text; payload jsonb;
declare veto text;
begin
  -- Serialize with the collector UPDATE row lock before reading the capture or
  -- conflict ledger; a concurrent replay must not quarantine zero projection rows
  -- between our conflict check and projection insertion.
  perform 1 from public.audn_post_metric_snapshots where id = p_id for update;
  if not found then return; end if;
  select * into r from public.audn_snapshot_eligibility_v where id = p_id;
  if not found then return; end if;
  payload := jsonb_build_object('id',r.id,'client_id',r.client_id,'post_social_id',r.post_social_id,
    'cycle_id',r.cycle_id,'captured_at',r.captured_at,'impressions',r.impressions,
    'source',r.source,'coverage',r.coverage,'canonical_post_id',r.canonical_post_id,
    'resolution_status',r.resolution_status,'published_at',r.published_at);
  sid := 'audn:' || r.id::text || ':impressions:v1';
  if r.resolution_status not in ('exact','resolved_activity') or r.canonical_post_id is null then
    why := coalesce(r.unresolved_reason,'unresolved_publication_identity');
  elsif coalesce((r.coverage->>'impressions')::boolean,false) is not true then
    why := 'impressions_not_retained_by_source';
  elsif r.impressions is null then why := 'impressions_missing';
  elsif r.source not in (
    'n8n:F7JHoCI925eSTYar:unipile_post_snapshots',
    'n8n:WdeAmCTQ0ZH65mGs:unipile_post_tracker',
    'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker',
    'n8n:rrprmLeoU0pjpEmq:unipile_performance_sync'
  ) then why := 'unreviewed_source_scope';
  else val := r.impressions; end if;
  if exists (select 1 from public.editorial_observation_conflicts c
      where c.client_id=r.client_id and c.source_snapshot_id=r.id
        and c.reconciliation_state='quarantined') then
    veto := 'conflicting_source_replay';
  end if;

  insert into public.editorial_outcome_snapshots
    (client_id,snapshot_id,brief_id,artifact_role,metric,observed_value,unknown_reason,
     denominator,scope,window_start,window_end,captured_at,event_definition,attribution,
     limitation,publication_id)
  values (r.client_id,sid,'retrospective:'||coalesce(r.canonical_post_id,r.post_social_id),
    'own_post','impressions',val,why,case when val is null then null else 'linkedin_impressions' end,
    'audn:'||r.source,r.published_at,r.captured_at,r.captured_at,
    'linkedin_impressions_at_captured_time_v1','direct',
    'Retrospective/unlinked retained capture; projection time is stored separately.',
    coalesce(r.canonical_post_id,r.post_social_id))
  on conflict (client_id,snapshot_id) do nothing;

  insert into public.editorial_observation_projection
    (client_id,source_snapshot_id,outcome_snapshot_id,native_post_id,canonical_post_id,source_payload_hash,
     eligibility_veto_reason)
  values (r.client_id,r.id,sid,r.post_social_id,r.canonical_post_id,md5(payload::text),veto)
  on conflict do nothing;
end $function$;

revoke all on function public.editorial_project_audn_capture(bigint) from public, anon, authenticated;
grant execute on function public.editorial_project_audn_capture(bigint) to service_role;

drop function public.audn_snapshot_eligibility_one(bigint);

commit;
