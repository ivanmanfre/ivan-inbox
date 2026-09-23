begin;
select set_config('request.jwt.claim.role','service_role',true);

-- Reproduce the dangerous starting state created by broad/default table
-- privileges, then apply the migration's exact hardening sequence. This proves
-- the migration removes pre-existing service_role DML rather than merely
-- relying on fresh-table defaults.
grant insert, update, delete on public.editorial_provider_jobs, public.editorial_provider_reservations to service_role;
revoke all on public.editorial_provider_jobs, public.editorial_provider_reservations from public, anon, authenticated, service_role;
grant select on public.editorial_provider_jobs, public.editorial_provider_reservations to service_role;

do $privileges$
declare denied boolean;
begin
  execute 'set local role service_role';
  denied:=false;
  begin insert into public.editorial_provider_jobs(client_id,job_id,cohort_id,slot,request_id,brief_id,brief_version,brief_hash,route,call_limit)
    values('ivan','forged-direct','content-brain-08-20260923',1,'forged-direct','brief',1,repeat('f',64),'text',12);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service_role direct job insert was allowed'; end if;
  denied:=false;
  begin update public.editorial_provider_jobs set calls_reserved=0,status='active',brief_hash=repeat('e',64);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service_role direct counter/identity update was allowed'; end if;
  denied:=false;
  begin insert into public.editorial_provider_reservations(client_id,job_id,reservation_key,ordinal,stage,provider)
    values('ivan','forged-direct','x',1,'x','x');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service_role direct reservation insert was allowed'; end if;
  denied:=false;
  begin delete from public.editorial_provider_jobs where client_id='ivan';
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'service_role direct ledger delete was allowed'; end if;
  execute 'reset role';
end $privileges$;

do $test$
declare j public.editorial_provider_jobs; r jsonb; failed boolean; null_field integer;
begin
  j:=public.editorial_begin_provider_job('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'video_script');
  if j.call_limit<>2 or j.calls_reserved<>0 then raise exception 'unexpected initial budget'; end if;
  j:=public.editorial_begin_provider_job('arch','content-brain-08-20260923:arch:3:run8-arch-03-a','content-brain-08-20260923',3,'run8-arch-03-a','text-brief',1,repeat('c',64),'text');
  if j.call_limit<>12 then raise exception 'text proof limit is not twelve'; end if;
  r:=public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'generate-1','generate_script','railway_claude');
  if r->>'decision'<>'reserved' or (r->>'ordinal')::int<>1 then raise exception 'first reservation failed'; end if;
  r:=public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'generate-1','generate_script','railway_claude');
  if r->>'decision'<>'idempotent_replay' or (r->>'ordinal')::int<>1 then raise exception 'replay spent twice'; end if;
  perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'qa-1','editorial_video_qa','railway_claude');
  r:=public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'attempt-3','forbidden_retry','railway_claude');
  if r->>'decision'<>'exhausted' then raise exception 'attempt above route limit was accepted'; end if;
  if (select calls_reserved from public.editorial_provider_jobs where client_id='ivan' and job_id='content-brain-08-20260923:ivan:1:run8-ivan-01-a')<>2 then raise exception 'exhaustion changed consumed count'; end if;

  failed:=false;
  begin perform public.editorial_begin_provider_job('ivan','forged','forged-cohort',1,'request-2','brief-1',1,repeat('a',64),'video_script'); exception when others then failed:=true; end;
  if not failed then raise exception 'forged cohort accepted'; end if;
  failed:=false;
  begin perform public.editorial_begin_provider_job('arch','blocked','content-brain-08-20260923',1,'request-3','brief-1',1,repeat('a',64),'carousel'); exception when others then failed:=true; end;
  if not failed then raise exception 'unproven route accepted'; end if;
  failed:=false;
  begin perform public.editorial_reserve_provider_call('arch','content-brain-08-20260923:ivan:1:run8-ivan-01-a','content-brain-08-20260923',1,'run8-ivan-01-a','brief-1',1,repeat('a',64),'x','x','x'); exception when others then failed:=true; end;
  if not failed then raise exception 'cross-client reservation accepted'; end if;

  -- Only the two manifest request identities for a client/slot can create jobs.
  j:=public.editorial_begin_provider_job('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'text');
  failed:=false;
  begin perform public.editorial_begin_provider_job('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-c','content-brain-08-20260923',1,'run8-ivan-01-c','brief-1',1,repeat('d',64),'text'); exception when others then failed:=true; end;
  if not failed then raise exception 'third arbitrary request for one client/slot was accepted'; end if;
  failed:=false;
  begin perform public.editorial_begin_provider_job('ivan','wrong-derived-job','content-brain-08-20260923',2,'run8-ivan-02-a','brief-1',1,repeat('d',64),'text'); exception when others then failed:=true; end;
  if not failed then raise exception 'mismatched derived job id was accepted'; end if;

  -- Every nullable reservation argument fails closed. IS DISTINCT FROM then
  -- protects replay identity comparisons even if stored data is malformed.
  for null_field in 1..11 loop
    failed:=false;
    begin
      case null_field
        when 1 then perform public.editorial_reserve_provider_call(null,'x','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n','s','p');
        when 2 then perform public.editorial_reserve_provider_call('ivan',null,'content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n','s','p');
        when 3 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b',null,1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n','s','p');
        when 4 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',null,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n','s','p');
        when 5 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,null,'brief-1',1,repeat('d',64),'n','s','p');
        when 6 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b',null,1,repeat('d',64),'n','s','p');
        when 7 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',null,repeat('d',64),'n','s','p');
        when 8 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,null,'n','s','p');
        when 9 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),null,'s','p');
        when 10 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n',null,'p');
        when 11 then perform public.editorial_reserve_provider_call('ivan','content-brain-08-20260923:ivan:1:run8-ivan-01-b','content-brain-08-20260923',1,'run8-ivan-01-b','brief-1',1,repeat('d',64),'n','s',null);
      end case;
    exception when others then failed:=true;
    end;
    if not failed then raise exception 'nullable reservation field % was accepted',null_field; end if;
  end loop;

  -- Direct fixture row exercises the absolute ceiling independently of the stricter video route.
  insert into public.editorial_provider_jobs(client_id,job_id,cohort_id,slot,request_id,brief_id,brief_version,brief_hash,route,call_limit)
    values('risedtc','content-brain-08-20260923:risedtc:2:run8-risedtc-02-a','content-brain-08-20260923',2,'run8-risedtc-02-a','brief-12',1,repeat('b',64),'fixture',12);
  for i in 1..12 loop
    perform public.editorial_reserve_provider_call('risedtc','content-brain-08-20260923:risedtc:2:run8-risedtc-02-a','content-brain-08-20260923',2,'run8-risedtc-02-a','brief-12',1,repeat('b',64),'call-'||i,'stage-'||i,'fixture-provider');
  end loop;
  r:=public.editorial_reserve_provider_call('risedtc','content-brain-08-20260923:risedtc:2:run8-risedtc-02-a','content-brain-08-20260923',2,'run8-risedtc-02-a','brief-12',1,repeat('b',64),'call-13','stage-13','fixture-provider');
  if r->>'decision'<>'exhausted' then raise exception 'attempt 13 accepted'; end if;
end $test$;

do $rollback_contract$
declare jobs_before bigint; reservations_before bigint;
begin
  select count(*) into jobs_before from public.editorial_provider_jobs;
  select count(*) into reservations_before from public.editorial_provider_reservations;

  -- Execute the rollback's exact revoke-only behavior inside this test
  -- transaction, then prove counters and schema history remain present.
  execute 'revoke execute on function public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text) from service_role';
  execute 'revoke execute on function public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text) from service_role';

  if has_function_privilege('service_role', 'public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text)', 'EXECUTE') then
    raise exception 'rollback left a provider-budget entrypoint executable';
  end if;
  if to_regclass('public.editorial_provider_jobs') is null
     or to_regclass('public.editorial_provider_reservations') is null then
    raise exception 'rollback removed provider-budget ledger tables';
  end if;
  if (select count(*) from public.editorial_provider_jobs) <> jobs_before
     or (select count(*) from public.editorial_provider_reservations) <> reservations_before then
    raise exception 'rollback changed provider-budget ledger rows';
  end if;
  if to_regprocedure('public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text)') is null
     or to_regprocedure('public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text)') is null then
    raise exception 'rollback removed provider-budget function history';
  end if;
end $rollback_contract$;

rollback;
