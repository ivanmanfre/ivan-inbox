-- Run after migration 293; read-only assertions under real SQL roles.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$declare x jsonb; d record; h text; begin
for d in select distinct on(coalesce(client_id,'ivan')) id,client_id,post_body from cb34_p2_safe_drafts where coalesce(client_id,'ivan') in ('ivan','arch','risedtc') order by coalesce(client_id,'ivan'),updated_at desc loop
h:=encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex');
x:=content_copy_readiness(d.id,h); if x->>'status'<>'ok' then raise exception 'readiness failed %',x;end if;
x:=content_copy_readiness(d.id,'wrong');if x->>'status'<>'copy_changed' then raise exception 'wronghashpassed';end if;
end loop;
for d in select c,n from unnest(array['ivan','risedtc','arch']) c cross join unnest(array[7,14]) n loop
x:=content_learning_readings(d.c,d.n);if x->>'status'<>'ok' or (x->>'measured_posts')::int>(x->>'eligible_posts')::int then raise exception 'metricsinvalid %',x;end if;
if exists(select 1 from jsonb_array_elements(x->'rows') r join editorial_observation_projection q on q.source_snapshot_id=(r->>'snapshot_id')::bigint and q.client_id=d.c where q.eligibility_veto_reason is not null) then raise exception 'quarantine leak';end if;
end loop;
end $$;
select set_config('request.jwt.claim.sub',(select operator_uid::text from cb34_p2_operator_entitlements limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare x jsonb;d record;n int;begin
select count(*) into n from cb34_p2_safe_drafts;if n=0 then raise exception 'authenticated safeview empty';end if;
select id,post_body into d from cb34_p2_safe_drafts order by updated_at desc limit 1;
x:=content_copy_readiness(d.id,encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex'));if x->>'status'<>'ok' then raise exception 'authenticated readiness %',x;end if;
x:=content_learning_readings('ivan',7);if x->>'status'<>'ok' then raise exception 'authenticated metrics %',x;end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select jsonb_build_object('anon_readiness_denied',not has_function_privilege('anon','content_copy_readiness(uuid,text)','execute'),'anon_metrics_denied',not has_function_privilege('anon','content_learning_readings(text,integer)','execute'));
reset role;
rollback;
