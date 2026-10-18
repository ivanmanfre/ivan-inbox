-- Read-only current-copy checks. Never use a historical score as publication authority.
create or replace function public.content_copy_readiness(p_draft uuid, p_body_sha text)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare d record; h text; g jsonb;
begin
 if coalesce(auth.role(),'') not in ('authenticated','service_role') then
  return jsonb_build_object('status','unavailable');
 end if;
 -- The safe view retains its JWT-aware read guard under this narrow definer.
 select * into d from public.cb34_p2_safe_drafts where id=p_draft;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 if not coalesce(auth.role()='service_role' or (auth.uid() is not null and public.lane_allowed(coalesce(d.client_id,'ivan')) and public.operator_gate_ok('clientops')),false) then
  return jsonb_build_object('status','unavailable');
 end if;
 h:=encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex');
 if p_body_sha is distinct from h then return jsonb_build_object('status','copy_changed','body_sha256',h); end if;
 g:=case when d.client_id='risedtc' then public.rise_call_fact_gate_status(d.id)
    else jsonb_build_object('applies',false,'status','not_applicable') end;
 return jsonb_build_object('status','ok','body_sha256',h,'source_gate',g,
   'final_gate',public.cb53_final_fact_status(d.id,null));
end $$;
revoke all on function public.content_copy_readiness(uuid,text) from public, anon;
grant execute on function public.content_copy_readiness(uuid,text) to authenticated,service_role;

-- Existing collectors already retain immutable measurements. Compute age from the
-- exact own-account publication identity, not target labels or today's final stats.
create or replace function public.content_learning_readings(p_client text,p_age_days integer default 7)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare result jsonb;
begin
 if p_client is null or p_age_days is null or p_client not in ('ivan','risedtc','arch') or p_age_days not in (7,14)
   or not exists(select 1 from public.client_registry where client_id=p_client and is_active)
   or not coalesce(auth.role()='service_role' or (auth.uid() is not null and public.lane_allowed(p_client) and public.operator_gate_ok('clientops')),false)
 then return jsonb_build_object('status','unavailable'); end if;
 with posts as (
   select o.id, 'ivan'::text client_id,o.social_id,o.posted_at published_at,
     left(o.post_text,160) title,o.linkedin_url url,
     (select c.funnel_stage from public.carousel_drafts c where c.id::text=o.clickup_task_id limit 1) purpose
     from public.own_posts o where p_client='ivan'
   union all
   select m.id,m.client_id,m.social_id,m.published_at,m.title,m.post_url,m.funnel_class
     from public.client_post_metrics m where m.client_id=p_client and p_client in ('risedtc','arch')
 ), observed as (
   select p.*,s.id snapshot_id,s.captured_at,s.coverage,
     extract(epoch from(s.captured_at-p.published_at))/86400.0 age_days,
     case when s.coverage->>'impressions'='true' then s.impressions end impressions,
     case when s.coverage->>'reactions'='true' then s.reactions end reactions,
     case when s.coverage->>'comments'='true' then s.comments end comments,
     case when s.coverage->>'shares'='true' then s.shares end shares
   from posts p join public.audn_post_metric_snapshots s on s.client_id=p.client_id and s.post_social_id=p.social_id
   where p.published_at is not null and s.captured_at<=now() and s.captured_at>=p.published_at+make_interval(days=>p_age_days)
     and s.captured_at<p.published_at+make_interval(days=>p_age_days+1)
     and not exists(select 1 from public.editorial_observation_projection q
       where q.client_id=s.client_id and q.source_snapshot_id=s.id and q.eligibility_veto_reason is not null)
 ), picked as (
   select distinct on (id) * from observed order by id,captured_at,snapshot_id
 ), lines as (
   select jsonb_build_object('post_id',p.id,'social_id',p.social_id,'title',p.title,'url',p.url,
     'purpose',coalesce(p.purpose,'unknown'),'published_at',p.published_at,'captured_at',p.captured_at,
     'actual_age_days',p.age_days,'snapshot_id',p.snapshot_id,'impressions',p.impressions,
     'reactions',p.reactions,'comments',p.comments,'shares',p.shares,'coverage',p.coverage,
     'current_buyer_signal',(select jsonb_build_object('judged',b.n_judged,'buyer_memberships',b.n_icp7,
        'unknown',b.n_unknown,'read_at',now(),'scope','current, not fixed-age')
       from public.post_buyer_share_v b where b.client_id=p.client_id and b.subject='own_post' and b.post_key=p.id::text limit 1),
     'attributed_bookings',null,'inbound_dms',null) row,p.published_at
    from picked p
 )
 select jsonb_build_object('status','ok','client_id',p_client,'age_days',p_age_days,'read_at',now(),
    'observation_window','first retained observation at or after target age, before the next day',
    'eligible_posts',(select count(*) from posts where published_at<=now()-make_interval(days=>p_age_days)),
    'measured_posts',(select count(*) from picked),
    'latest_collection',(select max(captured_at) from audn_post_metric_snapshots where client_id=p_client),
    'rows',coalesce((select jsonb_agg(row order by published_at desc) from lines),'[]'::jsonb),
    'limitations',jsonb_build_array('Exact own-account post identity only; unmatched snapshots are excluded.',
       'Buyer labels are current coverage, not a day-seven or day-fourteen outcome.',
       'Post-level booking and inbound DM coverage is unverified; missing values remain null.',
       'Historical posts without an in-window snapshot are unmeasured, not zero.')) into result;
 return result;
end $$;
revoke all on function public.content_learning_readings(text,integer) from public,anon;
grant execute on function public.content_learning_readings(text,integer) to authenticated,service_role;
