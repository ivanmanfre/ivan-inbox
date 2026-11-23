begin;
CREATE OR REPLACE FUNCTION public.ivan_supply_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 v_cap integer := greatest(1,public.ivan_supply_config_number('ivan_connect_daily_cap',40))::int;
 v_rubric integer; v_hold integer := public.ivan_supply_config_number('invite_refused_hold_hours',20)::int;
 v_ready integer:=0; v_pool integer:=0; v_held integer:=0; v_qualified_ids uuid[]:='{}'; v_fresh integer:=0; v_unknown integer:=0;
 v_created integer; v_created7 integer; v_sent integer; r record; refused timestamptz;
BEGIN
 SELECT version INTO v_rubric FROM public.content_prompts WHERE slug='icp-outreach-scoring';
 IF v_rubric IS NULL THEN RAISE EXCEPTION 'ivan_supply_rubric_unreadable'; END IF;
 IF v_hold<=0 THEN v_hold:=20; END IF;
 FOR r IN
  WITH campaigns AS MATERIALIZED (
    SELECT id FROM public.outreach_campaigns WHERE client_id IS NULL AND is_active IS TRUE AND archived IS FALSE
  ), candidate AS MATERIALIZED (
    SELECT p.id,p.linkedin_profile_id,lower(substring(p.linkedin_url from '(?i)linkedin[.]com/in/([^/?# ]+)')) slug,
      p.icp_score,p.scorer_version,p.last_engaged_at,p.enrichment_data#>>'{invite_refused,last_at}' refused_at
    FROM public.outreach_prospects p JOIN campaigns c ON c.id=p.campaign_id
    WHERE p.trigger_type IN ('engaged_post','content_engagement') AND p.trigger_confidence>=3
      AND p.stage='enriched' AND p.blacklisted IS FALSE AND p.country IS NOT NULL
      AND p.connection_sent_at IS NULL AND p.connected_at IS NULL AND p.last_dm_sent_at IS NULL
      AND p.skip_state IS NULL AND p.icp_score>=6
      AND (p.preferred_channel IS NULL OR p.preferred_channel='linkedin')
      AND p.scorer_version IN (SELECT generate_series(7,greatest(7,v_rubric))::text)
      AND (p.enrichment_data->>'lane' IS DISTINCT FROM 'own_post_engager' OR p.enrichment_data->>'signal_note_final' IS NOT NULL)
      AND p.recycled_at IS NULL AND p.last_reply_at IS NULL AND coalesce(p.reply_count,0)=0
      AND coalesce(p.dm_count,0)=0 AND p.call_booked_at IS NULL AND NOT coalesce(p.needs_manual_reply,false)
      AND NOT coalesce(p.hypertarget_reserved,false) AND (p.next_touch_after IS NULL OR p.next_touch_after<=now())
  ), message_ids AS MATERIALIZED (
    SELECT DISTINCT prospect_id FROM public.outreach_messages
  ), contacted AS MATERIALIZED (
    SELECT p.id,nullif(p.linkedin_profile_id,'') pid,
      lower(substring(p.linkedin_url from '(?i)linkedin[.]com/in/([^/?# ]+)')) slug
    FROM public.outreach_prospects p LEFT JOIN message_ids m ON m.prospect_id=p.id
    WHERE p.connection_sent_at IS NOT NULL OR p.connected_at IS NOT NULL OR p.last_dm_sent_at IS NOT NULL
      OR p.last_reply_at IS NOT NULL OR p.recycled_at IS NOT NULL OR coalesce(p.reply_count,0)>0
      OR coalesce(p.dm_count,0)>0 OR p.call_booked_at IS NOT NULL OR m.prospect_id IS NOT NULL
  ), contacted_ids AS MATERIALIZED (SELECT id FROM contacted),
  contacted_pids AS MATERIALIZED (SELECT DISTINCT pid FROM contacted WHERE pid IS NOT NULL),
  contacted_slugs AS MATERIALIZED (SELECT DISTINCT slug FROM contacted WHERE slug IS NOT NULL)
  SELECT c.* FROM candidate c
    LEFT JOIN contacted_ids ids ON ids.id=c.id
    LEFT JOIN contacted_pids pids ON pids.pid=nullif(c.linkedin_profile_id,'')
    LEFT JOIN contacted_slugs slugs ON slugs.slug=c.slug
  WHERE ids.id IS NULL AND pids.pid IS NULL AND slugs.slug IS NULL
 LOOP
  -- Parse only the final small shortlist; malformed timestamps conservatively remain ineligible.
  BEGIN refused:=r.refused_at::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE; END;
  IF refused>=now()-make_interval(hours=>v_hold) THEN CONTINUE; END IF;
  v_pool:=v_pool+1;
  -- Same call the sender makes. Anything other than a clear yes is not stock (unknown never counts as ready).
  IF public.ivan_outreach_eligibility(r.id) IS NOT TRUE THEN v_held:=v_held+1; CONTINUE; END IF;
  v_ready:=v_ready+1;
  IF r.icp_score>=7 AND r.scorer_version=v_rubric::text THEN v_qualified_ids:=array_append(v_qualified_ids,r.id); END IF;
  IF r.icp_score>=7 AND r.last_engaged_at>=now()-interval '14 days' AND r.last_engaged_at<=now() THEN v_fresh:=v_fresh+1; END IF;
  IF r.last_engaged_at IS NULL THEN v_unknown:=v_unknown+1; END IF;
 END LOOP;
 SELECT count(*) FILTER(WHERE p.created_at>=now()-interval '7 days' AND p.icp_score>=6 AND p.blacklisted IS FALSE),
        count(*) FILTER(WHERE p.created_at>=now()-interval '7 days' AND p.icp_score>=7 AND p.blacklisted IS FALSE),
        count(*) FILTER(WHERE p.connection_sent_at>=now()-interval '7 days' AND p.recycled_at IS NULL)
 INTO v_created,v_created7,v_sent
 FROM public.outreach_prospects p JOIN public.outreach_campaigns c ON c.id=p.campaign_id
 WHERE c.client_id IS NULL AND c.is_active IS TRUE AND c.archived IS FALSE
   AND p.trigger_type IN ('engaged_post','content_engagement') AND p.trigger_confidence>=3
   AND (p.created_at>=now()-interval '7 days' OR p.connection_sent_at>=now()-interval '7 days');
 RETURN jsonb_build_object('ready_count',v_ready,'pool_before_delivery_checks',v_pool,'held_by_delivery_check',v_held,
  'qualified_current_ready',cardinality(v_qualified_ids), 'qualified_current_ids',to_jsonb(v_qualified_ids),
  'fresh_dated_14d',v_fresh,'unknown_engagement_age',v_unknown,
  'sender_floor_created_7d',v_created,'qualified_created_7d',v_created7,'warm_invites_7d',v_sent,'consumption_basis','warm_connection_stamps_including_possible_reinvites',
  'checked_at',now(),'daily_cap',v_cap,'reserve_target',3*v_cap,
  'needs_replenishment',v_ready<3*v_cap OR v_created<v_sent,
  'production_basis','current_scored_created_cohort_not_first_qualification_events',
  'readiness_basis','untouched_sender_engage_pool_excluding_history_twins_passing_ivan_outreach_eligibility_no_freshness_filter',
  'rubric_version',v_rubric);
END $function$
;
-- Operator-only projection of the warm supply and eligible profile/content signals.
create or replace function public.inbox_ivan_qualified_interest()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare supply jsonb; other_ids jsonb;
begin
  if not exists (select 1 from public.outreach_agent_accounts a
    where a.client_id='ivan' and auth.uid()=any(a.operator_ids)) then
    raise exception 'operator_denied' using errcode='42501';
  end if;
  supply:=public.ivan_supply_snapshot();
  select coalesce(jsonb_agg(p.id),'[]'::jsonb) into other_ids
  from public.outreach_prospects p join public.outreach_campaigns c on c.id=p.campaign_id
  where c.client_id is null and c.is_active and not c.archived and p.stage='enriched'
    and p.trigger_type in ('content_signal','profile_view') and not p.blacklisted and p.skip_state is null
    and p.connection_sent_at is null and p.connected_at is null and p.last_dm_sent_at is null
    and p.icp_score>=7 and p.scorer_version=(supply->>'rubric_version')
    and public.ivan_outreach_eligibility(p.id);
  return (supply->'qualified_current_ids') || other_ids;
end;
$$;
revoke all on function public.inbox_ivan_qualified_interest() from public, anon;
grant execute on function public.inbox_ivan_qualified_interest() to authenticated;
notify pgrst,'reload schema';
commit;
