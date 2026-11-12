-- Rollback of 20261112b_content_card_question.sql: content_card_pick and content_card_today as db/20261112 wrote them
-- (so the pick no longer calls the ask), then the new functions, then the new columns. A call already queued to
-- content-card-ask finds no columns to write and stores nothing. Remove integration_config content_card_ask_url by
-- hand if it was inserted. The prompt rows have their own rollback (20261112b_content_card_question_prompt_rollback.sql).
select set_config('lock_timeout', '5s', true);

create or replace function public.content_card_pick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_day date := (p_now at time zone 'Europe/Warsaw')::date;
  v_hour int := extract(hour from (p_now at time zone 'Europe/Warsaw'))::int;
  c public.content_daily_cards%rowtype; v_pick uuid; v_why text; v_body text; v_payload jsonb;
  v_url text; v_secret text; v_req bigint; v_claimed int; v_expired int; v_week int;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-daily-card', 0));

  update public.content_daily_cards set state = 'expired', resolved_at = p_now where day < v_day and state = 'shown';
  get diagnostics v_expired = row_count;

  if v_hour <> 11 then return jsonb_build_object('fire', false, 'why', 'not 11 in Warsaw', 'expired', v_expired); end if;

  select * into c from public.content_daily_cards where day = v_day;
  if found then
    -- A card whose notification post came back with an error (or no answer) is sent again, 3 tries in all.
    if c.state = 'shown' and c.request_id is not null and c.notify_attempts < 3 and c.notified_at < p_now - interval '3 minutes'
       and exists (select 1 from net._http_response h where h.id = c.request_id and (h.status_code is null or h.status_code not between 200 and 299)) then
      -- At most one ring a day: a row inbox-notify already wrote for this card (read, dismissed or not) means the post
      -- landed even though its answer did not. Record it as sent and never call again (notify's dedupe skips dismissed
      -- rows, so a second call would ring a second time).
      if exists (select 1 from public.inbox_notifications n where n.dedupe_key = 'content-card:' || v_day::text) then
        update public.content_daily_cards set request_id = null where day = v_day;
        return jsonb_build_object('fire', false, 'why', 'already sent', 'day', v_day, 'expired', v_expired);
      end if;
      update public.content_daily_cards set notified_at = null, request_id = null where day = v_day;
    else
      return jsonb_build_object('fire', false, 'why', 'already picked', 'day', v_day, 'draft_id', c.draft_id, 'expired', v_expired);
    end if;
  else
    v_week := public.content_card_week_poland(p_now);
    if v_week < 2 then
      -- short of 2 Poland posts this week: the best Poland-lane draft, else the newest
      select x.draft_id into v_pick from public.content_card_candidates(p_now) x
       where x.poland_lane
       order by (x.created_at > p_now - interval '14 days') desc, x.lift desc, x.created_at desc, x.draft_id
       limit 1;
      if v_pick is not null then v_why := 'poland'; end if;
    else
      -- the week has its 2: the newest business draft; a Poland-lane one only when there is nothing else
      select x.draft_id into v_pick from public.content_card_candidates(p_now) x
       where not x.poland_lane order by x.created_at desc, x.draft_id limit 1;
      if v_pick is not null then v_why := 'newest'; end if;
    end if;
    if v_pick is null then
      select x.draft_id, case when x.poland_lane then 'poland' else 'newest' end into v_pick, v_why
        from public.content_card_candidates(p_now) x order by x.created_at desc, x.draft_id limit 1;
    end if;
    if v_pick is null then return jsonb_build_object('fire', false, 'why', 'nothing eligible', 'expired', v_expired); end if;
    select post_body into v_body from public.carousel_drafts where id = v_pick;
    insert into public.content_daily_cards(day, draft_id, body_sha256, why, picked_at)
    values (v_day, v_pick, public.content_card_sha(v_body), v_why, p_now);
  end if;

  select * into c from public.content_daily_cards where day = v_day;
  select post_body into v_body from public.carousel_drafts where id = c.draft_id;
  v_payload := public.content_card_payload(v_day, c.draft_id, v_body);
  -- One sender: the row is claimed before the post.
  update public.content_daily_cards set notified_at = p_now, payload = v_payload, notify_attempts = notify_attempts + 1
   where day = v_day and notified_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return jsonb_build_object('fire', false, 'why', 'already sent', 'day', v_day); end if;
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := v_payload, timeout_milliseconds := 30000) into v_req;
  update public.content_daily_cards set request_id = v_req where day = v_day;
  return jsonb_build_object('fire', true, 'day', v_day, 'draft_id', c.draft_id, 'why', c.why, 'payload', v_payload, 'expired', v_expired);
end $function$;

create or replace function public.content_card_today()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.content_daily_cards%rowtype; d public.carousel_drafts%rowtype; v_found boolean; v_live text;
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into c from public.content_daily_cards where day = (now() at time zone 'Europe/Warsaw')::date;
  if not found then return null; end if;
  select * into d from public.carousel_drafts where id = c.draft_id and client_id is null;
  v_found := found;
  v_live := case
    when not v_found or d.status in ('archived', 'disqualified') or coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') = 'true' then 'gone'
    when d.published_at is not null or d.scheduled_at is not null or d.status <> 'review' then 'decided'
    when public.content_card_sha(d.post_body) <> c.body_sha256 then 'changed'
    else 'ok' end;
  return jsonb_build_object('day', c.day, 'state', c.state, 'live', v_live, 'why', c.why, 'picked_at', c.picked_at,
    'draft', case when v_found then jsonb_build_object(
      'id', d.id, 'client_id', d.client_id, 'status', d.status, 'type', d.type, 'title', d.title, 'post_body', d.post_body,
      'image_urls', d.image_urls, 'video_url', d.video_url, 'taxonomy', d.taxonomy, 'scheduled_at', d.scheduled_at,
      'published_at', d.published_at, 'created_at', d.created_at, 'updated_at', d.updated_at,
      'cb34_p2_member', exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id),
      'qa_verdict', d.qa ->> 'verdict', 'line_flags', d.qa -> 'line_flags') end);
end $function$;

drop function if exists public.content_card_answer(date, uuid, text, boolean);
drop function if exists public.content_card_weave_input(date, uuid, text);
drop function if exists public.content_card_ask_save(date, uuid, text, jsonb);
drop function if exists public.content_card_ask_input(date, uuid, boolean);
drop function if exists public.content_card_ask_try(date, timestamptz);
drop function if exists public.content_card_personal_lines(jsonb, text);
drop function if exists public.content_card_source(jsonb, jsonb);

alter table public.content_daily_cards drop constraint if exists content_daily_cards_ask_state_check;
alter table public.content_daily_cards drop constraint if exists content_daily_cards_question_kind_check;
alter table public.content_daily_cards
  drop column if exists question,
  drop column if exists question_anchor,
  drop column if exists question_kind,
  drop column if exists question_why,
  drop column if exists question_sha256,
  drop column if exists ask_state,
  drop column if exists ask_attempts,
  drop column if exists ask_request_id,
  drop column if exists ask_queued_at,
  drop column if exists ask_error,
  drop column if exists asked_at,
  drop column if exists answer,
  drop column if exists answered_at;
