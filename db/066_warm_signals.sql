-- 066 · Warm signals: the DM-section category for people who engaged Ivan first.
-- goal-runs/warm-signal-drafts-2026-09-12.md
--
-- Ivan, 2026-09-12: "i want to see these cases on DM section before directly outreaching as draft
-- all above.. with a special category - profile viewers and warm engagers etc."
--
-- Two functions, both INVOKER rights (RLS decides: outreach_prospects / outreach_messages carry
-- `authenticated_all`, anon has no policy, so the app's JWT reads and writes and nothing else does).
--
--   warm_signal_cards()                    → one row per warm-signal person on IVAN's tenant
--   warm_signal_decide(id, action, text)   → save_note | approve_invite | approve_dm1_stage | skip
--
-- Nothing here sends. `approve_invite` stamps enrichment_data.signal_note_final + signal_approved_at,
-- which the Connection Request Sender (5ZXtArhobWrDDpfJ) reads on its own schedule; `approve_dm1_stage`
-- only repairs the stage so `Detect Connections` can see an accept (the DM1 row's approved_at is written
-- by the inbox's existing approveDraft helper, and Poll + Send dispatches on that stamp). `skip` parks
-- the row (stage='skipped', skip_state='manual_skip') and discards any pending warm draft.
--
-- Applied via the Supabase Management API (empty search_path there → every function sets it).

create or replace function public.warm_signal_cards()
returns table (
  prospect_id        uuid,
  name               text,
  headline           text,
  company            text,
  title              text,
  country            text,
  city               text,
  icp_score          integer,
  stage              text,
  trigger_type       text,
  campaign_id        uuid,
  linkedin_url       text,
  connection_sent_at timestamptz,
  connected_at       timestamptz,
  note_variant       text,
  skip_reason        text,
  created_at         timestamptz,
  signal_source      text,
  signal_evidence    jsonb,
  signal_note_draft  text,
  signal_note_final  text,
  signal_approved_at text,
  signal_invite_state text,
  signal_lint        jsonb,
  view_window_ends   timestamptz,
  draft_id           uuid,
  draft_text         text,
  draft_model        text,
  draft_created_at   timestamptz,
  draft_approved_at  timestamptz,
  draft_sent_at      timestamptz,
  dm_sent_count      integer
)
language sql
stable
set search_path = public
as $$
with ivan_campaigns as (
  select id from outreach_campaigns where client_id is null
),
rows as (
  select p.*
  from outreach_prospects p
  join ivan_campaigns c on c.id = p.campaign_id
  where p.blacklisted = false
    and (
      (p.enrichment_data->>'lane' = 'own_post_engager'
         and p.stage not in ('archived', 'skipped'))
      or
      (p.trigger_type = 'profile_view'
         and p.stage in ('enriched', 'ballot_hold', 'connection_sent', 'connected', 'profile_view_dm')
         and p.created_at >= now() - interval '21 days')
    )
),
drafts as (
  -- the pending DM1 for this person: the warm drafter's row, or the lane's own viewer opener
  select distinct on (m.prospect_id)
         m.prospect_id, m.id, m.message_text, m.ai_model, m.created_at, m.approved_at, m.sent_at
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound'
    and m.message_type = 'dm'
    and m.sent_at is null
    and (m.send_blocked_reason is null or m.send_blocked_reason like 'post_approval_race:%' or m.send_blocked_reason like 'lint_%')
    and m.ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1')
  order by m.prospect_id, m.created_at desc
),
sent as (
  select m.prospect_id, count(*)::integer as n
  from outreach_messages m
  join rows r on r.id = m.prospect_id
  where m.direction = 'outbound' and m.message_type = 'dm' and m.sent_at is not null
  group by m.prospect_id
)
select
  r.id, r.name, r.headline, r.company, r.title, r.country, r.city, r.icp_score, r.stage,
  r.trigger_type, r.campaign_id, r.linkedin_url, r.connection_sent_at, r.connected_at,
  r.note_variant, r.skip_reason, r.created_at,
  coalesce(r.enrichment_data->>'signal_source',
           case when r.trigger_type = 'profile_view' then 'profile_view'
                when (r.enrichment_data->>'commented')::boolean then 'commented_own_post'
                when coalesce((r.enrichment_data->>'n_posts')::integer, 0) >= 2 then 'reacted_two_posts'
                else 'engaged_own_post' end) as signal_source,
  coalesce(r.enrichment_data->'signal_evidence',
           jsonb_build_object('touches', r.enrichment_data->'touches',
                              'viewed_at', r.enrichment_data->>'viewed_at',
                              'distance', coalesce(r.enrichment_data->>'network_distance', r.enrichment_data->>'distance'),
                              'trigger_detail', r.trigger_detail)) as signal_evidence,
  r.enrichment_data->>'signal_note_draft',
  r.enrichment_data->>'signal_note_final',
  r.enrichment_data->>'signal_approved_at',
  coalesce(r.enrichment_data->>'signal_invite_state',
           case when r.connection_sent_at is not null then 'sent:' || coalesce(r.note_variant, '?') || '@' || r.connection_sent_at::text
                when r.stage = 'profile_view_dm' then 'first_degree'
                else 'pending' end) as signal_invite_state,
  r.enrichment_data->'signal_lint',
  case when r.trigger_type = 'profile_view' then r.created_at + interval '7 days' else null end as view_window_ends,
  d.id, d.message_text, d.ai_model, d.created_at, d.approved_at, d.sent_at,
  coalesce(s.n, 0)
from rows r
left join drafts d on d.prospect_id = r.id
left join sent s on s.prospect_id = r.id
order by r.created_at desc;
$$;

create or replace function public.warm_signal_decide(p_prospect_id uuid, p_action text, p_text text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_row outreach_prospects%rowtype;
  v_client text;
  v_now timestamptz := now();
  v_note text;
  v_stage text;
  v_discarded integer := 0;
begin
  select p.* into v_row from outreach_prospects p where p.id = p_prospect_id for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select c.client_id into v_client from outreach_campaigns c where c.id = v_row.campaign_id;
  if v_client is not null then
    return jsonb_build_object('ok', false, 'error', 'not_ivan_tenant');
  end if;
  -- coalesce on purpose: a row with NO lane key makes `lane = 'own_post_engager'` NULL, and
  -- `not (NULL or false)` is NULL, which plpgsql treats as "do not return" (caught 2026-09-12 on the
  -- throwaway exercise: a plain Engagement Harvest row accepted a save_note).
  if not coalesce(v_row.enrichment_data->>'lane' = 'own_post_engager', false)
     and not coalesce(v_row.trigger_type = 'profile_view', false) then
    return jsonb_build_object('ok', false, 'error', 'not_a_warm_signal_row');
  end if;

  if p_action = 'save_note' then
    v_note := left(coalesce(p_text, ''), 200);
    update outreach_prospects
       set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
                             || jsonb_build_object('signal_note_draft', v_note, 'signal_note_edited_at', v_now),
           updated_at = v_now
     where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'note', v_note);

  elsif p_action = 'approve_invite' then
    if v_row.connection_sent_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invite_already_sent');
    end if;
    -- viewers: blank by ruling (2026-08-03); own-post engagers: the text Ivan approved, ≤200
    v_note := left(coalesce(p_text, v_row.enrichment_data->>'signal_note_draft', ''), 200);
    if v_row.trigger_type <> 'profile_view' and length(trim(v_note)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'note_required');
    end if;
    v_stage := case when v_row.stage = 'ballot_hold' then 'enriched' else v_row.stage end;
    update outreach_prospects
       set enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
                             || jsonb_build_object('signal_note_final', v_note,
                                                   'signal_approved_at', v_now,
                                                   'signal_approved_by', 'inbox'),
           stage = v_stage,
           skip_reason = case when v_row.stage = 'ballot_hold' then null else skip_reason end,
           updated_at = v_now
     where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'stage', v_stage, 'note', v_note, 'approved_at', v_now);

  elsif p_action = 'approve_dm1_stage' then
    -- the DM1 row itself is approved by the inbox helper (approved_at on outreach_messages);
    -- here only the one repair the first case needs: a held row whose invite already went out
    -- goes back to connection_sent so Detect Connections can see the accept.
    v_stage := v_row.stage;
    if v_row.stage = 'ballot_hold' and v_row.connection_sent_at is not null then
      v_stage := 'connection_sent';
      update outreach_prospects
         set stage = v_stage, skip_reason = null, updated_at = v_now
       where id = p_prospect_id;
    end if;
    return jsonb_build_object('ok', true, 'stage', v_stage);

  elsif p_action = 'skip' then
    update outreach_messages
       set send_blocked_reason = 'discarded_in_inbox', send_blocked_at = v_now
     where prospect_id = p_prospect_id
       and direction = 'outbound' and sent_at is null and approved_at is null
       and send_blocked_at is null
       and ai_model in ('warm_signal_dm1_v1', 'profile_view_dm_v2', 'profile_view_opener_v1');
    get diagnostics v_discarded = row_count;
    update outreach_prospects
       set stage = 'skipped',
           skip_state = 'manual_skip',
           skip_state_reason = 'warm_signal:operator_skip',
           skip_state_at = v_now,
           skip_reason = 'warm_signal:operator_skip',
           enrichment_data = coalesce(enrichment_data, '{}'::jsonb)
                             || jsonb_build_object('signal_skipped_at', v_now, 'signal_skipped_from_stage', v_row.stage),
           updated_at = v_now
     where id = p_prospect_id;
    return jsonb_build_object('ok', true, 'stage', 'skipped', 'drafts_discarded', v_discarded);

  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
end;
$$;

-- PUBLIC carries execute on every new function by default, so revoking from anon alone changes
-- nothing (verified 2026-09-12: has_function_privilege('anon', …) stayed true until PUBLIC was revoked).
revoke execute on function public.warm_signal_cards() from public, anon;
revoke execute on function public.warm_signal_decide(uuid, text, text) from public, anon;
grant execute on function public.warm_signal_cards() to authenticated, service_role;
grant execute on function public.warm_signal_decide(uuid, text, text) to authenticated, service_role;
