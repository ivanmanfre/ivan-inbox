-- Weekly recommendation shortlist: deployed and verified 2026-09-19.
BEGIN;
-- Weekly shortlist extension. Existing legacy queue rules and grants are preserved.
CREATE OR REPLACE FUNCTION public.audn_recommendation_commit(p_client_id text, p_cycle_id text, p_rows jsonb, p_limit integer DEFAULT 3, p_force_gap boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 prior uuid[]; ids uuid[]:='{}'; row jsonb; row_id uuid; n int; cap int; registry_cap int;
 cutoff timestamptz:=public.audn_cutoff();
 weekly boolean:=p_cycle_id like 'weekly:%'; week_start date; this_week date;
begin
 if p_client_id is null or nullif(p_cycle_id,'') is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'bad_args'; end if;
 select coalesce((platform->'measurement'->'pilot_limits'->>'recommendations_per_review')::int,3) into registry_cap
 from client_registry where client_id=p_client_id;
 if registry_cap is null then raise exception 'audn_unknown_client'; end if;
 cap:=least(greatest(registry_cap,1),greatest(coalesce(p_limit,3),1));
 if weekly then
  if not exists(select 1 from client_registry where client_id=p_client_id and is_active
    and (client_id='ivan' or platform->'measurement'->>'writer_enabled'='true'
      or platform->'measurement'->>'access'='operator'
      or platform->'measurement'->'features'->>'competitor_section'='true')) then
   raise exception 'audn_weekly_client_disabled';
  end if;
  begin
   if p_cycle_id !~ '^weekly:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'audn_invalid_week'; end if;
   week_start:=substring(p_cycle_id from 8)::date;
  exception when others then raise exception 'audn_invalid_week'; end;
  this_week:=date_trunc('week',cutoff at time zone 'UTC')::date;
  if extract(isodow from week_start)<>1 or week_start not in(this_week,this_week+7) then
   raise exception 'audn_invalid_week';
  end if;
 end if;
 -- Serialize only this client's queue. Check durable same-cycle result before current cap/gap.
 perform pg_advisory_xact_lock(hashtextextended('audn-writer:'||p_client_id,0));
 select proposal_ids into prior from audn_writer_cycles where client_id=p_client_id and cycle_id=p_cycle_id;
 if found then return jsonb_build_object('ok',true,'already',true,'proposal_ids',prior,'written',0); end if;
 if weekly then
  -- Accepted choices still belong to their week's shortlist. Legacy backlog is retained.
  select count(*) into n from ops_drafts where client_id=p_client_id and kind='audn_recommendation'
   and (context->>'cycle_id'=p_cycle_id or context->'audn'->'weekly'->>'week_start'=week_start::text);
  if n+jsonb_array_length(p_rows)>cap then
   return jsonb_build_object('ok',false,'reason','weekly_proposals_at_limit','written',0);
  end if;
 else
 select count(*) into n from ops_drafts where client_id=p_client_id and kind='audn_recommendation' and approved_at is null and sent_at is null;
 if n+jsonb_array_length(p_rows)>cap then return jsonb_build_object('ok',false,'reason','open_proposals_at_limit','written',0); end if;
 if not p_force_gap and exists(select 1 from ops_drafts where client_id=p_client_id and kind='audn_recommendation' and created_at>cutoff-interval '6 days') then
  return jsonb_build_object('ok',false,'reason','reviewed_this_week','written',0);
 end if;
 end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  if row->>'client_id' is distinct from p_client_id or row->>'kind' is distinct from 'audn_recommendation'
    or nullif(row->>'body','') is null or jsonb_typeof(row->'context'->'audn') is distinct from 'object'
    or row->'context'->>'cycle_id' is distinct from p_cycle_id then raise exception 'audn_invalid_proposal_tenant_or_shape'; end if;
  if weekly and row->'context'->'audn'->'weekly'->>'week_start' is distinct from week_start::text then
   raise exception 'audn_invalid_proposal_week';
  end if;
  insert into ops_drafts(client_id,kind,slack_channel,body,context)
  values(p_client_id,'audn_recommendation',null,row->>'body',row->'context') returning id into row_id;
  ids:=array_append(ids,row_id);
 end loop;
 if weekly or cardinality(ids)>0 then insert into audn_writer_cycles(client_id,cycle_id,proposal_ids)values(p_client_id,p_cycle_id,ids);end if;
 return jsonb_build_object('ok',true,'already',false,'proposal_ids',ids,'written',cardinality(ids));
end;
$function$;

-- Preserve rejected weekly choices for learning. Existing row-level permissions apply.
create or replace function public.audn_weekly_recommendation_decide(
 p_client_id text,p_proposal_id uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.ops_drafts%rowtype;
begin
 if p_proposal_id is null or coalesce(length(btrim(p_reason)),0) not between 1 and 2000 then
  return jsonb_build_object('ok',false,'error','reason_required');
 end if;
 select * into r from public.ops_drafts where id=p_proposal_id and client_id=p_client_id
  and kind='audn_recommendation' for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if r.approved_at is not null or r.sent_at is not null then
  return jsonb_build_object('ok',false,'error','proposal_already_accepted');
 end if;
 if r.context->'audn'->'weekly'->>'week_start' is null then
  return jsonb_build_object('ok',false,'error','not_weekly_proposal');
 end if;
 if r.context->'weekly_decision'->>'decision'='rejected' then
  return jsonb_build_object('ok',true,'already',true);
 end if;
 update public.ops_drafts set context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
  'weekly_decision',jsonb_build_object('decision','rejected','reason',btrim(p_reason),'decided_at',now()))
 where id=r.id and client_id=p_client_id;
 if not found then return jsonb_build_object('ok',false,'error','not_updated'); end if;
 return jsonb_build_object('ok',true,'already',false);
end $$;
revoke all on function public.audn_weekly_recommendation_decide(text,uuid,text) from public,anon;
grant execute on function public.audn_weekly_recommendation_decide(text,uuid,text) to authenticated,service_role;

-- Serialize approval with retained weekly rejection; all existing handoff fields remain intact.
CREATE OR REPLACE FUNCTION public.audn_recommendation_publish(p_client_id text, p_proposal_id uuid, p_text_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row      public.ops_drafts%rowtype;
  v_ref      text;
  v_a        jsonb;
  v_ov       jsonb := '{}'::jsonb;
  v_k        text;
  v_v        text;
  v_title    text;
  v_id       uuid;
  v_table    text;
  v_now      timestamptz := now();
begin
  if coalesce(btrim(p_client_id), '') = '' or p_proposal_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  v_ref := 'audn-rec:' || p_proposal_id::text;

  select * into v_row from public.ops_drafts
   where id = p_proposal_id and client_id = p_client_id and kind = 'audn_recommendation' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.context->'weekly_decision'->>'decision'='rejected' then
    return jsonb_build_object('ok', false, 'error', 'proposal_rejected');
  end if;

  -- ---- idempotent on the proposal id -------------------------------------
  if p_client_id = 'ivan' then
    v_table := 'lm_idea_candidates';
    select id into v_id from public.lm_idea_candidates
     where source = 'audience_review' and source_ref = v_ref limit 1;
  else
    v_table := 'client_ideas';
    perform 1 from public.client_registry where client_id = p_client_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'unknown_client');
    end if;
    select id into v_id from public.client_ideas
     where client_id = p_client_id and source_ref = v_ref limit 1;
  end if;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'table', v_table, 'id', v_id, 'ref', v_ref);
  end if;

  -- ---- the audn object, with the operator's text overrides ---------------
  v_a := coalesce(v_row.context -> 'audn', '{}'::jsonb);
  if jsonb_typeof(v_a) <> 'object' then v_a := '{}'::jsonb; end if;
  for v_k in select unnest(array['what_changed', 'why_it_matters', 'could_publish', 'proof_needed', 'title']) loop
    if p_text_overrides is not null and jsonb_typeof(p_text_overrides -> v_k) = 'string' then
      v_v := btrim(p_text_overrides ->> v_k);
      if length(v_v) between 1 and 2000 then
        v_a := v_a || jsonb_build_object(v_k, v_v);
        v_ov := v_ov || jsonb_build_object(v_k, v_v);
      end if;
    end if;
  end loop;
  if coalesce(v_a ->> 'what_changed', '') = '' then
    return jsonb_build_object('ok', false, 'error', 'no_text');
  end if;
  v_a := v_a || jsonb_build_object(
    'recommendation_id', p_proposal_id::text,
    'buyer_rationale',   coalesce(v_a ->> 'why_it_matters', ''),
    'what_to_publish',   coalesce(v_a ->> 'could_publish', ''),
    'source_ids',        coalesce(v_a -> 'evidence' -> 'source_ids',   '[]'::jsonb),
    'source_dates',      coalesce(v_a -> 'evidence' -> 'source_dates', '[]'::jsonb),
    'sample_n',          coalesce(v_a -> 'evidence' -> 'sample_n',     'null'::jsonb),
    'unknowns',          coalesce(v_a -> 'evidence' -> 'unknowns',     'null'::jsonb),
    'reviewed_at',       to_jsonb(v_now),
    'proposal_id',       p_proposal_id::text,
    'prompt',            coalesce(v_row.context ->> 'prompt', ''),
    'source_rows',       coalesce(v_row.context -> 'source_rows', '[]'::jsonb));
  v_title := left(coalesce(nullif(v_a ->> 'title', ''), v_a ->> 'what_changed'), 80);

  -- ---- exactly one idea row ------------------------------------------------
  if p_client_id = 'ivan' then
    v_id := gen_random_uuid();
    insert into public.lm_idea_candidates
      (id, source, source_ref, status, raw_topic, normalized_topic, raw_context,
       evidence, content_type, ingested_at, created_at)
    values
      (v_id, 'audience_review', v_ref, 'pending',
       v_a ->> 'what_changed', coalesce(v_a ->> 'could_publish', v_a ->> 'what_changed'),
       v_a::text, coalesce(v_row.context -> 'source_rows', '[]'::jsonb), 'post', v_now, v_now);
  else
    v_id := gen_random_uuid();
    insert into public.client_ideas
      (id, client_id, hook, title, source_label, source_ref, pillar, format, status,
       idea, created_at, meta)
    values
      (v_id, p_client_id, v_a ->> 'what_changed', v_title, 'Audience review', v_ref,
       nullif(v_a ->> 'pillar', ''), nullif(v_a ->> 'format', ''), 'staged',
       v_a, v_now, jsonb_build_object('audn', v_a));
  end if;

  -- ---- stamp the proposal (published = approved + sent into the store) ----
  update public.ops_drafts
     set approved_at = v_now,
         sent_at     = v_now,
         context     = coalesce(context, '{}'::jsonb) || jsonb_build_object('published',
                         jsonb_build_object('table', v_table, 'id', v_id, 'ref', v_ref,
                                            'at', v_now, 'overrides', v_ov))
   where id = p_proposal_id;

  return jsonb_build_object('ok', true, 'already', false, 'table', v_table, 'id', v_id, 'ref', v_ref);
end;
$function$;

REVOKE ALL ON FUNCTION public.audn_recommendation_commit(text,text,jsonb,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audn_recommendation_commit(text,text,jsonb,integer,boolean) TO service_role;
COMMIT;
