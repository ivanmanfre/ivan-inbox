-- Run 2: explicit client direction and serialized, versioned synthesis.
-- Depends on 105_editorial_brief_contract.sql. No live object is replaced except new RPCs.
alter table public.editorial_input_manifests
  add column if not exists synthesis_descriptor jsonb not null default '{}'::jsonb;
create table if not exists public.editorial_direction_versions (
  client_id text not null,
  version text not null,
  payload jsonb not null,
  source text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, version),
  constraint editorial_direction_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint editorial_direction_reason_nonempty check (btrim(reason) <> '')
);
create table if not exists public.editorial_current_direction (
  client_id text primary key,
  version text not null,
  adopted_at timestamptz not null default now(),
  foreign key (client_id, version) references public.editorial_direction_versions(client_id, version)
);
alter table public.editorial_direction_versions enable row level security;
alter table public.editorial_current_direction enable row level security;
revoke all on public.editorial_direction_versions, public.editorial_current_direction from public, anon, authenticated;
grant select, insert on public.editorial_direction_versions to service_role;
grant select, insert, update on public.editorial_current_direction to service_role;

create table if not exists public.editorial_synthesis_traces (
  client_id text not null,
  refresh_id text not null,
  input_manifest_hash text not null,
  prompt_version text not null,
  model text not null,
  input_payload jsonb,
  raw_response jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(client_id,refresh_id),
  foreign key(client_id,refresh_id) references public.editorial_refresh_requests(client_id,refresh_id)
);
alter table public.editorial_synthesis_traces enable row level security;
revoke all on public.editorial_synthesis_traces from public,anon,authenticated;
grant select,insert on public.editorial_synthesis_traces to service_role;

create table if not exists public.editorial_collector_cursors (
  client_id text not null,
  collector text not null,
  cursor text not null,
  row_count integer not null,
  coverage_gap text,
  observed_at timestamptz not null default now(),
  primary key(client_id,collector)
);
alter table public.editorial_collector_cursors enable row level security;
revoke all on public.editorial_collector_cursors from public,anon,authenticated;
grant select,insert,update on public.editorial_collector_cursors to service_role;

create or replace function public.editorial_read_direction(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_row record;
begin
  perform public.editorial_guard(p_gate, p_client_id);
  select d.*, c.adopted_at into v_row from public.editorial_current_direction c
    join public.editorial_direction_versions d using (client_id, version)
    where c.client_id=p_client_id;
  if not found then return jsonb_build_object('client_id',p_client_id,'active_version',null,
    'status','unadopted','audience',null,'direction',null,'source',null,'updated_at',null); end if;
  return jsonb_build_object('client_id',p_client_id,'active_version',v_row.version,
    'status','active','audience',v_row.payload->'audience','direction',v_row.payload,
    'source',v_row.source,'updated_at',v_row.adopted_at);
end;$function$;

create or replace function public.editorial_adopt_direction(
  p_gate text, p_client_id text, p_expected_version text, p_payload jsonb,
  p_source text, p_reason text, p_request_id text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_old text; v_version text;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  perform pg_advisory_xact_lock(hashtext('editorial-refresh:'||p_client_id));
  if jsonb_typeof(p_payload) <> 'object' or nullif(btrim(p_reason),'') is null
    or nullif(btrim(p_source),'') is null or nullif(btrim(p_request_id),'') is null then
    raise exception 'direction requires a complete payload, source, reason and request id';
  end if;
  select version into v_old from public.editorial_current_direction where client_id=p_client_id for update;
  if v_old is distinct from p_expected_version then
    return jsonb_build_object('state','conflict','observed_version',v_old); end if;
  v_version := encode(sha256(convert_to(p_client_id||'|'||p_request_id||'|'||p_payload::text,'UTF8')),'hex');
  insert into public.editorial_direction_versions(client_id,version,payload,source,reason)
    values(p_client_id,v_version,p_payload,p_source,p_reason) on conflict do nothing;
  insert into public.editorial_current_direction(client_id,version) values(p_client_id,v_version)
    on conflict(client_id) do update set version=excluded.version,adopted_at=now();
  return jsonb_build_object('state','active','client_id',p_client_id,'active_version',v_version);
end;$function$;

-- The caller is an authenticated edge adapter. A single transaction fixes the
-- exact source versions, direction, decisions and outcomes before any model call.
create or replace function public.editorial_begin_refresh(
  p_gate text,p_client_id text,p_expected_direction_version text,p_request_id text,
  p_synthesis_descriptor jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_old public.editorial_refresh_requests%rowtype; v_dir text; v_prev text;
  v_sources jsonb; v_decisions jsonb; v_outcomes jsonb; v_cutoff timestamptz:=now();
  v_hash text; v_batch text; v_refresh text; v_existing text; v_manifest jsonb; v_cursors jsonb;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if nullif(btrim(p_request_id),'') is null then raise exception 'refresh requires request id'; end if;
  -- Serializes begin against other begins and direction changes for this lane.
  perform pg_advisory_xact_lock(hashtext('editorial-refresh:'||p_client_id));
  select * into v_old from public.editorial_refresh_requests
    where client_id=p_client_id and request_id=p_request_id;
  if found then return jsonb_build_object('refresh_id',v_old.refresh_id,'client_id',p_client_id,
    'request_id',p_request_id,'deduplicated',true,'expected_direction_version',v_old.expected_direction_version,
    'observed_direction_version',v_old.observed_direction_version,'status',v_old.status,
    'batch_id',v_old.batch_id,'accepted_at',v_old.created_at,'starts_acquisition',false,
    'starts_generation',false,'starts_publication',false,'conflict',null); end if;
  select version into v_dir from public.editorial_current_direction where client_id=p_client_id;
  if v_dir is distinct from p_expected_direction_version then
    return jsonb_build_object('refresh_id','','client_id',p_client_id,'request_id',p_request_id,
      'deduplicated',false,'expected_direction_version',p_expected_direction_version,
      'observed_direction_version',v_dir,'status','failed','batch_id',null,'accepted_at',v_cutoff,
      'starts_acquisition',false,'starts_generation',false,'starts_publication',false,
      'conflict',jsonb_build_object('reason','stale_direction_version','detail','Active direction changed or is unadopted'));
  end if;
  select batch_id into v_prev from public.editorial_current_batch where client_id=p_client_id;
  select coalesce(jsonb_agg(jsonb_build_object('source_id',source_id,'seen_version',seen_version)
    order by source_id),'[]'::jsonb) into v_sources from (
    select distinct on(source_id) source_id,seen_version from public.editorial_sources
    where client_id=p_client_id and created_at<=v_cutoff order by source_id,seen_version desc) s;
  select coalesce(jsonb_agg(decision_id order by created_at,decision_id),'[]'::jsonb)
    into v_decisions from public.editorial_decisions
    where client_id=p_client_id and outcome='recorded' and created_at<=v_cutoff;
  select coalesce(jsonb_agg(snapshot_id order by snapshot_id),'[]'::jsonb)
    into v_outcomes from public.editorial_outcome_snapshots
    where client_id=p_client_id and captured_at<=v_cutoff;
  select coalesce(jsonb_object_agg(collector,cursor),'{}'::jsonb) into v_cursors
    from public.editorial_collector_cursors where client_id=p_client_id;
  v_manifest:=jsonb_build_object('source_refs',v_sources,'direction_version',v_dir,
    'decision_ids',v_decisions,'outcome_snapshot_ids',v_outcomes,'collector_cursors',v_cursors,
    'synthesis_descriptor',p_synthesis_descriptor);
  v_hash:=encode(sha256(convert_to(v_manifest::text,'UTF8')),'hex');
  select batch_id into v_existing from public.editorial_batches
    where client_id=p_client_id and input_manifest_hash=v_hash and status in('complete','partial')
    order by completed_at desc limit 1;
  v_refresh:='ref-'||encode(sha256(convert_to(p_client_id||'|'||p_request_id,'UTF8')),'hex');
  if v_existing is not null then
    insert into public.editorial_refresh_requests(client_id,request_id,refresh_id,expected_direction_version,
      observed_direction_version,status,batch_id,last_usable_batch_id)
      values(p_client_id,p_request_id,v_refresh,p_expected_direction_version,v_dir,'complete',v_existing,v_prev);
    return jsonb_build_object('refresh_id',v_refresh,'client_id',p_client_id,'request_id',p_request_id,
      'deduplicated',true,'expected_direction_version',p_expected_direction_version,
      'observed_direction_version',v_dir,'status','complete','batch_id',v_existing,'accepted_at',v_cutoff,
      'starts_acquisition',false,'starts_generation',false,'starts_publication',false,'conflict',null);
  end if;
  if exists(select 1 from public.editorial_refresh_requests where client_id=p_client_id and status in('queued','running')) then
    return jsonb_build_object('refresh_id','','client_id',p_client_id,'request_id',p_request_id,
      'deduplicated',false,'expected_direction_version',p_expected_direction_version,
      'observed_direction_version',v_dir,'status','queued','batch_id',null,'accepted_at',v_cutoff,
      'starts_acquisition',false,'starts_generation',false,'starts_publication',false,
      'conflict',jsonb_build_object('reason','in_flight','detail','A refresh is already active for this client'));
  end if;
  insert into public.editorial_input_manifests(client_id,input_manifest_hash,source_refs,source_cutoff,
    collector_cursors,direction_version,decision_cutoff,decision_ids,outcome_snapshot_ids,synthesis_descriptor)
    values(p_client_id,v_hash,v_sources,v_cutoff,v_cursors,v_dir,v_cutoff,v_decisions,v_outcomes,p_synthesis_descriptor)
    on conflict do nothing;
  v_batch:='batch-'||encode(sha256(convert_to(p_client_id||'|'||p_request_id||'|'||v_hash,'UTF8')),'hex');
  insert into public.editorial_batches(client_id,batch_id,status,input_manifest_hash,
    synthesis_method,synthesis_model,prompt_version,started_at,prior_batch_id)
    values(p_client_id,v_batch,'running',v_hash,'editorial-refresh-v1','pending','editorial-synthesis-v1',v_cutoff,v_prev);
  insert into public.editorial_refresh_requests(client_id,request_id,refresh_id,expected_direction_version,
    observed_direction_version,status,batch_id,last_usable_batch_id)
    values(p_client_id,p_request_id,v_refresh,p_expected_direction_version,v_dir,'running',v_batch,v_prev);
  return jsonb_build_object('refresh_id',v_refresh,'client_id',p_client_id,'request_id',p_request_id,
    'deduplicated',false,'expected_direction_version',p_expected_direction_version,
    'observed_direction_version',v_dir,'status','running','batch_id',v_batch,'accepted_at',v_cutoff,
    'starts_acquisition',false,'starts_generation',false,'starts_publication',false,'conflict',null);
end;$function$;

create or replace function public.editorial_read_refresh(p_gate text,p_client_id text,p_refresh_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v public.editorial_refresh_requests%rowtype; v_current text; v_cutoff timestamptz;
  v_collected timestamptz; v_synth timestamptz; v_new integer; v_stale integer;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  select * into v from public.editorial_refresh_requests where client_id=p_client_id and refresh_id=p_refresh_id;
  if not found then raise exception 'unknown refresh for this client'; end if;
  select batch_id into v_current from public.editorial_current_batch where client_id=p_client_id;
  select max(captured_at) into v_collected from public.editorial_sources where client_id=p_client_id;
  select max(completed_at) into v_synth from public.editorial_batches where client_id=p_client_id and status in('complete','partial');
  select m.source_cutoff into v_cutoff from public.editorial_batches b join public.editorial_input_manifests m
    on (m.client_id=b.client_id and m.input_manifest_hash=b.input_manifest_hash)
    where b.client_id=p_client_id and b.batch_id=v_current;
  select count(*) into v_new from public.editorial_sources where client_id=p_client_id and (v_cutoff is null or created_at>v_cutoff);
  select count(*)::int into v_stale from (
    select distinct on(source_id) source_published_at from public.editorial_sources
    where client_id=p_client_id order by source_id,seen_version desc) heads
    where source_published_at is not null and source_published_at<now()-interval '120 days';
  return jsonb_build_object('refresh_id',v.refresh_id,'client_id',p_client_id,'status',v.status,
    'batch_id',v.batch_id,'last_usable_batch_id',v_current,'coverage_gaps',
    coalesce((select coverage_gaps from public.editorial_batches where client_id=p_client_id and batch_id=v.batch_id),'[]'::jsonb),
    'awaiting_reconciliation',v.awaiting_reconciliation,
    'collection_health',jsonb_build_object('last_successful_collection',v_collected,
      'new_evidence_awaiting_refresh',v_new,'stale_inputs',v_stale),
    'synthesis_health',jsonb_build_object('last_successful_synthesis',v_synth,'last_failure_reason',v.failure_reason),
    'updated_at',v.updated_at);
end;$function$;

revoke all on function public.editorial_read_direction(text,text) from public,anon;
grant execute on function public.editorial_read_direction(text,text) to authenticated,service_role;
revoke all on function public.editorial_adopt_direction(text,text,text,jsonb,text,text,text) from public,anon;
grant execute on function public.editorial_adopt_direction(text,text,text,jsonb,text,text,text) to authenticated,service_role;
revoke all on function public.editorial_begin_refresh(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.editorial_begin_refresh(text,text,text,text,jsonb) to service_role;
revoke all on function public.editorial_read_refresh(text,text,text) from public,anon;
grant execute on function public.editorial_read_refresh(text,text,text) to authenticated,service_role;

-- Completion and pointer move share one transaction. A bad source reference,
-- stale permission or malformed brief aborts the transaction, leaving the old pointer.
create or replace function public.editorial_finish_refresh(
  p_gate text,p_client_id text,p_refresh_id text,p_briefs jsonb,p_model text,
  p_prompt_version text,p_coverage_gaps jsonb default '[]'::jsonb,p_failure text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v public.editorial_refresh_requests%rowtype; b jsonb; e jsonb; v_id text;
  v_ver integer; v_hash text; v_status text; v_pending boolean; v_count integer:=0;
  v_manifest public.editorial_input_manifests%rowtype; v_source record; v_direction_changed boolean;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  perform pg_advisory_xact_lock(hashtext('editorial-refresh:'||p_client_id));
  select * into v from public.editorial_refresh_requests
    where client_id=p_client_id and refresh_id=p_refresh_id for update;
  if not found then raise exception 'unknown refresh for this client'; end if;
  if v.status not in('queued','running') then return public.editorial_read_refresh(p_gate,p_client_id,p_refresh_id); end if;
  select m.* into v_manifest from public.editorial_batches q
    join public.editorial_input_manifests m on m.client_id=q.client_id and m.input_manifest_hash=q.input_manifest_hash
    where q.client_id=p_client_id and q.batch_id=v.batch_id;
  if not found then raise exception 'refresh manifest missing'; end if;
  v_direction_changed := (select version from public.editorial_current_direction where client_id=p_client_id)
    is distinct from v_manifest.direction_version;
  v_pending:=exists(select 1 from public.editorial_decisions d
    where d.client_id=p_client_id and d.created_at>v_manifest.decision_cutoff) or v_direction_changed;
  if v_direction_changed then
    p_failure := 'Active client direction changed during synthesis; last usable batch retained.';
  end if;
  if p_failure is not null then
    v_status:='failed';
  elsif jsonb_typeof(p_briefs)<>'array' then
    raise exception 'brief output must be an array';
  elsif jsonb_array_length(p_briefs)=0 then
    v_status:='empty';
  elsif jsonb_typeof(p_coverage_gaps)<>'array' then
    raise exception 'coverage gaps must be an array';
  elsif jsonb_array_length(p_coverage_gaps)>0 then
    v_status:='partial';
  else v_status:='complete'; end if;
  if v_status in('complete','partial') then
    for b in select value from jsonb_array_elements(p_briefs) loop
      v_id:=b#>>'{identity,brief_id}';
      v_ver:=(b#>>'{identity,version}')::integer;
      v_hash:=b#>>'{identity,content_hash}';
      if nullif(btrim(v_id),'') is null or v_ver<1 or v_hash !~ '^[0-9a-f]{64}$'
         or b#>>'{identity,client_id}' is distinct from p_client_id
         or b#>>'{purpose,direction_version}' is distinct from v_manifest.direction_version
         or jsonb_typeof(b->'evidence')<>'array'
         or jsonb_typeof(b->'claim_ledger')<>'array'
         or b->>'readiness' not in('ready_to_draft','needs_material') then
        raise exception 'invalid brief identity, direction, evidence, claims or readiness';
      end if;
      if exists(select 1 from public.editorial_decisions d where d.client_id=p_client_id
        and d.target_kind='brief' and d.target_id=v_id and d.action='reject' and d.outcome='recorded') then
        raise exception 'rejected brief id cannot be resurrected';
      end if;
      -- A new batch ID is not permission to recycle a dismissed or curated
      -- proposal. Apply the latest decision at its exact scope independently
      -- of model wording about feedback. Restoring a scope explicitly lifts it.
      if exists (
        with decisions as (
          select distinct on (d.target_kind,d.target_id,d.scope) d.*
          from public.editorial_decisions d
          where d.client_id=p_client_id and d.outcome='recorded'
          order by d.target_kind,d.target_id,d.scope,d.created_at desc,d.decision_id desc
        )
        select 1 from decisions d
        left join public.editorial_brief_versions old on old.client_id=p_client_id
          and d.target_kind='brief' and old.brief_id=d.target_id and old.version=d.target_version
        where d.action in ('reject','defer','shortlist','edit','dismiss') and (
          (d.target_kind='source' and d.action in ('reject','dismiss') and exists (
            select 1 from jsonb_array_elements(b->'evidence') ev where ev->>'source_id'=d.target_id))
          or (d.target_kind='brief' and (
            (d.scope='angle' and d.action in ('reject','defer') and
              lower(btrim(old.payload#>>'{editorial_direction,angle}'))=lower(btrim(b#>>'{editorial_direction,angle}')))
            or (d.scope='format' and d.action in ('reject','defer') and
              old.payload#>>'{editorial_direction,format}'=b#>>'{editorial_direction,format}')
            or (lower(btrim(old.payload#>>'{editorial_direction,topic}'))=lower(btrim(b#>>'{editorial_direction,topic}'))
              and lower(btrim(old.payload#>>'{editorial_direction,angle}'))=lower(btrim(b#>>'{editorial_direction,angle}')))
            or (old.payload->'claim_ledger'=b->'claim_ledger' and
              (select jsonb_agg(ev->>'source_id' order by ev->>'source_id') from jsonb_array_elements(old.payload->'evidence') ev)
              = (select jsonb_agg(ev->>'source_id' order by ev->>'source_id') from jsonb_array_elements(b->'evidence') ev))
          ))
        )
      ) then raise exception 'proposal conflicts with an existing scoped editorial decision'; end if;
      if (b->>'readiness')='ready_to_draft' and jsonb_array_length(coalesce(b->'missing_material','[]'::jsonb))>0 then
        raise exception 'ready brief has missing material';
      end if;
      for e in select value from jsonb_array_elements(b->'evidence') loop
        if nullif(btrim(e->>'source_id'),'') is null or (e->>'seen_version') is null then
          raise exception 'evidence lacks exact source identity'; end if;
        if not exists(select 1 from jsonb_array_elements(v_manifest.source_refs) m
          where m->>'source_id'=e->>'source_id' and (m->>'seen_version')::integer=(e->>'seen_version')::integer) then
          raise exception 'brief source is absent from frozen manifest'; end if;
        select s.permission_state,s.gap_state,s.snapshot_hash into v_source
          from public.editorial_sources s where s.client_id=p_client_id
          and s.source_id=e->>'source_id' and s.seen_version=(e->>'seen_version')::integer;
        if not found or v_source.permission_state in('denied','withheld') or v_source.gap_state is not null
          or (select current.permission_state from public.editorial_sources current
            where current.client_id=p_client_id and current.source_id=e->>'source_id'
            order by current.seen_version desc limit 1) in('denied','withheld') then
          raise exception 'brief source is inaccessible'; end if;
      end loop;
      insert into public.editorial_brief_versions(client_id,brief_id,version,batch_id,kind,status,
        content_hash,source_cutoff,direction_version,payload,claim_ledger,readiness,missing_material,
        revises_brief_id,revises_version,changed_evidence,authored_by_seat)
        values(p_client_id,v_id,v_ver,v.batch_id,b#>>'{identity,kind}',coalesce(b#>>'{identity,status}','proposed'),
          v_hash,v_manifest.source_cutoff,v_manifest.direction_version,b,coalesce(b->'claim_ledger','[]'::jsonb),
          b->>'readiness',coalesce(b->'missing_material','[]'::jsonb),nullif(b#>>'{identity,revises_brief_id}',''),
          nullif(b#>>'{identity,revises_version}','')::integer,nullif(b#>>'{identity,changed_evidence_explanation}',''),'editorial-refresh-v1');
      for e in select value from jsonb_array_elements(b->'evidence') loop
        insert into public.editorial_brief_sources(client_id,brief_id,version,evidence_id,relation,source_id,seen_version)
          values(p_client_id,v_id,v_ver,e->>'evidence_id',e->>'relation',e->>'source_id',(e->>'seen_version')::integer);
      end loop;
      v_count:=v_count+1;
    end loop;
  end if;
  update public.editorial_batches set status=v_status,completed_at=now(),
    synthesis_model=coalesce(nullif(p_model,''),'unknown'),prompt_version=coalesce(nullif(p_prompt_version,''),'unknown'),
    coverage_gaps=coalesce(p_coverage_gaps,'[]'::jsonb),awaiting_reconciliation=v_pending,
    failure_reason=case when v_status='failed' then p_failure else null end
    where client_id=p_client_id and batch_id=v.batch_id;
  if v_status in('complete','partial') then
    insert into public.editorial_current_batch(client_id,batch_id) values(p_client_id,v.batch_id)
      on conflict(client_id) do update set batch_id=excluded.batch_id,promoted_at=now();
  end if;
  update public.editorial_refresh_requests set status=v_status,
    failure_reason=case when v_status='failed' then p_failure else null end,
    awaiting_reconciliation=v_pending,updated_at=now()
    where client_id=p_client_id and refresh_id=p_refresh_id;
  return public.editorial_read_refresh(p_gate,p_client_id,p_refresh_id);
end;$function$;
revoke all on function public.editorial_finish_refresh(text,text,text,jsonb,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.editorial_finish_refresh(text,text,text,jsonb,text,text,jsonb,text) to service_role;

-- A generation request is independently checked at the server boundary.
-- Reservation links only an internal identity; it never starts a model or release.
create or replace function public.editorial_reserve_draft(
  p_gate text,p_client_id text,p_brief_id text,p_version integer,p_expected_hash text,
  p_request_id text,p_artifact_role text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v public.editorial_brief_versions%rowtype; v_link public.editorial_brief_artifacts%rowtype;
  v_reason text; v_id text; v_review jsonb; v_resource jsonb;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if nullif(btrim(p_brief_id),'') is null or p_version is null or p_version<1
     or nullif(btrim(p_request_id),'') is null or nullif(btrim(p_artifact_role),'') is null then
    raise exception 'draft request requires exact brief version, role and request id'; end if;
  select * into v from public.editorial_brief_versions where client_id=p_client_id
    and brief_id=p_brief_id and version=p_version;
  if not found then
    return jsonb_build_object('request_id',p_request_id,'client_id',p_client_id,'brief_id',p_brief_id,
      'brief_version',p_version,'expected_hash',p_expected_hash,'artifact_role',p_artifact_role,
      'artifact_id',null,'idempotent_replay',false,'state','conflict','blocked_reason','no_such_version'); end if;
  if v.content_hash is distinct from p_expected_hash then
    v_reason:='content_hash_mismatch';
  elsif (v.readiness<>'ready_to_draft' or jsonb_array_length(v.missing_material)>0)
    and not (p_artifact_role='internal_copy' and v.readiness='needs_material'
      and jsonb_array_length(v.missing_material)>0
      and not exists (select 1 from jsonb_array_elements_text(v.missing_material) m
        where m !~* '^(A permission decision on the .+ before .+ published|4-6 slide visual sequence design|Ivan''s explicit go/no-go on committing a second carousel|Decision: the planned draft title implies a comment-gate CTA|Resolution of which record is canonical|Final post/carousel copy for )')) then
    v_reason:='essential_material_missing';
  elsif v.payload->'review' is null or v.payload#>>'{review,verdict}'<>'pass'
     or v.payload#>>'{review,reviewer_seat}' is null
     or v.payload#>>'{review,reviewer_seat}'=v.authored_by_seat then
    v_reason:='independent_review_missing';
  elsif exists(select 1 from public.editorial_brief_sources l
      left join public.editorial_sources s on s.client_id=l.client_id and s.source_id=l.source_id
        and s.seen_version=l.seen_version
      where l.client_id=p_client_id and l.brief_id=p_brief_id and l.version=p_version
        and (s.source_id is null or s.permission_state in('denied','withheld') or s.gap_state is not null
          or (select current.permission_state from public.editorial_sources current
            where current.client_id=l.client_id and current.source_id=l.source_id
            order by current.seen_version desc limit 1) in('denied','withheld'))) then
    v_reason:='source_access_missing';
  elsif not exists(select 1 from public.editorial_brief_sources l
      where l.client_id=p_client_id and l.brief_id=p_brief_id and l.version=p_version) then
    v_reason:='source_access_missing';
  else
    v_resource:=v.payload->'resource';
    if v.kind in('resource','promotion') and (
      v_resource->>'readiness'<>'ready' or nullif(v_resource->>'asset_id','') is null
      or nullif(v_resource->>'version','') is null or nullif(v_resource->>'access_route','') is null
      or nullif(v_resource->>'permission_basis','') is null
      or jsonb_array_length(coalesce(v_resource->'required_missing_material','[]'::jsonb))>0) then
      v_reason:='resource_not_ready'; end if;
  end if;
  if v_reason is not null then
    return jsonb_build_object('request_id',p_request_id,'client_id',p_client_id,'brief_id',p_brief_id,
      'brief_version',p_version,'expected_hash',p_expected_hash,'artifact_role',p_artifact_role,
      'artifact_id',null,'idempotent_replay',false,
      'state',case when v_reason='content_hash_mismatch' then 'conflict' else 'blocked' end,
      'blocked_reason',v_reason); end if;
  select * into v_link from public.editorial_brief_artifacts where client_id=p_client_id
    and brief_id=p_brief_id and version=p_version and artifact_role=p_artifact_role for update;
  if found then
    return jsonb_build_object('request_id',v_link.request_id,'client_id',p_client_id,'brief_id',p_brief_id,
      'brief_version',p_version,'expected_hash',p_expected_hash,'artifact_role',p_artifact_role,
      'artifact_id',v_link.artifact_id,'idempotent_replay',true,
      'state',case when v_link.request_id=p_request_id then 'accepted' else 'conflict' end,
      'blocked_reason',case when v_link.request_id=p_request_id then null else 'role_already_reserved_by_other_request' end);
  end if;
  v_id:='draft-'||encode(sha256(convert_to(p_client_id||'|'||p_request_id,'UTF8')),'hex');
  insert into public.editorial_brief_artifacts(client_id,brief_id,version,artifact_role,artifact_kind,artifact_id,request_id)
    values(p_client_id,p_brief_id,p_version,p_artifact_role,'draft',v_id,p_request_id);
  return jsonb_build_object('request_id',p_request_id,'client_id',p_client_id,'brief_id',p_brief_id,
    'brief_version',p_version,'expected_hash',p_expected_hash,'artifact_role',p_artifact_role,
    'artifact_id',v_id,'idempotent_replay',false,'state','accepted','blocked_reason',null);
end;$function$;
revoke all on function public.editorial_reserve_draft(text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.editorial_reserve_draft(text,text,text,integer,text,text,text) to service_role;

create table if not exists public.editorial_bridge_leases (
  client_id text primary key,
  request_id text not null,
  leased_until timestamptz not null
);
alter table public.editorial_bridge_leases enable row level security;
revoke all on public.editorial_bridge_leases from public,anon,authenticated;
grant select,insert,update,delete on public.editorial_bridge_leases to service_role;

create or replace function public.editorial_claim_bridge(p_gate text,p_client_id text,p_request_id text)
returns boolean language plpgsql volatile security definer set search_path to 'public' as $function$
declare v public.editorial_bridge_leases%rowtype;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if nullif(btrim(p_request_id),'') is null then raise exception 'bridge requires request id'; end if;
  perform pg_advisory_xact_lock(hashtext('editorial-refresh:'||p_client_id));
  select * into v from public.editorial_bridge_leases where client_id=p_client_id for update;
  if found and v.leased_until>now() then return false; end if;
  insert into public.editorial_bridge_leases(client_id,request_id,leased_until)
    values(p_client_id,p_request_id,now()+interval '5 minutes')
    on conflict(client_id) do update set request_id=excluded.request_id,leased_until=excluded.leased_until;
  return true;
end;$function$;
create or replace function public.editorial_release_bridge(p_gate text,p_client_id text,p_request_id text)
returns void language plpgsql volatile security definer set search_path to 'public' as $function$
begin
  perform public.editorial_guard(p_gate,p_client_id);
  delete from public.editorial_bridge_leases where client_id=p_client_id and request_id=p_request_id;
end;$function$;
create or replace function public.editorial_latest_source_versions(p_gate text,p_client_id text,p_source_ids text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_result jsonb;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if cardinality(p_source_ids)>500 then raise exception 'source lookup is bounded to 500 ids'; end if;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_result from (
    select distinct on(source_id) source_id,seen_version,snapshot_hash
    from public.editorial_sources where client_id=p_client_id and source_id=any(p_source_ids)
    order by source_id,seen_version desc) s;
  return v_result;
end;$function$;
revoke all on function public.editorial_claim_bridge(text,text,text) from public,anon,authenticated;
revoke all on function public.editorial_release_bridge(text,text,text) from public,anon,authenticated;
revoke all on function public.editorial_latest_source_versions(text,text,text[]) from public,anon,authenticated;
grant execute on function public.editorial_claim_bridge(text,text,text) to service_role;
grant execute on function public.editorial_release_bridge(text,text,text) to service_role;
grant execute on function public.editorial_latest_source_versions(text,text,text[]) to service_role;

-- Exact, bounded original-call linkage. The service passes candidate IDs, while
-- these joins re-check tenant, source namespace and quote presence in the
-- retained transcript. No title, full transcript or participant names leave
-- this function except the private QA participant list.
create or replace function public.editorial_linked_call_passages(
  p_gate text,p_client_id text,p_candidate_ids text[])
returns table(candidate_id text,transcript_id text,transcript_date timestamptz,
  transcript_sha256 text,excerpt text,permission_state text,participants text[],transcript_source text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if cardinality(p_candidate_ids)>500 then raise exception 'call linkage request exceeds 500 candidates'; end if;
  if p_client_id='ivan' then
    return query select c.id::text,t.id::text,t.date,
      encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex'),
      coalesce(c.evidence->0->>'quote',c.evidence->0->>'anchor_quote'),
      'unknown'::text,t.participants,t.source
      from public.lm_idea_candidates c join public.transcripts t
        on t.source='ivan-listener' and (c.source_ref=t.id::text or c.source_ref=t.fireflies_id)
      where c.id::text=any(p_candidate_ids) and c.source in('ivan_call','calls')
        and nullif(coalesce(c.evidence->0->>'quote',c.evidence->0->>'anchor_quote'),'') is not null
        and position(coalesce(c.evidence->0->>'quote',c.evidence->0->>'anchor_quote') in t.transcript_text)>0;
  else
    return query select i.id::text,t.id::text,t.date,
      encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex'),
      i.score_breakdown->>'why',
      case when coalesce(i.meta->>'consent_tier',i.score_breakdown->>'consent_tier','') in('public','granted','approved')
        then 'granted' else 'unknown' end,t.participants,t.source
      from public.client_ideas i join public.transcripts t
        on t.source=case p_client_id when 'risedtc' then 'fathom-risedtc' else 'fireflies-arch' end
        and split_part(i.meta->>'source_ts','|',1)=t.transcript_json->>'recording_id'
      where i.client_id=p_client_id and i.id::text=any(p_candidate_ids)
        and i.source_label=case p_client_id when 'risedtc' then 'From your sales calls' else 'From your calls' end
        and nullif(i.score_breakdown->>'why','') is not null
        and position(i.score_breakdown->>'why' in t.transcript_text)>0;
  end if;
end;$function$;
revoke all on function public.editorial_linked_call_passages(text,text,text[]) from public,anon,authenticated;
grant execute on function public.editorial_linked_call_passages(text,text,text[]) to service_role;

create table if not exists public.editorial_reviews (
  client_id text not null,
  request_id text not null,
  brief_id text not null,
  source_version integer not null,
  reviewed_version integer,
  verdict text not null,
  reason text not null,
  reviewer_seat text not null,
  created_at timestamptz not null default now(),
  primary key(client_id,request_id),
  foreign key(client_id,brief_id,source_version) references public.editorial_brief_versions(client_id,brief_id,version),
  constraint editorial_reviews_verdict check(verdict in('pass','revise','fail')),
  constraint editorial_reviews_reason check(btrim(reason)<>'')
);
alter table public.editorial_reviews enable row level security;
revoke all on public.editorial_reviews from public,anon,authenticated;
grant select,insert on public.editorial_reviews to service_role;

create or replace function public.editorial_commit_review(
  p_gate text,p_client_id text,p_brief_id text,p_version integer,p_expected_hash text,
  p_request_id text,p_verdict text,p_reason text,p_reviewer_seat text,
  p_new_payload jsonb,p_new_hash text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_old public.editorial_brief_versions%rowtype; v_existing public.editorial_reviews%rowtype;
  v_head integer; v_new integer; v_copy_only boolean := false; e record;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if nullif(btrim(p_request_id),'') is null or nullif(btrim(p_reason),'') is null
     or p_verdict not in('pass','revise','fail') or nullif(btrim(p_reviewer_seat),'') is null then
    raise exception 'review requires request, verdict, reason and reviewer'; end if;
  select * into v_existing from public.editorial_reviews where client_id=p_client_id and request_id=p_request_id;
  if found then return jsonb_build_object('state','accepted','brief_id',v_existing.brief_id,
    'version',v_existing.reviewed_version,'content_hash',
    (select content_hash from public.editorial_brief_versions where client_id=p_client_id
      and brief_id=v_existing.brief_id and version=v_existing.reviewed_version),
    'idempotent_replay',true); end if;
  select * into v_old from public.editorial_brief_versions where client_id=p_client_id
    and brief_id=p_brief_id and version=p_version;
  if not found or v_old.content_hash is distinct from p_expected_hash then
    return jsonb_build_object('state','conflict','reason','version_or_hash_changed'); end if;
  select max(version) into v_head from public.editorial_brief_versions where client_id=p_client_id and brief_id=p_brief_id;
  if v_head<>p_version then return jsonb_build_object('state','conflict','reason','newer_version_exists'); end if;
  if p_reviewer_seat=v_old.authored_by_seat then
    return jsonb_build_object('state','blocked','reason','author_cannot_review_own_brief'); end if;
  if p_verdict='pass' then
    v_copy_only := v_old.readiness='needs_material'
      and exists(select 1 from jsonb_array_elements_text(v_old.missing_material) m
        where m<>'Explicit independent editorial review')
      and not exists(select 1 from jsonb_array_elements_text(v_old.missing_material) m
        where m<>'Explicit independent editorial review' and
          m !~* '^(A permission decision on the .+ before .+ published|4-6 slide visual sequence design|Ivan''s explicit go/no-go on committing a second carousel|Decision: the planned draft title implies a comment-gate CTA|Resolution of which record is canonical|Final post/carousel copy for )');
    if exists(select 1 from jsonb_array_elements_text(v_old.missing_material) m
      where m<>'Explicit independent editorial review') and not v_copy_only then
      return jsonb_build_object('state','blocked','reason','essential_material_missing'); end if;
    if exists(select 1 from public.editorial_brief_sources l
      join public.editorial_sources s on s.client_id=l.client_id and s.source_id=l.source_id
        and s.seen_version=l.seen_version
      where l.client_id=p_client_id and l.brief_id=p_brief_id and l.version=p_version
        and (s.permission_state in('denied','withheld') or s.gap_state is not null
          or (select current.permission_state from public.editorial_sources current
            where current.client_id=l.client_id and current.source_id=l.source_id
            order by current.seen_version desc limit 1) in('denied','withheld'))) then
      return jsonb_build_object('state','blocked','reason','source_access_missing'); end if;
  end if;
  v_new:=p_version+1;
  if p_new_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_new_payload)<>'object'
     or p_new_payload#>>'{identity,client_id}'<>p_client_id
     or p_new_payload#>>'{identity,brief_id}'<>p_brief_id
     or (p_new_payload#>>'{identity,version}')::integer<>v_new
     or p_new_payload#>>'{identity,content_hash}'<>p_new_hash
     or p_new_payload#>>'{review,reviewer_seat}'<>p_reviewer_seat
     or p_new_payload#>>'{review,verdict}'<>p_verdict
     or (p_verdict='pass' and not v_copy_only and (p_new_payload->>'readiness'<>'ready_to_draft'
       or jsonb_array_length(coalesce(p_new_payload->'missing_material','[]'::jsonb))<>0))
     or (p_verdict='pass' and v_copy_only and (p_new_payload->>'readiness'<>'needs_material'
       or p_new_payload->'missing_material' is distinct from
         (select coalesce(jsonb_agg(to_jsonb(m) order by ord),'[]'::jsonb)
          from jsonb_array_elements_text(v_old.missing_material) with ordinality as hold(m,ord)
          where m<>'Explicit independent editorial review'))) then
    raise exception 'invalid reviewed version payload'; end if;
  insert into public.editorial_brief_versions(client_id,brief_id,version,batch_id,kind,status,
    content_hash,source_cutoff,direction_version,payload,claim_ledger,
    revises_brief_id,revises_version,changed_evidence,readiness,missing_material,authored_by_seat)
    values(p_client_id,p_brief_id,v_new,v_old.batch_id,v_old.kind,'proposed',p_new_hash,
      v_old.source_cutoff,v_old.direction_version,p_new_payload,v_old.claim_ledger,
      p_brief_id,p_version,'Explicit independent editorial review; evidence unchanged',
      p_new_payload->>'readiness',p_new_payload->'missing_material',v_old.authored_by_seat);
  insert into public.editorial_brief_sources(client_id,brief_id,version,evidence_id,relation,source_id,seen_version)
    select client_id,brief_id,v_new,evidence_id,relation,source_id,seen_version
    from public.editorial_brief_sources where client_id=p_client_id and brief_id=p_brief_id and version=p_version;
  insert into public.editorial_reviews(client_id,request_id,brief_id,source_version,reviewed_version,verdict,reason,reviewer_seat)
    values(p_client_id,p_request_id,p_brief_id,p_version,v_new,p_verdict,p_reason,p_reviewer_seat);
  return jsonb_build_object('state','accepted','brief_id',p_brief_id,'version',v_new,
    'content_hash',p_new_hash,'idempotent_replay',false);
end;$function$;
revoke all on function public.editorial_commit_review(text,text,text,integer,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.editorial_commit_review(text,text,text,integer,text,text,text,text,text,jsonb,text) to service_role;
