-- content_daily_card: one post card a day for Ivan's own seat (Ivan 2026-11-12: "im gonna need the notification to be
-- clear on my inbox as well not only on my phone... a sliding notif"). He never opens Content (6 decisions in 60 days,
-- 49 of his own drafts waiting); a DM rings with the name and the text and one tap resolves it. This gives a post the
-- same pull: at 11:00 Warsaw one draft is picked, a notification rings the phone (family content_card, the same
-- inbox-notify path as the content_plan "week is ready" alert, db/265), and the app slides it in. Post / Skip / Fix.
--
-- Eligible (Ivan's seat, client_id null only; see below): status 'review', no date, not published, type text or a
-- single image, QA verdict PASS, no QA review block (cb34_p2_review_block), a brain draft only once released and
-- validated (the cb34_p2_read_guard rule), written in the last 30 days, never carded before, not an internal fixture
-- (db/238: taxonomy.internal_test, "[new voice test]" titles) and not deleted by the operator.
--   client_id 'ivan' (editorial-native rows) is left out on purpose: neither approve path takes them
--   (cb39_verdict_set: "This post could not be updated from here."; approveReviewDraft filters client_id is null),
--   so a card for one could never post.
-- Order: while this Warsaw week has fewer than 2 Poland posts dated or published and a Poland draft is eligible, the
-- best Poland draft (written in the last 14 days first, then its source's lift, then the newest: the Plan's
-- polandPicks order). Otherwise the newest eligible draft. Poland = the reasoned read of db/299p + db/299q (the brain
-- check's vote while the body is the released one, else content_poland_reads for the current body), never keywords.
-- Nothing eligible: no card and no notification.
--
-- pg_cron runs in UTC and Warsaw moves between UTC+1 and UTC+2, so the job runs every 15 minutes from 09:00 to 10:45
-- UTC and the function itself acts only in Warsaw's 11 o'clock hour. One card per Warsaw day (primary key), so a
-- second run the same day picks nothing; a later quarter of the same hour can still pick when nothing was eligible
-- at 11:00, and retries a notification whose post failed (at most 3 tries in all).
-- A card still 'shown' on a later day becomes 'expired' at the next run.
--
-- The app reads today's card through content_card_today (signed in, Ivan's lane). Post is ONE transaction,
-- content_card_post (card and draft locked, every check, the existing approve and schedule writes, the card marked
-- posted). content_card_set writes skipped and its Undo; content_card_rebase keeps the card on a body fixed from it.
-- Rollback = 20261112_content_daily_card_rollback.sql.

select set_config('lock_timeout', '5s', true);

create table if not exists public.content_daily_cards (
  day date primary key,
  draft_id uuid not null unique,
  body_sha256 text not null,
  why text not null check (why in ('poland', 'newest')),
  state text not null default 'shown' check (state in ('shown', 'posted', 'skipped', 'expired')),
  picked_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  request_id bigint,
  notify_attempts int not null default 0,
  payload jsonb
);
alter table public.content_daily_cards enable row level security;
revoke all on table public.content_daily_cards from public, anon, authenticated;
grant all on table public.content_daily_cards to service_role;
comment on table public.content_daily_cards is 'One post card per Warsaw day for Ivan''s seat (20261112_content_daily_card). draft_id is unique: a draft is carded once.';

-- JavaScript's String.prototype.trim(): every whitespace and line terminator it strips, Unicode spaces and BOM included
-- (btrim alone strips only spaces), so the database reads taxonomy the way the app's isBrainPost / parseMaybeJson do.
create or replace function public.content_card_jstrim(p text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$ select regexp_replace(p, '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') $$;

-- A taxonomy as an object, whichever way it was stored (a jsonb object, or a JSON string inside jsonb).
create or replace function public.content_card_tax(p jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p) = 'object' then return p; end if;
  if jsonb_typeof(p) = 'string' and left(public.content_card_jstrim(p #>> '{}'), 1) = '{' then
    begin
      p := public.content_card_jstrim(p #>> '{}')::jsonb;
      if jsonb_typeof(p) = 'object' then return p; end if;
    exception when others then null;
    end;
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.content_card_sha(p_body text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(coalesce(p_body, ''), 'UTF8')), 'hex') $$;

-- Poland for one draft's current body: the brain check's vote while the body is the released one, else the stored read
-- of this exact body (db/299q content_poland_of, without its signed-in gate: the pick runs from cron). Null = not read.
create or replace function public.content_card_poland(p_draft uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.content_poland_brain_vote_current(d.id, d.taxonomy, d.post_body),
                  case when r.body_md5 = md5(d.post_body) then r.is_poland end)
    from public.carousel_drafts d
    left join public.content_poland_reads r on r.draft_id = d.id
   where d.id = p_draft
$$;

-- The drafts a card may be made from, now. poland and lift order the Poland-first pick.
create or replace function public.content_card_candidates(p_now timestamptz default now())
returns table(draft_id uuid, created_at timestamptz, poland boolean, lift numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.created_at, public.content_card_poland(d.id),
         coalesce((select case when x.m[2]::numeric > 0 then replace(x.m[1], ',', '')::numeric / x.m[2]::numeric
                               else replace(x.m[1], ',', '')::numeric end
                     from regexp_match(coalesce(d.source_label, ''), '([0-9][0-9,]*) likes vs own median ([0-9]+(?:\.[0-9]+)?)', 'i') as x(m)), 0)
    from public.carousel_drafts d
   where d.client_id is null
     and d.status = 'review'
     and d.scheduled_at is null
     and d.published_at is null
     and d.type in ('text', 'single_image', 'image')
     and d.qa ->> 'verdict' = 'PASS'
     and public.cb34_p2_review_block(d.qa, d.taxonomy) is null
     and d.created_at > p_now - interval '30 days'
     and nullif(btrim(coalesce(d.post_body, '')), '') is not null
     and not coalesce(public.content_card_tax(d.taxonomy) -> 'internal_test' = 'true'::jsonb, false)
     and left(ltrim(coalesce(d.title, '')), 16) <> '[new voice test]'
     and coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') <> 'true'
     and not exists (select 1 from public.content_daily_cards c where c.draft_id = d.id)
     -- a brain draft: only once released and validated for Ivan's seat (cb34_p2_read_guard's member rule)
     and (not exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id)
          or exists (select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'
                       and m.validation ->> 'verdict' = 'PASS' and m.client_id = 'ivan'))
$$;

-- Ivan's Poland posts dated or published in the Warsaw week holding p_now (Mon to Sun).
create or replace function public.content_card_week_poland(p_now timestamptz default now())
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  with w as (
    select ((p_now at time zone 'Europe/Warsaw')::date - (extract(isodow from (p_now at time zone 'Europe/Warsaw')::date)::int - 1)) as d0
  )
  select count(*)::int
    from public.carousel_drafts d, w
   where d.client_id is null
     and coalesce(d.published_at, d.scheduled_at) >= (w.d0::timestamp at time zone 'Europe/Warsaw')
     and coalesce(d.published_at, d.scheduled_at) < ((w.d0 + 7)::timestamp at time zone 'Europe/Warsaw')
     and (d.published_at is not null or d.status in ('review', 'approved', 'scheduled'))
     and coalesce(public.content_card_tax(d.taxonomy) ->> 'deleted_by_operator', '') <> 'true'
     and public.content_card_poland(d.id) is true
$$;

-- The notification for one card: title = the post's first line, body = the next ~120 characters, url = the card.
create or replace function public.content_card_payload(p_day date, p_draft uuid, p_body text)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare v_lines text[]; v_title text; v_rest text;
begin
  select array_agg(btrim(x.l) order by x.n) into v_lines
    from unnest(regexp_split_to_array(btrim(coalesce(p_body, '')), '\n')) with ordinality as x(l, n)
   where btrim(x.l) <> '';
  v_title := coalesce(v_lines[1], 'A post for today');
  if length(v_title) > 200 then v_title := left(v_title, 199) || '…'; end if;
  v_rest := btrim(coalesce(array_to_string(v_lines[2:], ' '), ''));
  if length(v_rest) > 120 then v_rest := rtrim(left(v_rest, 119)) || '…'; end if;
  return jsonb_build_object('family', 'content_card', 'source', 'content-card', 'dedupe_key', 'content-card:' || p_day::text,
    'severity', 'info', 'title', v_title, 'body', nullif(v_rest, ''), 'url', './#exp/d/content/today',
    'media', jsonb_build_object('kind', 'content_card', 'day', p_day, 'draft_id', p_draft), 'push', true);
end $$;

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
      select x.draft_id into v_pick from public.content_card_candidates(p_now) x
       where x.poland is true
       order by (x.created_at > p_now - interval '14 days') desc, x.lift desc, x.created_at desc, x.draft_id
       limit 1;
      if v_pick is not null then v_why := 'poland'; end if;
    end if;
    if v_pick is null then
      select x.draft_id into v_pick from public.content_card_candidates(p_now) x order by x.created_at desc, x.draft_id limit 1;
      v_why := 'newest';
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

-- What the app reads: today's card (Warsaw day) with its draft, or null. `live` says whether the card can still post:
--   ok        the draft is in review, undated, unpublished, and its body is the one picked (or the one Ivan fixed here)
--   changed   its body changed somewhere else since
--   decided   it was approved, dated or published somewhere else since
--   gone      it was archived, skipped in Review, deleted, or is no longer on Ivan's seat
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

-- skipped: today's shown card, the draft untouched; shown: the Undo of a skip, today only. Anything else is refused
-- and changes nothing. (posted is written only by content_card_post.)
create or replace function public.content_card_set(p_day date, p_draft uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare c public.content_daily_cards%rowtype; v_today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('skipped', 'shown') then raise exception 'bad state' using errcode = '22023'; end if;
  select * into c from public.content_daily_cards where day = p_day and draft_id = p_draft for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no such card'); end if;
  if c.state = p_state then return jsonb_build_object('ok', true, 'state', c.state, 'replayed', true); end if;
  if p_state = 'skipped' then
    if c.state <> 'shown' or p_day <> v_today then return jsonb_build_object('ok', false, 'why', 'not today''s card', 'state', c.state); end if;
  else
    if c.state <> 'skipped' or p_day <> v_today then return jsonb_build_object('ok', false, 'why', 'not today''s card', 'state', c.state); end if;
  end if;
  update public.content_daily_cards set state = p_state, resolved_at = case when p_state = 'shown' then null else now() end
   where day = p_day returning * into c;
  return jsonb_build_object('ok', true, 'state', c.state);
end $function$;

-- POST, ONE TRANSACTION. Called once the client's 8 s Undo hold has ended (after that, like the Review desk's one-tap
-- key, there is no Undo: the receipt names the time). Locks, in cb39_verdict_set's order: the cb39 advisory lock for
-- the draft, today's card row, then the draft row FOR UPDATE NOWAIT and its brain membership rows FOR SHARE NOWAIT
-- (NOWAIT: a Review write holding the draft row and waiting on the advisory lock through its cb39_implicit_verdict
-- trigger would otherwise close a cycle). Any busy lock = "Not posted: it is being changed right now. Try again.",
-- nothing written, the card stays shown. On the LOCKED rows it requires: today's card, still 'shown', for this draft;
-- the draft on Ivan's seat (client_id null), in review, undated, unpublished, its body hash equal to the hash of the
-- text the device showed (and to the card's); QA still PASS with no review block; no line flag waiting on his answer
-- (the client's lineFlagsOf + needsKeep, ported below); a brain draft still released and validated; a time not
-- already past (scheduleGuarded's rule). Then the existing path's own writes, unchanged:
--   approve   a brain draft (decided here from the locked membership and taxonomy.source, the client's isBrainPost
--             rule; never the caller's say) = cb39_verdict_set(keep) itself; otherwise approveReviewDraft's update
--   schedule  scheduleGuarded's update (status 'scheduled', scheduled_at; the spacing trigger may move the day)
-- and marks the card posted. Any refused condition raises a plain message and nothing is written (one transaction).
-- A second device tapping Post waits on the card lock, then finds it posted: "already used".
create or replace function public.content_card_post(p_day date, p_draft uuid, p_body_sha text, p_at timestamptz, p_ms_to_verdict int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set lock_timeout to '3s'
set statement_timeout to '20s'
as $function$
declare c public.content_daily_cards%rowtype; d public.carousel_drafts%rowtype; v_n int; v_at timestamptz;
  v_member boolean; v_released boolean; v_brain boolean; lf jsonb; v_flagged boolean;
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_day is null or p_draft is null or p_body_sha is null or p_at is null then raise exception 'bad request' using errcode = '22023'; end if;
  begin
    perform pg_advisory_xact_lock(hashtextextended('cb39-verdict:' || p_draft::text, 0));
    select * into c from public.content_daily_cards where day = p_day for update;
    if not found or c.draft_id <> p_draft or p_day <> (now() at time zone 'Europe/Warsaw')::date then
      raise exception 'Not posted: today''s card changed.' using errcode = 'P0001', hint = 'card_used'; end if;
    if c.state = 'skipped' then raise exception 'Not posted: the card was skipped.' using errcode = 'P0001', hint = 'card_used'; end if;
    if c.state <> 'shown' then raise exception 'Not posted: the card was already used.' using errcode = 'P0001', hint = 'card_used'; end if;
    select * into d from public.carousel_drafts where id = p_draft for update nowait;
    if not found or d.client_id is not null or d.status <> 'review' or d.scheduled_at is not null or d.published_at is not null then
      raise exception 'Not posted: it was already decided in Review.' using errcode = 'P0001', hint = 'card_used'; end if;
    if public.content_card_sha(d.post_body) <> p_body_sha or c.body_sha256 <> p_body_sha then
      raise exception 'Not posted: the text changed.' using errcode = 'P0001', hint = 'card_changed'; end if;
    -- The membership rows stay share-locked until commit: a release flip cannot land between this check and the writes.
    perform 1 from public.cb34_p2_members m where m.draft_id = d.id for share nowait;
    select count(*) > 0, coalesce(bool_or(m.state = 'released' and m.validation ->> 'verdict' = 'PASS' and m.client_id = 'ivan'), false)
      into v_member, v_released from public.cb34_p2_members m where m.draft_id = d.id;
    -- Line flags (lib/lineFlags lineFlagsOf + needsKeep on this exact body): a personal or dated line still in the text,
    -- unmatched lines counted for this text, or a failed re-run note, unless Ivan kept this exact text.
    lf := case when jsonb_typeof(d.qa -> 'line_flags') = 'object' then d.qa -> 'line_flags' end;
    v_flagged := lf is not null and (lf -> 'kept' ->> 'sha') is distinct from p_body_sha and (
      exists (select 1 from jsonb_array_elements(case when jsonb_typeof(lf -> 'lines') = 'array' then lf -> 'lines' else '[]'::jsonb end) x
               where jsonb_typeof(x) = 'object' and x ->> 'kind' in ('personal', 'dated') and jsonb_typeof(x -> 'text') = 'string'
                 and btrim(x ->> 'text') <> '' and strpos(coalesce(d.post_body, ''), x ->> 'text') > 0)
      -- unmatched lines for this text: anything but an absent/null count or a clean zero means Review (stricter than Number())
      or (lf ->> 'lines_sha' = p_body_sha and coalesce(jsonb_typeof(lf -> 'lines_rejected'), 'null') <> 'null'
          and not case jsonb_typeof(lf -> 'lines_rejected')
                    when 'number' then (lf -> 'lines_rejected')::numeric = 0
                    when 'string' then (lf ->> 'lines_rejected') ~ '^0+$'
                    else false end)
      or (jsonb_typeof(lf -> 'rerun') = 'object' and lf -> 'rerun' -> 'pass' = 'false'::jsonb and (lf -> 'rerun_kept' ->> 'sha') is distinct from p_body_sha));
    if coalesce(d.qa ->> 'verdict', '') <> 'PASS' or public.cb34_p2_review_block(d.qa, d.taxonomy) is not null
       or (v_member and not v_released) or v_flagged then
      raise exception 'Not posted: it needs a look in Review.' using errcode = 'P0001', hint = 'card_review'; end if;
    if p_at < now() - interval '5 minutes' then
      raise exception 'That time has already passed. Pick a later time.' using errcode = 'P0001', hint = 'card_past'; end if;

    v_brain := v_member or public.content_card_jstrim(coalesce(public.content_card_tax(d.taxonomy) ->> 'source', '')) = 'content-brain';
    if v_brain then
      perform public.cb39_verdict_set(p_draft, 'keep', '{}'::text[], null, null, p_ms_to_verdict);
    else
      update public.carousel_drafts set status = 'approved'
       where id = p_draft and client_id is null and status = 'review' and published_at is null and scheduled_at is null;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Not approved: this draft changed since it loaded (archived, dated or published).' using errcode = 'P0001'; end if;
    end if;
    update public.carousel_drafts set status = 'scheduled', scheduled_at = p_at
     where id = p_draft and client_id is null and status in ('review', 'approved', 'scheduled') and published_at is null
    returning scheduled_at into v_at;
    if v_at is null then raise exception 'Not scheduled. This draft is no longer in review, approved or scheduled.' using errcode = 'P0001'; end if;
    update public.content_daily_cards set state = 'posted', resolved_at = now() where day = p_day;
  exception when lock_not_available or deadlock_detected then
    -- 55P03 (NOWAIT, or lock_timeout) and 40P01: everything above is rolled back with this block; the card stays shown.
    raise exception 'Not posted: it is being changed right now. Try again.' using errcode = 'P0001', hint = 'card_busy';
  end;
  return jsonb_build_object('ok', true, 'scheduled_at', v_at, 'via', case when v_brain then 'verdict' else 'approve' end);
end $function$;

-- After a fix from the card (the Review editor's own compare-and-swap save), the card follows the new body: only while
-- it is today's shown card, the draft is still in review and undated, and the stored body is exactly p_body.
create or replace function public.content_card_rebase(p_day date, p_draft uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n int;
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.content_daily_cards c set body_sha256 = public.content_card_sha(p_body)
   where c.day = p_day and c.draft_id = p_draft and c.state = 'shown' and p_day = (now() at time zone 'Europe/Warsaw')::date
     and exists (select 1 from public.carousel_drafts d where d.id = p_draft and d.client_id is null and d.status = 'review'
                   and d.scheduled_at is null and d.published_at is null and d.post_body is not distinct from p_body);
  get diagnostics v_n = row_count;
  return v_n = 1;
end $function$;

revoke all on function public.content_card_jstrim(text) from public, anon, authenticated;
revoke all on function public.content_card_tax(jsonb) from public, anon, authenticated;
revoke all on function public.content_card_sha(text) from public, anon, authenticated;
revoke all on function public.content_card_poland(uuid) from public, anon, authenticated;
revoke all on function public.content_card_candidates(timestamptz) from public, anon, authenticated;
revoke all on function public.content_card_week_poland(timestamptz) from public, anon, authenticated;
revoke all on function public.content_card_payload(date, uuid, text) from public, anon, authenticated;
revoke all on function public.content_card_pick(timestamptz) from public, anon, authenticated;
revoke all on function public.content_card_today() from public, anon;
revoke all on function public.content_card_set(date, uuid, text) from public, anon;
revoke all on function public.content_card_rebase(date, uuid, text) from public, anon;
revoke all on function public.content_card_post(date, uuid, text, timestamptz, int) from public, anon;
grant execute on function public.content_card_pick(timestamptz) to service_role;
grant execute on function public.content_card_candidates(timestamptz) to service_role;
grant execute on function public.content_card_today() to authenticated, service_role;
grant execute on function public.content_card_set(date, uuid, text) to authenticated, service_role;
grant execute on function public.content_card_rebase(date, uuid, text) to authenticated, service_role;
grant execute on function public.content_card_post(date, uuid, text, timestamptz, int) to authenticated, service_role;

select cron.schedule('content-daily-card', '*/15 9,10 * * *', 'select public.content_card_pick()')
 where not exists (select 1 from cron.job where jobname = 'content-daily-card');
