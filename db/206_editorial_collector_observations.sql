-- 206: preserve-first AUDN captures and project them into the existing editorial outcome contract.
-- Additive and staged: applying this migration is a separately reviewed release action.

create table if not exists public.editorial_observation_conflicts (
  conflict_id bigint generated always as identity primary key,
  client_id text not null,
  source_snapshot_id bigint not null,
  post_social_id text not null,
  cycle_id text not null,
  preserved_payload jsonb not null,
  attempted_payload jsonb not null,
  attempted_hash text not null,
  detected_at timestamptz not null default now(),
  reconciliation_state text not null default 'quarantined',
  unique (client_id, source_snapshot_id, attempted_hash),
  check (reconciliation_state in ('quarantined','reconciled'))
);

create table if not exists public.editorial_observation_projection (
  client_id text not null,
  source_snapshot_id bigint not null,
  outcome_snapshot_id text not null,
  native_post_id text not null,
  canonical_post_id text,
  source_payload_hash text not null,
  projected_at timestamptz not null default now(),
  eligibility_veto_reason text,
  primary key (client_id, source_snapshot_id),
  unique (client_id, outcome_snapshot_id)
);

-- One reader boundary for every outcome consumer. Ordinary outcomes have no projection row and
-- remain visible; a quarantined AUDN outcome is absent everywhere.
create or replace view public.editorial_eligible_outcome_snapshots_v
with (security_invoker = true) as
select o.*
from public.editorial_outcome_snapshots o
left join public.editorial_observation_projection p
  on p.client_id = o.client_id and p.outcome_snapshot_id = o.snapshot_id
where p.eligibility_veto_reason is null;

create or replace function public.editorial_audn_payload(p public.audn_post_metric_snapshots)
returns jsonb language sql immutable set search_path = public
as $$ select jsonb_build_object(
  'client_id',p.client_id,'post_social_id',p.post_social_id,'cycle_id',p.cycle_id,
  'captured_at',p.captured_at,'target_age_days',p.target_age_days,
  'actual_age_days',p.actual_age_days,'impressions',p.impressions,
  'reactions',p.reactions,'comments',p.comments,'shares',p.shares,
  'source',p.source,'coverage',p.coverage) $$;

create or replace function public.editorial_preserve_audn_capture()
returns trigger language plpgsql security definer set search_path = public
as $$
declare old_payload jsonb; new_payload jsonb;
begin
  old_payload := public.editorial_audn_payload(old);
  new_payload := public.editorial_audn_payload(new);
  if new_payload = old_payload then return old; end if;
  insert into public.editorial_observation_conflicts
    (client_id,source_snapshot_id,post_social_id,cycle_id,preserved_payload,attempted_payload,attempted_hash)
  values (old.client_id,old.id,old.post_social_id,old.cycle_id,old_payload,new_payload,md5(new_payload::text))
  on conflict do nothing;
  update public.editorial_observation_projection
     set eligibility_veto_reason = 'conflicting_source_replay'
   where client_id = old.client_id and source_snapshot_id = old.id
     and eligibility_veto_reason is null;
  return old; -- keep the collector batch alive while preserving the first observation
end $$;

create or replace function public.editorial_project_audn_capture(p_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
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
end $$;

create or replace function public.editorial_project_audn_capture_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$ begin perform public.editorial_project_audn_capture(new.id); return new; end $$;

drop trigger if exists editorial_audn_preserve_first on public.audn_post_metric_snapshots;
create trigger editorial_audn_preserve_first before update on public.audn_post_metric_snapshots
for each row execute function public.editorial_preserve_audn_capture();

drop trigger if exists editorial_audn_project_insert on public.audn_post_metric_snapshots;
create trigger editorial_audn_project_insert after insert on public.audn_post_metric_snapshots
for each row execute function public.editorial_project_audn_capture_trigger();

alter table public.editorial_observation_conflicts enable row level security;
alter table public.editorial_observation_projection enable row level security;
revoke all on public.editorial_observation_conflicts, public.editorial_observation_projection from public, anon, authenticated;
grant select, insert on public.editorial_observation_conflicts to service_role;
grant select, insert, update on public.editorial_observation_projection to service_role;
revoke all on function public.editorial_project_audn_capture(bigint) from public, anon, authenticated;
grant execute on function public.editorial_project_audn_capture(bigint) to service_role;
grant select on public.editorial_eligible_outcome_snapshots_v to service_role;

-- Patch the two existing Results readers in place. Their signatures and response contracts stay
-- unchanged; only the physical relation used for observed outcomes changes. Keeping this in 206
-- avoids making migration 105 depend on a view that did not exist when 105 was introduced.
do $reader_patch$
declare r record; patched text;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as ddl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('editorial_brief_json','editorial_read_brief_outcomes')
  loop
    if position('public.editorial_eligible_outcome_snapshots_v o' in r.ddl) > 0 then
      continue;
    end if;
    patched := replace(r.ddl, 'public.editorial_outcome_snapshots o',
      'public.editorial_eligible_outcome_snapshots_v o');
    if patched = r.ddl then
      raise exception '206 reader patch: expected outcome relation not found in %', r.proname;
    end if;
    execute patched;
  end loop;
end $reader_patch$;

drop trigger if exists editorial_observation_conflicts_immutable on public.editorial_observation_conflicts;
create trigger editorial_observation_conflicts_immutable before update or delete on public.editorial_observation_conflicts
for each row execute function public.editorial_immutable_guard();
