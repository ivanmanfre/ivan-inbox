-- rollback of db/20261118m_content_desk_r17.sql: drop the r17 functions, then re-apply the r16 forward file
-- verbatim (dispatch table, its 4 functions, desk_redo_claim with the dispatch row, grants).
drop function if exists public.desk_redo_finish(uuid, uuid, text, int);
drop function if exists public.desk_redo_refused(uuid, uuid, uuid, text, text, int);
-- Content Desk, Sol desk-backend r15 fixes (2026-11-18), round 16.
--
-- 1. Redo dispatch (r15 #6): after the 'generating' flip the action is 'dispatching', not done. One
--    desk_redo_dispatch row per action (primary key action_id) records the writer call:
--    pending -> sending (the single CAS that lets ONE webhook call out) -> accepted | refused | unconfirmed.
--    The action becomes done only when the writer webhook accepts (or, on reconcile, when the draft has
--    left that 'generating' claim, i.e. the writer finished). desk_redo_reconcile resumes a dispatching
--    action from its dispatch row and never issues a second job: a 'sending' or 'unconfirmed' call is never
--    repeated; only a 'pending' row (no call was ever made) past the 2 minute lease may be sent, once.
-- 2. The published-draft fallback in the brief uses the same 30-day cutoff as the posts (r15 #8).
-- Queue creators outside the desk lock: rejected as app parity (see round16.md); the post-write re-check stays.

create table if not exists public.desk_redo_dispatch (
  action_id uuid primary key references public.desk_actions(id) on delete cascade,
  draft_id uuid not null,
  started_at text not null,
  state text not null default 'pending' check (state in ('pending', 'sending', 'accepted', 'refused', 'unconfirmed')),
  http_status int,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.desk_redo_dispatch enable row level security;
revoke all on table public.desk_redo_dispatch from public, anon, authenticated;
grant select, insert, update on table public.desk_redo_dispatch to service_role;

-- committing (this claim) -> dispatching, and the ONE dispatch row, in the redo claim's own transaction
create or replace function public.desk_mark_dispatching(p_action uuid, p_claim uuid, p_draft uuid, p_started_at text, p_payload jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_n int;
begin
  update public.desk_actions set result = result || jsonb_build_object('state', 'dispatching', 'claimed_at', now())
   where id = p_action and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_claim_lost'; end if;
  insert into public.desk_redo_dispatch (action_id, draft_id, started_at, payload) values (p_action, p_draft, p_started_at, coalesce(p_payload, '{}'::jsonb));
end $$;

-- pending -> sending: the single transition that lets one writer call go out, for this claim only
create or replace function public.desk_redo_send(p_action uuid, p_claim uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_draft uuid; v_payload jsonb; v_started text; v_state text;
begin
  update public.desk_redo_dispatch x set state = 'sending', updated_at = now()
    from public.desk_actions a
   where x.action_id = p_action and x.state = 'pending'
     and a.id = p_action and a.result->>'state' = 'dispatching' and a.result->>'claim_token' = p_claim::text
  returning x.draft_id, x.payload, x.started_at into v_draft, v_payload, v_started;
  if v_draft is null then
    select state into v_state from public.desk_redo_dispatch where action_id = p_action;
    return jsonb_build_object('ok', false, 'state', v_state);
  end if;
  return jsonb_build_object('ok', true, 'draft_id', v_draft, 'payload', v_payload, 'started_at', v_started);
end $$;

-- the writer's answer: only from 'sending', only for this claim; done only when the writer accepted
create or replace function public.desk_redo_result(p_action uuid, p_claim uuid, p_outcome text, p_http int)
returns text language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_n int; v_state text;
begin
  if p_outcome not in ('accepted', 'refused', 'refused_stuck', 'unconfirmed') then return 'bad_outcome'; end if;
  update public.desk_redo_dispatch
     set state = case p_outcome when 'accepted' then 'accepted' when 'unconfirmed' then 'unconfirmed' else 'refused' end,
         http_status = p_http, updated_at = now()
   where action_id = p_action and state = 'sending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then return 'not_sending'; end if;
  v_state := case p_outcome when 'accepted' then 'done' when 'refused' then 'failed' when 'refused_stuck' then 'failed_release' else 'dispatching' end;
  update public.desk_actions set result = result || jsonb_build_object('state', v_state)
                                          || case when v_state = 'done' then jsonb_build_object('committed_at', now()) else '{}'::jsonb end
   where id = p_action and result->>'state' = 'dispatching' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_claim_lost'; end if;
  return v_state;
end $$;

-- resume a dispatching action from its dispatch row; never a second job
create or replace function public.desk_redo_reconcile(p_action uuid, p_user uuid, p_token uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
declare r public.desk_actions; x public.desk_redo_dispatch; d public.carousel_drafts;
begin
  select * into r from public.desk_actions where id = p_action and user_id = p_user for update;
  if r.id is null then return jsonb_build_object('state', null); end if;
  if r.result->>'state' is distinct from 'dispatching' then return jsonb_build_object('state', r.result->>'state'); end if;
  select * into x from public.desk_redo_dispatch where action_id = p_action for update;
  if x.action_id is null then return jsonb_build_object('state', 'dispatching', 'dispatch', null); end if;
  if x.state = 'accepted' then
    update public.desk_actions set result = result || jsonb_build_object('state', 'done', 'committed_at', now()) where id = p_action;
    return jsonb_build_object('state', 'done', 'dispatch', x.state);
  end if;
  if x.state = 'refused' then
    update public.desk_actions set result = result || jsonb_build_object('state', 'failed') where id = p_action;
    return jsonb_build_object('state', 'failed', 'dispatch', x.state);
  end if;
  if x.state = 'pending' then
    -- no writer call was ever made: past the lease, this tap takes the claim and may send it, once
    if coalesce((r.result->>'claimed_at')::timestamptz, (r.result->>'claim_at')::timestamptz, '-infinity'::timestamptz) < now() - interval '2 minutes' and p_token is not null then
      update public.desk_actions set result = result || jsonb_build_object('claim_token', p_token, 'claimed_at', now()) where id = p_action;
      return jsonb_build_object('state', 'dispatching', 'dispatch', 'pending', 'resume', true, 'draft_id', x.draft_id, 'payload', x.payload, 'started_at', x.started_at);
    end if;
    return jsonb_build_object('state', 'dispatching', 'dispatch', 'pending', 'resume', false);
  end if;
  -- sending / unconfirmed: the call went out; it is never repeated. The writer finished when the draft
  -- left that 'generating' claim.
  select * into d from public.carousel_drafts where id = x.draft_id;
  if d.id is null or d.status is distinct from 'generating' or (d.taxonomy->>'generating_started_at') is distinct from x.started_at then
    update public.desk_redo_dispatch set state = 'accepted', updated_at = now() where action_id = p_action;
    update public.desk_actions set result = result || jsonb_build_object('state', 'done', 'committed_at', now()) where id = p_action;
    return jsonb_build_object('state', 'done', 'dispatch', 'finished');
  end if;
  return jsonb_build_object('state', 'dispatching', 'dispatch', x.state);
end $$;

CREATE OR REPLACE FUNCTION public.desk_redo_claim(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_started_at text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error', 'approved')
     or d.scheduled_at is distinct from p_expected_scheduled_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  if coalesce(d.taxonomy->>'human_edited', '') = 'true' then return jsonb_build_object('ok', false, 'error', 'human_edited'); end if;
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  update public.carousel_drafts set status = 'generating', taxonomy = v_tax || jsonb_build_object('generating_started_at', p_started_at)
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  perform public.desk_mark_dispatching(p_action, p_claim, p_draft, p_started_at, jsonb_build_object('before_status', d.status, 'type', d.type, 'topic', d.topic, 'title', d.title));
  return jsonb_build_object('ok', true, 'before_status', d.status, 'type', d.type, 'topic', d.topic, 'title', d.title);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_redo_release(p_action uuid, p_claim uuid, p_draft uuid, p_started_at text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['dispatching'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  if p_status not in ('review', 'error', 'approved') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if d.status is distinct from 'generating' or d.taxonomy->>'generating_started_at' is distinct from p_started_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  update public.carousel_drafts set status = p_status, taxonomy = taxonomy - 'generating_started_at'
   where id = p_draft and status = 'generating' and taxonomy->>'generating_started_at' = p_started_at;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'busy');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_brief_core(p_fixtures boolean DEFAULT false, p_with_panel boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Europe/Warsaw')::date;
  v_this_mon   date := date_trunc('week', (now() at time zone 'Europe/Warsaw'))::date;
  v_panel      jsonb;
  v_drafts     jsonb;
  v_queue      jsonb;
  v_posts      jsonb;
  v_calls      jsonb;
  v_lines      jsonb;
  v_beliefs    jsonb;
  v_rulings    jsonb;
  v_autopilot  jsonb;
  v_ideas      jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'desk_brief_ivan: service role only' using errcode = '42501';
  end if;

  if p_with_panel then
    begin
      v_panel := public.cp17_calendar_panel_ivan();
    exception when others then
      v_panel := jsonb_build_object('ok', false, 'error', left(sqlerrm, 200));
    end;
  else
    v_panel := jsonb_build_object('omitted', true);
  end if;

  -- Ivan's live drafts: everything not finished, plus anything published in
  -- the last 14 days.
  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) into v_drafts from (
    select jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'updated_at', d.updated_at,   -- round 12: numbered rows carry the brief revision the answer was built from
      'type', d.type,
      'scheduled_at', d.scheduled_at,
      'published_at', d.published_at,
      'first_line', public.desk_first_line(d.post_body),
      'title', left(coalesce(d.title, d.topic, ''), 120),
      -- belief / vehicle: the draft's own taxonomy, else the post labeler (published posts)
      'belief', coalesce(case when d.taxonomy->>'belief' ~ '^[1-5]$' then (d.taxonomy->>'belief')::int end, lb.belief::int),
      'vehicle', coalesce(nullif(d.taxonomy->>'vehicle', ''), lb.vehicle),
      'recipe', d.qa->>'recipe',
      'qa_verdict', d.qa->>'verdict',
      'is_copy', (d.taxonomy->>'outlier_copy' = 'true'
                  or d.taxonomy->>'source' in ('linkedin_outlier_copy', 'x_tracked_outlier')
                  or coalesce(d.source_ref, '') like 'outlier:%'),
      'photos', coalesce(array_length(d.image_urls, 1), 0),
      'brain', (d.taxonomy->>'source' = 'content-brain'
                or (d.status in ('review', 'error')
                    and coalesce((select v.cb34_p2_member from public.cb34_p2_safe_drafts v where v.id = d.id), false))),
      'human_edited', d.taxonomy->>'human_edited' = 'true',
      'slot_kind', nullif(d.taxonomy->>'slot_kind', ''),
      -- same selling marker cp17_belief_quota_check reads
      'selling', (coalesce(d.taxonomy->>'slot_kind', '') = 'selling_claim' or coalesce(d.taxonomy->>'kind', '') = 'selling_claim'
                  or coalesce(d.taxonomy->>'selling_claim', '') = 'true'
                  or (d.taxonomy->>'source' = 'manual' and d.taxonomy ? 'hand_dated_at' and coalesce(d.taxonomy->>'approval', '') like 'explicit-user-%')),
      'chars', length(coalesce(d.post_body, '')),
      'created_at', d.created_at,
      'fixture', d.taxonomy->>'desk_eval_fixture',
      'sort', coalesce(to_char(d.scheduled_at, 'YYYY-MM-DD"T"HH24:MI'), '9999') || to_char(d.created_at, 'YYYYMMDDHH24MISS')
    ) as x
    from public.carousel_drafts d
    left join lateral (select l.belief, l.vehicle from public.cp17_post_labels l
                        where l.draft_id = d.id order by l.labeled_at desc limit 1) lb on true
    where d.client_id is null
      and coalesce(d.taxonomy->>'deleted_by_operator', '') = ''
      and (
        (coalesce(d.taxonomy->>'internal_test', '') <> 'true' and d.taxonomy->>'desk_eval_fixture' is null)
        or (p_fixtures and d.taxonomy->>'desk_eval_fixture' is not null)
      )
      and (
        d.status in ('review', 'approved', 'scheduled', 'generating', 'error')
        or (d.status = 'published' and d.published_at > v_now - interval '30 days')
      )
    order by d.created_at desc
    limit 120
  ) s;

  -- The publish queue for the next 21 days (the Next rows), with the
  -- autopilot / own origin the app shows.
  select coalesce(jsonb_agg(jsonb_build_object(
      'queue_id', q.id, 'draft_id', d.id, 'slot_at', q.scheduled_at,
      'origin', case when coalesce((public.content_autonomy_publish_state_ivan(q.id)->>'required')::boolean, false)
                     then 'autopilot' else 'own' end,
      'first_line', public.desk_first_line(d.post_body)
    ) order by q.scheduled_at), '[]'::jsonb) into v_queue
  from public.scheduled_posts q
  join public.carousel_drafts d on d.id::text = q.clickup_task_id
  where q.platform = 'linkedin' and q.status = 'pending' and coalesce(q.is_repost, false) = false
    and d.client_id is null and q.scheduled_at > v_now and q.scheduled_at < v_now + interval '21 days';

  begin
    v_posts := public.ivan_week_posts_worked(v_now - interval '30 days', v_now);
  exception when others then
    v_posts := jsonb_build_object('error', left(sqlerrm, 200));
  end;

  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) into v_calls from (
    select jsonb_build_object(
      'id', t.id, 'date', t.date, 'title', left(coalesce(t.title, ''), 80),
      'call_kind', t.call_review->>'call_kind',
      'booked', t.call_review->'next_step'->>'booked',
      'next_when', t.call_review->'next_step'->>'when',
      'next_note', left(coalesce(t.call_review->'next_step'->>'note', ''), 200)
    ) as x
    from public.transcripts t
    -- Ivan's own calls only (his Mac listener), never a client's recordings
    where t.source = 'ivan-listener' and t.call_review is not null and t.call_review->>'status' is null
    order by t.date desc nulls last
    limit 5
  ) s;

  -- Postable lines from calls: the call extractor's lines in Ivan's own words (r6, eval E1). Only rows
  -- that carry his words ('said') and the call date ('when'): rows without them never take a slot, so
  -- newer dated calls are never pushed out by lines that have no text. Picked like the app's call-line
  -- list (newest ingest, then score), then shown newest call first.
  select coalesce(jsonb_agg(x order by x->>'when' desc, (x->>'score')::numeric desc nulls last), '[]'::jsonb) into v_lines from (
    select jsonb_build_object(
      'id', i.id, 'ingested_at', i.ingested_at, 'status', i.status,
      'topic', left(coalesce(i.raw_topic, ''), 200),
      'said', left(i.evidence->0->>'said', 400),
      'when', i.evidence->0->>'when',
      'belief', i.evidence->0->>'belief', 'vehicle', i.evidence->0->>'vehicle',
      'score', i.composite_score,
      'draft_id', i.promoted_draft_id
    ) as x
    from public.lm_idea_candidates i
    where i.source = 'ivan_call'
      -- the app's ideaDecidable lane guard: own workspace, no campaign
      and lower(btrim(coalesce(i.workspace_type, ''))) in ('', 'own') and i.campaign_id is null
      and i.status in ('scored', 'reviewing', 'promoted')  -- scored lines only; pending ones are not yet judged
      and i.ingested_at > v_now - interval '21 days'
      and coalesce(btrim(i.evidence->0->>'said'), '') <> ''
      and coalesce(i.evidence->0->>'when', '') ~ '^\d{4}-\d{2}-\d{2}'
    order by i.ingested_at desc, i.composite_score desc nulls last
    limit 12
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('n', regexp_replace(b.id, '^.*-', ''), 'belief', b.belief, 'why', left(coalesce(b.why_disagreeable, ''), 240)) order by b.id), '[]'::jsonb)
    into v_beliefs
  from public.cb44_beliefs b where b.client_id = 'ivan' and b.status = 'kept';

  -- Ivan's dated rulings that touch content: feedback notes whose NAME is about
  -- content work, newest ruling date first (the date in the file name).
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_rulings from (
    select jsonb_build_object(
      'note', regexp_replace(m.file_path, '^.*/|\.md$', '', 'g'),
      'at', coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')),
      'rule', left(btrim(coalesce(substring(m.content from 'description:[ \t]*([^\n]*)'), ''), ' "'), 300)
    ) as x
    from public.claude_memory m
    where m.client_id = 'ivan' and m.file_path like 'project/feedback-%'
      and m.file_path ~* '(post|content|voice|copy|hook|carousel|lm-|writer|belief|calendar|photo|poland|feed|draft|caption|story|angle|outlier|selfie)'
      and m.file_path !~* '(rise|arch|swishdm|dm-|scan|outreach|invite|follow-?up|apollo|harvest|reply)'
    order by coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')) desc
    limit 14
  ) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_autopilot from (
    select jsonb_build_object('ran_at', r.ran_at, 'week_start', r.week_start, 'mode', r.mode,
      'picked', r.picked, 'scheduled', r.scheduled, 'open_before', r.open_before, 'outcome', r.outcome,
      'summary', left(coalesce(r.summary, ''), 400)) as x
    from public.content_autopilot_runs r
    where r.account = 'ivan'
    order by r.ran_at desc limit 3
  ) s;

  select jsonb_build_object(
    -- the same lane guard as the app's ideaDecidable: own workspace, no campaign
    'reviewing', (select count(*) from public.lm_idea_candidates where status = 'reviewing'
                    and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null),
    'newest', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'source', i.source, 'topic', left(coalesce(i.raw_topic, ''), 140), 'at', i.ingested_at) order by i.ingested_at desc)
       from (select * from public.lm_idea_candidates where status in ('reviewing', 'pending', 'scored')
               and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null
             order by ingested_at desc limit 6) i), '[]'::jsonb)
  ) into v_ideas;

  return jsonb_build_object(
    'as_of', v_now,
    'today', v_today,
    'this_monday', v_this_mon,
    'panel', v_panel,
    'drafts', v_drafts,
    'queue', v_queue,
    'posts', v_posts,
    'calls', v_calls,
    'call_lines', v_lines,
    'beliefs', v_beliefs,
    'rulings', v_rulings,
    'autopilot', v_autopilot,
    'ideas', v_ideas
  );
end $function$;

-- service role only
revoke execute on function public.desk_mark_dispatching(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_mark_dispatching(uuid, uuid, uuid, text, jsonb) to service_role;
revoke execute on function public.desk_redo_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.desk_redo_send(uuid, uuid) to service_role;
revoke execute on function public.desk_redo_result(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.desk_redo_result(uuid, uuid, text, int) to service_role;
revoke execute on function public.desk_redo_reconcile(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.desk_redo_reconcile(uuid, uuid, uuid) to service_role;
