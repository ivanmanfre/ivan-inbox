-- 208: proof-cohort provider dispatch budget. Service-only, append-reserved before dispatch.
-- No function can raise a limit or reset a counter. Ordinary generation never enters these tables.

create table if not exists public.editorial_provider_jobs (
  client_id text not null,
  job_id text not null,
  cohort_id text not null,
  slot integer not null check (slot between 1 and 5),
  request_id text not null,
  brief_id text not null,
  brief_version integer not null check (brief_version > 0),
  brief_hash text not null check (brief_hash ~ '^[a-f0-9]{64}$'),
  route text not null,
  call_limit integer not null check (call_limit between 1 and 12),
  calls_reserved integer not null default 0 check (calls_reserved between 0 and 12),
  status text not null default 'active' check (status in ('active','complete','incomplete','exhausted')),
  created_at timestamptz not null default now(),
  primary key (client_id, job_id),
  unique (client_id, request_id),
  check (calls_reserved <= call_limit)
);

create table if not exists public.editorial_provider_reservations (
  client_id text not null,
  job_id text not null,
  reservation_key text not null,
  ordinal integer not null check (ordinal between 1 and 12),
  stage text not null,
  provider text not null,
  reserved_at timestamptz not null default now(),
  primary key (client_id, job_id, reservation_key),
  unique (client_id, job_id, ordinal),
  foreign key (client_id, job_id) references public.editorial_provider_jobs(client_id, job_id)
);

-- Explicitly revoke service_role as well. Supabase/default privileges can grant
-- table DML to service_role before this migration runs; RLS is not a substitute
-- because service_role bypasses it.
revoke all on public.editorial_provider_jobs, public.editorial_provider_reservations from public, anon, authenticated, service_role;
-- Workflows may inspect receipts, but every mutation is reachable only through
-- the SECURITY DEFINER RPCs below. The service credential cannot reset or forge a counter directly.
grant select on public.editorial_provider_jobs, public.editorial_provider_reservations to service_role;
alter table public.editorial_provider_jobs enable row level security;
alter table public.editorial_provider_reservations enable row level security;

create or replace function public.editorial_begin_provider_job(
  p_client_id text, p_job_id text, p_cohort_id text, p_slot integer,
  p_request_id text, p_brief_id text, p_brief_version integer, p_brief_hash text, p_route text)
returns public.editorial_provider_jobs
language plpgsql security definer set search_path=public
as $function$
declare v_row public.editorial_provider_jobs; v_limit integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'provider budget: service role required' using errcode='42501';
  end if;
  if p_client_id is null or p_client_id not in ('ivan','risedtc','arch')
     or p_cohort_id is distinct from 'content-brain-08-20260923'
     or p_slot is null or p_slot not between 1 and 5
     or p_request_id is distinct from format('run8-%s-%s-a',p_client_id,lpad(p_slot::text,2,'0'))
        and p_request_id is distinct from format('run8-%s-%s-b',p_client_id,lpad(p_slot::text,2,'0'))
     or p_job_id is distinct from concat(p_cohort_id,':',p_client_id,':',p_slot,':',p_request_id)
     or p_brief_id is null or p_brief_id=''
     or p_brief_version is null or p_brief_version < 1
     or p_brief_hash is null or p_brief_hash !~ '^[a-f0-9]{64}$'
     or p_route is null then
    raise exception 'provider budget: invalid immutable proof identity' using errcode='22023';
  end if;
  -- H2 proof-only bounds: video has two mandatory calls; the complete clean text path has eleven.
  v_limit := case p_route when 'video_script' then 2 when 'text' then 12 else null end;
  if v_limit is null then raise exception 'provider budget: route not proven feasible' using errcode='P0001'; end if;
  insert into public.editorial_provider_jobs(client_id,job_id,cohort_id,slot,request_id,brief_id,brief_version,brief_hash,route,call_limit)
  values(p_client_id,p_job_id,p_cohort_id,p_slot,p_request_id,p_brief_id,p_brief_version,p_brief_hash,p_route,v_limit)
  on conflict (client_id,job_id) do nothing;
  select * into v_row from public.editorial_provider_jobs where client_id=p_client_id and job_id=p_job_id;
  if v_row.cohort_id is distinct from p_cohort_id or v_row.slot is distinct from p_slot
     or v_row.request_id is distinct from p_request_id or v_row.brief_id is distinct from p_brief_id
     or v_row.brief_version is distinct from p_brief_version
     or v_row.brief_hash is distinct from p_brief_hash or v_row.route is distinct from p_route then
    raise exception 'provider budget: job identity replay mismatch' using errcode='23505';
  end if;
  return v_row;
end $function$;

create or replace function public.editorial_reserve_provider_call(
  p_client_id text, p_job_id text, p_cohort_id text, p_slot integer, p_request_id text,
  p_brief_id text, p_brief_version integer, p_brief_hash text,
  p_reservation_key text, p_stage text, p_provider text)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare v_job public.editorial_provider_jobs; v_existing public.editorial_provider_reservations; v_next integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'provider budget: service role required' using errcode='42501';
  end if;
  if p_client_id is null or p_job_id is null or p_cohort_id is null or p_slot is null
     or p_request_id is null or p_brief_id is null or p_brief_version is null
     or p_brief_hash is null or p_reservation_key is null or p_reservation_key=''
     or p_stage is null or p_stage='' or p_provider is null or p_provider='' then
    raise exception 'provider budget: invalid reservation input' using errcode='22023';
  end if;
  select * into v_job from public.editorial_provider_jobs where client_id=p_client_id and job_id=p_job_id for update;
  if not found then raise exception 'provider budget: unknown job' using errcode='P0001'; end if;
  if v_job.cohort_id is distinct from p_cohort_id or v_job.slot is distinct from p_slot
     or v_job.request_id is distinct from p_request_id or v_job.brief_id is distinct from p_brief_id
     or v_job.brief_version is distinct from p_brief_version or v_job.brief_hash is distinct from p_brief_hash then
    raise exception 'provider budget: reservation identity mismatch' using errcode='22023';
  end if;
  select * into v_existing from public.editorial_provider_reservations
    where client_id=p_client_id and job_id=p_job_id and reservation_key=p_reservation_key;
  if found then
    if v_existing.stage is distinct from p_stage or v_existing.provider is distinct from p_provider then
      raise exception 'provider budget: reservation replay mismatch' using errcode='23505';
    end if;
    return jsonb_build_object('decision','idempotent_replay','ordinal',v_existing.ordinal,'remaining',v_job.call_limit-v_job.calls_reserved);
  end if;
  if v_job.status<>'active' or v_job.calls_reserved>=v_job.call_limit then
    update public.editorial_provider_jobs set status='exhausted'
      where client_id=p_client_id and job_id=p_job_id and status='active';
    return jsonb_build_object('decision','exhausted','ordinal',null,'remaining',0);
  end if;
  v_next:=v_job.calls_reserved+1;
  insert into public.editorial_provider_reservations(client_id,job_id,reservation_key,ordinal,stage,provider)
    values(p_client_id,p_job_id,p_reservation_key,v_next,p_stage,p_provider);
  update public.editorial_provider_jobs set calls_reserved=v_next where client_id=p_client_id and job_id=p_job_id;
  return jsonb_build_object('decision','reserved','ordinal',v_next,'remaining',v_job.call_limit-v_next);
end $function$;

revoke all on function public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text) from public, anon, authenticated;
grant execute on function public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text) to service_role;
grant execute on function public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text) to service_role;
