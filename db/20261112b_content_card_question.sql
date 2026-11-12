-- content_card_question: one guided question on the day's post card (plan step 2, Ivan 2026-11-12: "no i wont talk
-- about my week unless its something a bit guided"). The drafts are machine-written; the one thing only he can add is
-- a real detail of his own. The machine never adds lived detail by itself (telling the writer to add detail made it
-- invent claims): the detail comes from his answer only.
--
-- At pick time content_card_pick also queues ONE pg_net call to the edge function content-card-ask (after the card's
-- notification, so it never delays it). The function reads the draft, asks the Railway proxy once whether the post
-- already carries a first-hand detail of his and, if not, for ONE question he can answer in one line, and stores the
-- result through content_card_ask_save. A failed ask (pg_net error or timeout, or the function recording a transient
-- failure: proxy down, refused or empty answer, an answer that breaks the question rules) is queued again at a later
-- quarter of the 11:00 hour, 3 calls in all. Nothing about the ask can raise out of the pick (content_card_ask_try
-- catches everything), so the card and its notification never depend on it. No URL configured = no ask.
--   integration_config key content_card_ask_url = https://<project>.supabase.co/functions/v1/content-card-ask
--   (the secret is inbox_push_secret, the same header as the notification call).
--
-- content_card_today returns the question only while it was asked on the draft's current body (a question about old
-- text is not shown) and not yet answered. His answer goes through content-card-weave (signed in), which returns the
-- post with the answer worked in and never writes the draft: he reads it in the card's Fix editor and saves it himself
-- through the existing compare-and-swap save. content_card_answer stores the answer (even if he cancels the edit) and
-- marks the question answered once he saves.
-- Rollback = 20261112b_content_card_question_rollback.sql.

select set_config('lock_timeout', '5s', true);

alter table public.content_daily_cards
  add column if not exists question text,
  add column if not exists question_anchor text,
  add column if not exists question_kind text,
  add column if not exists question_why text,
  add column if not exists question_sha256 text,
  add column if not exists ask_state text,
  add column if not exists ask_attempts int not null default 0,
  add column if not exists ask_request_id bigint,
  add column if not exists ask_queued_at timestamptz,
  add column if not exists ask_error text,
  add column if not exists asked_at timestamptz,
  add column if not exists answer text,
  add column if not exists answered_at timestamptz;

alter table public.content_daily_cards drop constraint if exists content_daily_cards_question_kind_check;
alter table public.content_daily_cards add constraint content_daily_cards_question_kind_check
  check (question_kind in ('own_moment', 'own_number', 'own_take', 'own_words'));
-- queued: a call is out; asked: a question is stored; none: the post already has his detail; failed: a transient
-- failure (retried while attempts last); answered: he saved the post with his answer in it.
alter table public.content_daily_cards drop constraint if exists content_daily_cards_ask_state_check;
alter table public.content_daily_cards add constraint content_daily_cards_ask_state_check
  check (ask_state in ('queued', 'asked', 'none', 'failed', 'answered'));

-- What kind of draft it is, for the question: a near copy of a tracked X post (the db/20261112 Poland-lane marker), a
-- take on someone else's post with its screenshot (db/20261107 taxonomy.source), or his own.
create or replace function public.content_card_source(p_taxonomy jsonb, p_source_detail jsonb)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when (jsonb_typeof(p_source_detail) = 'object' and public.content_card_jstrim(coalesce(p_source_detail ->> 'kind', '')) = 'x_tracked_outlier')
      or public.content_card_jstrim(coalesce(public.content_card_tax(p_taxonomy) ->> 'source', '')) = 'x_tracked_outlier' then 'x_copy'
    when public.content_card_jstrim(coalesce(public.content_card_tax(p_taxonomy) ->> 'source', '')) = 'take_screenshot' then 'take'
    else 'own' end
$$;

-- The personal lines the line-flag job (qa.line_flags, kind personal) marked, still in this body: hints for a copy.
create or replace function public.content_card_personal_lines(p_qa jsonb, p_body text)
returns jsonb
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(distinct x ->> 'text'), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_qa -> 'line_flags' -> 'lines') = 'array' then p_qa -> 'line_flags' -> 'lines' else '[]'::jsonb end) x
   where jsonb_typeof(x) = 'object' and x ->> 'kind' = 'personal' and jsonb_typeof(x -> 'text') = 'string'
     and btrim(x ->> 'text') <> '' and strpos(coalesce(p_body, ''), x ->> 'text') > 0
$$;

-- Queue the ask for today's card, or a retry of a failed one. Called by content_card_pick only. Never raises: any
-- error is returned as {"ask": "error"} and everything this function changed is rolled back with its own block.
-- It never waits long: the card row is locked NOWAIT and any other lock gives up after 1 s (its own lock_timeout),
-- so it cannot eat the pick's 30 s statement timeout. query_canceled is named in the handler because OTHERS does not
-- catch it: a cancel landing here (the pick's statement timeout) costs the ask, never the card or its notification.
create or replace function public.content_card_ask_try(p_day date, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set lock_timeout to '1s'
as $function$
declare c public.content_daily_cards%rowtype; v_url text; v_secret text; v_req bigint; v_has boolean := false; v_status int;
begin
  begin
    select * into c from public.content_daily_cards where day = p_day for update nowait;
    if not found or c.state <> 'shown' then return jsonb_build_object('ask', 'no card'); end if;
    if c.ask_state in ('asked', 'none', 'answered') then return jsonb_build_object('ask', c.ask_state); end if;
    if c.ask_state = 'queued' then
      -- a call is out: wait for its answer (the proxy can take minutes); an error or a timeout is retried
      if c.ask_queued_at > p_now - interval '3 minutes' then return jsonb_build_object('ask', 'waiting'); end if;
      select true, h.status_code into v_has, v_status from net._http_response h where h.id = c.ask_request_id;
      if not coalesce(v_has, false) then return jsonb_build_object('ask', 'waiting'); end if;
      -- the function answered 2xx without storing a result: it found nothing to ask about (text changed, card used)
      if v_status between 200 and 299 then return jsonb_build_object('ask', 'settled'); end if;
    end if;
    if c.ask_attempts >= 3 then return jsonb_build_object('ask', 'gave up'); end if;
    select value into v_url from public.integration_config where key = 'content_card_ask_url';
    if nullif(btrim(coalesce(v_url, '')), '') is null then return jsonb_build_object('ask', 'not configured'); end if;
    select value into v_secret from public.integration_config where key = 'inbox_push_secret';
    update public.content_daily_cards set ask_state = 'queued', ask_attempts = ask_attempts + 1, ask_queued_at = p_now, ask_error = null
     where day = p_day;
    select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
             body := jsonb_build_object('day', p_day, 'draft_id', c.draft_id), timeout_milliseconds := 150000) into v_req;
    update public.content_daily_cards set ask_request_id = v_req where day = p_day;
    return jsonb_build_object('ask', 'queued', 'attempt', c.ask_attempts + 1);
  exception
    when query_canceled then
      return jsonb_build_object('ask', 'error', 'error', 'canceled');
    when others then
      return jsonb_build_object('ask', 'error', 'error', left(sqlerrm, 200));
  end;
end $function$;

-- content_card_pick as in db/20261112, plus the ask after the notification on every run of the 11:00 hour that finds
-- or makes today's card (the "|| content_card_ask_try(...)" on each return below). Nothing else changed.
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
        return jsonb_build_object('fire', false, 'why', 'already sent', 'day', v_day, 'expired', v_expired) || public.content_card_ask_try(v_day, p_now);
      end if;
      update public.content_daily_cards set notified_at = null, request_id = null where day = v_day;
    else
      return jsonb_build_object('fire', false, 'why', 'already picked', 'day', v_day, 'draft_id', c.draft_id, 'expired', v_expired) || public.content_card_ask_try(v_day, p_now);
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
  if v_claimed = 0 then return jsonb_build_object('fire', false, 'why', 'already sent', 'day', v_day) || public.content_card_ask_try(v_day, p_now); end if;
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := v_payload, timeout_milliseconds := 30000) into v_req;
  update public.content_daily_cards set request_id = v_req where day = v_day;
  return jsonb_build_object('fire', true, 'day', v_day, 'draft_id', c.draft_id, 'why', c.why, 'payload', v_payload, 'expired', v_expired)
    || public.content_card_ask_try(v_day, p_now);
end $function$;

-- What content-card-ask reads (service only). p_dry: any of Ivan's own drafts in review, no card needed (a replay on
-- real drafts before going live). Otherwise: the day's card for this draft, still shown, not yet asked, and the body
-- still the one the card holds.
create or replace function public.content_card_ask_input(p_day date, p_draft uuid, p_dry boolean default false)
returns jsonb
language plpgsql stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare d public.carousel_drafts%rowtype; c public.content_daily_cards%rowtype; v_sha text;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  select * into d from public.carousel_drafts where id = p_draft and client_id is null;
  if not found then return jsonb_build_object('ok', false, 'why', 'not an own draft'); end if;
  if nullif(btrim(coalesce(d.post_body, '')), '') is null then return jsonb_build_object('ok', false, 'why', 'no text'); end if;
  v_sha := public.content_card_sha(d.post_body);
  if coalesce(p_dry, false) then
    if d.status <> 'review' then return jsonb_build_object('ok', false, 'why', 'not in review'); end if;
  else
    select * into c from public.content_daily_cards where day = p_day and draft_id = p_draft;
    if not found or c.state <> 'shown' then return jsonb_build_object('ok', false, 'why', 'not a shown card'); end if;
    if c.ask_state in ('asked', 'none', 'answered') then return jsonb_build_object('ok', false, 'why', 'already asked'); end if;
    if c.body_sha256 <> v_sha then return jsonb_build_object('ok', false, 'why', 'text changed'); end if;
  end if;
  return jsonb_build_object('ok', true, 'body', d.post_body, 'sha', v_sha, 'source', public.content_card_source(d.taxonomy, d.source_detail),
    'source_label', d.source_label, 'hints', public.content_card_personal_lines(d.qa, d.post_body));
end $function$;

-- What content-card-ask stores (service only). First result wins; only for the day's shown card whose body is still
-- the one asked about (p_sha). p_result.state: 'asked' (question, anchor verbatim in the body, kind), 'none' (the post
-- already carries his detail) or 'failed' (transient: retried by the pick while attempts last). A question that does
-- not hold up here is stored as failed, never as a question. The anchor must sit inside ONE paragraph: it may not
-- hold a blank line (newline, spaces or tabs, newline), the paragraph rule of _shared/content-card.ts.
create or replace function public.content_card_ask_save(p_day date, p_draft uuid, p_sha text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.content_daily_cards%rowtype; v_body text; v_state text := p_result ->> 'state';
  v_q text := nullif(btrim(coalesce(p_result ->> 'question', '')), ''); v_a text := nullif(p_result ->> 'anchor', '');
  v_k text := p_result ->> 'kind'; v_why text := left(nullif(btrim(coalesce(p_result ->> 'why', '')), ''), 300);
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  select * into c from public.content_daily_cards where day = p_day and draft_id = p_draft for update;
  if not found or c.state <> 'shown' then return jsonb_build_object('ok', false, 'why', 'not a shown card'); end if;
  if c.ask_state in ('asked', 'none', 'answered') then return jsonb_build_object('ok', false, 'why', 'already asked'); end if;
  select post_body into v_body from public.carousel_drafts where id = p_draft and client_id is null;
  if p_sha is null or c.body_sha256 <> p_sha or public.content_card_sha(v_body) <> p_sha then
    return jsonb_build_object('ok', false, 'why', 'text changed'); end if;
  if v_state = 'asked' and (v_q is null or length(v_q) > 300 or v_a is null or strpos(coalesce(v_body, ''), v_a) = 0
       or v_a ~ '\n[[:blank:]]*\n' or v_k is null or v_k not in ('own_moment', 'own_number', 'own_take', 'own_words')) then
    v_state := 'failed'; p_result := jsonb_build_object('error', 'question refused by the database');
  end if;
  if v_state = 'asked' then
    update public.content_daily_cards set ask_state = 'asked', question = v_q, question_anchor = v_a, question_kind = v_k,
      question_why = v_why, question_sha256 = p_sha, asked_at = now(), ask_error = null where day = p_day;
  elsif v_state = 'none' then
    update public.content_daily_cards set ask_state = 'none', question = null, question_anchor = null, question_kind = null,
      question_why = v_why, question_sha256 = p_sha, asked_at = now(), ask_error = null where day = p_day;
  elsif v_state = 'failed' then
    update public.content_daily_cards set ask_state = 'failed', ask_error = left(coalesce(p_result ->> 'error', 'failed'), 300) where day = p_day;
  else
    raise exception 'bad state' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'state', v_state);
end $function$;

-- What content-card-weave reads (service only): today's shown card for this draft with a live question asked on this
-- exact body (p_sha), the draft still in review, undated and unpublished.
create or replace function public.content_card_weave_input(p_day date, p_draft uuid, p_sha text)
returns jsonb
language plpgsql stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.content_daily_cards%rowtype; d public.carousel_drafts%rowtype;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  select * into c from public.content_daily_cards where day = p_day and draft_id = p_draft;
  if not found or c.state <> 'shown' or p_day <> (now() at time zone 'Europe/Warsaw')::date then
    return jsonb_build_object('ok', false, 'why', 'not today''s card'); end if;
  if c.ask_state <> 'asked' or c.question is null then return jsonb_build_object('ok', false, 'why', 'no question'); end if;
  select * into d from public.carousel_drafts where id = p_draft and client_id is null;
  if not found or d.status <> 'review' or d.scheduled_at is not null or d.published_at is not null then
    return jsonb_build_object('ok', false, 'why', 'not in review'); end if;
  if p_sha is null or c.question_sha256 <> p_sha or c.body_sha256 <> p_sha or public.content_card_sha(d.post_body) <> p_sha then
    return jsonb_build_object('ok', false, 'why', 'text changed'); end if;
  return jsonb_build_object('ok', true, 'body', d.post_body, 'question', c.question, 'anchor', c.question_anchor, 'kind', c.question_kind,
    'source', public.content_card_source(d.taxonomy, d.source_detail), 'source_label', d.source_label);
end $function$;

-- His answer (signed in, Ivan's lane), kept even when he cancels the edit. p_saved: he saved the post with it, so the
-- question is answered and never shown again.
create or replace function public.content_card_answer(p_day date, p_draft uuid, p_answer text, p_saved boolean default false)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v text := nullif(btrim(coalesce(p_answer, '')), ''); v_n int;
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v is null or length(v) > 2000 then raise exception 'bad answer' using errcode = '22023'; end if;
  update public.content_daily_cards
     set answer = v, answered_at = now(),
         ask_state = case when coalesce(p_saved, false) then 'answered' else ask_state end
   where day = p_day and draft_id = p_draft and state = 'shown' and p_day = (now() at time zone 'Europe/Warsaw')::date
     and ask_state in ('asked', 'answered');
  get diagnostics v_n = row_count;
  return v_n = 1;
end $function$;

-- content_card_today as in db/20261112, plus `question`: shown only while it was asked on the draft's current body,
-- not yet answered, and the card can still post.
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
      'qa_verdict', d.qa ->> 'verdict', 'line_flags', d.qa -> 'line_flags') end,
    'question', case when v_live = 'ok' and c.state = 'shown' and c.ask_state = 'asked' and c.question is not null
                      and c.question_sha256 = public.content_card_sha(d.post_body)
                 then jsonb_build_object('text', c.question, 'anchor', c.question_anchor, 'kind', c.question_kind,
                        'sha', c.question_sha256, 'answer', c.answer) end);
end $function$;

revoke all on function public.content_card_source(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.content_card_personal_lines(jsonb, text) from public, anon, authenticated;
revoke all on function public.content_card_ask_try(date, timestamptz) from public, anon, authenticated;
revoke all on function public.content_card_ask_input(date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.content_card_ask_save(date, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.content_card_weave_input(date, uuid, text) from public, anon, authenticated;
revoke all on function public.content_card_answer(date, uuid, text, boolean) from public, anon;
grant execute on function public.content_card_ask_input(date, uuid, boolean) to service_role;
grant execute on function public.content_card_ask_save(date, uuid, text, jsonb) to service_role;
grant execute on function public.content_card_weave_input(date, uuid, text) to service_role;
grant execute on function public.content_card_answer(date, uuid, text, boolean) to authenticated, service_role;
