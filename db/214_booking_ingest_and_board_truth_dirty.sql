-- 214: ONE booking write path for off-HubSpot bookings + immediate board truth refresh.
-- 2026-09-27 (Ivan, Ofir Bello: "he should be under Call booked. The board needs to be aware of these things.")
--
-- booking_ingest_event(p jsonb) is the single writer used by:
--   * the booking-confirmation branch of "Outreach - ARCH Email Inbound" (Vhc6Uv9nxuKJDJwB): Calendly / cal.com /
--     HubSpot meeting emails and any .ics invite
--   * the Google Calendar source of "Outreach - ARCH Booking Attribution Tracker" (wyJZ9TcGul7QvDEz), when armed
--   * ops_task_mark_booked() - the "Booked" action on a book-their-link task card (Ops board)
-- Rules (mirrors the HubSpot tracker, see booking-attribution-tracker-live-2026-08-07):
--   * tenancy = outreach_campaigns.client_id on every prospect lookup
--   * match: exact email (prospect.email, or an address we emailed on the thread), then exact company domain
--     (free mail never domain-matches); a NAME is only a tie-breaker between candidates, never a match on its own
--   * idempotent on meeting_id (= namespaced event id); a reschedule updates meeting_start; a cancellation clears
--     (verdict -> unattributed, outcome CANCELED, call_booked_at nulled only if this booking stamped it)
--   * call_booked_at is written only when empty (first booking wins)
--   * a HAND-ENTERED booking (meeting_id 'manual-%' or rationale 'Hand-entered...') is never modified by a sync:
--     a disagreeing event opens an Ops task card for Ivan instead (Ofir Bello 28 Sep 13:30 UTC is one of these)
--   * same prospect + a start within 30 min of an existing live row = the same meeting seen by a second source
--     (HubSpot + calendar, Calendly email + calendar): no second row
--   * verdict/strength/pre-engagement gate identical to the tracker: who moved first before the booking,
--     thread older than <client>_engagement_start is never claimed

create table if not exists public.booking_sync_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  client_id text, source text, event_id text, status text,
  action text not null, prospect_id uuid, dry_run boolean not null default false,
  detail jsonb
);
create index if not exists booking_sync_log_event_idx on public.booking_sync_log (event_id, created_at desc);

insert into public.integration_config (key, value, is_secret, updated_at)
values ('booking_sync_config', jsonb_build_object(
  'own_domains', jsonb_build_object(
     'arch', jsonb_build_array('madebyarch.com','arch.agency','ivanmanfredi.com','inboundonsteroids.com'),
     'risedtc', jsonb_build_array('risedtc.com','ivanmanfredi.com','inboundonsteroids.com')),
  'system_domains', jsonb_build_array('calendly.com','cal.com','hubspot.com','hubspotemail.net','google.com',
     'resource.calendar.google.com','group.calendar.google.com','zoom.us','microsoft.com','outlook.com'),
  'free_domains', jsonb_build_array('gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com',
     'live.com','msn.com','protonmail.com','proton.me','gmx.com','ymail.com','googlemail.com','mail.com','comcast.net',
     'att.net','verizon.net'),
  'same_meeting_window_minutes', 30,
  'note', 'Read by booking_ingest_event() (db/214). own_domains = our side of the table per client; attendees on these are never matched.'
)::text, false, now())
on conflict (key) do nothing;

create or replace function public._bk_host(u text) returns text
language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(u,''))), '^[a-z]+://', ''), '^www\.', ''), '[/?#:].*$', ''), '')
$$;

create or replace function public._bk_email_domain(e text) returns text
language sql immutable as $$
  select case when position('@' in coalesce(e,'')) > 1 then nullif(split_part(lower(btrim(e)), '@', 2), '') end
$$;

create or replace function public._bk_norm_name(s text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(s,'')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-- name tie-breaker: exact normalized full name, or first token + last token equal
create or replace function public._bk_name_match(a text, b text) returns boolean
language sql immutable as $$
  select case
    when public._bk_norm_name(a) is null or public._bk_norm_name(b) is null then false
    when public._bk_norm_name(a) = public._bk_norm_name(b) then true
    else split_part(public._bk_norm_name(a), ' ', 1) = split_part(public._bk_norm_name(b), ' ', 1)
         and regexp_replace(public._bk_norm_name(a), '^.* ', '') = regexp_replace(public._bk_norm_name(b), '^.* ', '')
         and position(' ' in public._bk_norm_name(a)) > 0 and position(' ' in public._bk_norm_name(b)) > 0
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- board truth: dirty queue + flush (item 3). A booking stamp from ANY writer (this function, the
-- HubSpot trackers, a hand PATCH) marks its client dirty; pg_cron flushes every minute.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.board_truth_dirty (
  client_id text primary key,
  dirty_at timestamptz not null default now(),
  flushed_at timestamptz,
  last_reason text,
  last_error text
);

create or replace function public.board_truth_mark_dirty(p_client text, p_reason text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.board_truth_dirty (client_id, dirty_at, last_reason)
  select p_client, now(), left(p_reason, 200) where p_client in ('arch','risedtc')
  on conflict (client_id) do update set dirty_at = now(), last_reason = excluded.last_reason
$$;

create or replace function public.board_truth_flush() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; out jsonb := '[]'::jsonb; t0 timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('board_truth_flush')) then
    return jsonb_build_object('skipped', 'locked');
  end if;
  for r in select client_id, dirty_at from public.board_truth_dirty
            where flushed_at is null or dirty_at > flushed_at loop
    t0 := clock_timestamp();
    begin
      if r.client_id = 'arch' then perform public.arch_outreach_truth_apply();
      elsif r.client_id = 'risedtc' then perform public.rise_outreach_truth_apply();
      end if;
      update public.board_truth_dirty set flushed_at = t0, last_error = null where client_id = r.client_id;
      out := out || jsonb_build_object('client', r.client_id, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
    exception when others then
      update public.board_truth_dirty set last_error = left(sqlerrm, 300) where client_id = r.client_id;
      out := out || jsonb_build_object('client', r.client_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('flushed', out);
end $$;

create or replace function public.trg_board_truth_dirty_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public.board_truth_mark_dirty(new.client_id, 'booking_attributions ' || lower(tg_op) || ' ' || new.meeting_id); end if;
  if tg_op in ('UPDATE','DELETE') and old.client_id is distinct from coalesce(new.client_id, '') then perform public.board_truth_mark_dirty(old.client_id, 'booking_attributions ' || lower(tg_op) || ' ' || old.meeting_id); end if;
  return null;
end $$;

create or replace function public.trg_board_truth_dirty_prospect() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select client_id into c from public.outreach_campaigns where id = new.campaign_id;
  if c in ('arch','risedtc') then perform public.board_truth_mark_dirty(c, 'call_booked_at ' || new.id::text); end if;
  return null;
end $$;

create or replace function public.trg_board_truth_dirty_email_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select oc.client_id into c from public.outreach_prospects p join public.outreach_campaigns oc on oc.id = p.campaign_id where p.id = new.prospect_id;
  if c in ('arch','risedtc') then perform public.board_truth_mark_dirty(c, 'inbound email ' || new.id::text); end if;
  return null;
end $$;

drop trigger if exists trg_board_truth_dirty on public.booking_attributions;
create trigger trg_board_truth_dirty after insert or update or delete on public.booking_attributions
  for each row execute function public.trg_board_truth_dirty_booking();

drop trigger if exists trg_board_truth_dirty_booked on public.outreach_prospects;
create trigger trg_board_truth_dirty_booked after update of call_booked_at on public.outreach_prospects
  for each row when (old.call_booked_at is distinct from new.call_booked_at)
  execute function public.trg_board_truth_dirty_prospect();

drop trigger if exists trg_board_truth_dirty_email on public.outreach_messages;
create trigger trg_board_truth_dirty_email after insert on public.outreach_messages
  for each row when (new.direction = 'inbound' and new.channel = 'email')
  execute function public.trg_board_truth_dirty_email_reply();

-- ---------------------------------------------------------------------------------------------
-- Ops task card helper (kind='task' = Ivan's list; no dispatcher picks 'task', proven 08-30)
-- ---------------------------------------------------------------------------------------------
create or replace function public._bk_task_card(p_key text, p_body text, p_ctx jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.ops_drafts
   where kind = 'task' and context->>'dedupe_key' = p_key and sent_at is null and send_blocked_reason is null limit 1;
  if v is not null then return v; end if;
  insert into public.ops_drafts (client_id, kind, slack_channel, body, context)
  values ('ivan', 'task', null, p_body,
          coalesce(p_ctx, '{}'::jsonb) || jsonb_build_object('dedupe_key', p_key, 'source', 'claude', 'captured_at', now()))
  returning id into v;
  return v;
end $$;

-- clear one booking row: verdict -> unattributed (constraint nulls the evidence), outcome CANCELED,
-- and null call_booked_at only when THIS booking stamped it and no other live attributed booking remains
create or replace function public._bk_cancel_row(p_meeting_id text, p_source text) returns void
language plpgsql security definer set search_path = public as $$
declare ex record;
begin
  select * into ex from booking_attributions where meeting_id = p_meeting_id;
  if ex.meeting_id is null or coalesce(ex.meeting_outcome, '') in ('CANCELED','CANCELLED') then return; end if;
  if ex.prospect_stamped and ex.prospect_id is not null then
    update outreach_prospects set call_booked_at = null
     where id = ex.prospect_id and call_booked_at = ex.booked_at
       and not exists (select 1 from booking_attributions b where b.prospect_id = ex.prospect_id
                        and b.meeting_id <> ex.meeting_id and b.verdict <> 'unattributed'
                        and coalesce(b.meeting_outcome, '') not in ('CANCELED','CANCELLED'));
  end if;
  update booking_attributions set verdict = 'unattributed', evidence_type = null, evidence_value = null,
         evidence_strength = null, prospect_id = null, opened_by = null, prospect_stamped = false,
         meeting_outcome = 'CANCELED', updated_at = now(),
         rationale = left(coalesce(rationale, '') || ' Cancelled (' || p_source || ', ' || to_char(now() at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC); booking cleared.', 1400)
   where meeting_id = p_meeting_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- THE writer
-- p: {client_id, source, event_id, status: confirmed|cancelled, start_at, booked_at, title,
--     attendees: [{email,name}], prospect_id?, hand_entered?, dry_run?, raw_ref?}
-- ---------------------------------------------------------------------------------------------
create or replace function public.booking_ingest_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client text := nullif(btrim(p->>'client_id'), '');
  v_source text := coalesce(nullif(btrim(p->>'source'), ''), 'unknown');
  v_event  text := nullif(btrim(p->>'event_id'), '');
  v_status text := case when lower(coalesce(p->>'status','')) in ('cancelled','canceled','cancel') then 'cancelled' else 'confirmed' end;
  v_start  timestamptz := nullif(p->>'start_at', '')::timestamptz;
  v_booked timestamptz := coalesce(nullif(p->>'booked_at', '')::timestamptz, now());
  v_title  text := left(nullif(btrim(p->>'title'), ''), 300);
  v_dry    boolean := coalesce((p->>'dry_run')::boolean, false);
  v_forced uuid := nullif(p->>'prospect_id', '')::uuid;
  v_hand   boolean := coalesce((p->>'hand_entered')::boolean, false);
  v_raw    text := left(p->>'raw_ref', 300);
  v_prev   timestamptz := nullif(p->>'previous_start_at', '')::timestamptz;   -- Calendly reschedule: the former start
  cfg jsonb; own text[]; sys text[]; free text[]; win interval;
  camp_ids uuid[];
  ex record; hand_row record; same_row record; pr record;
  att jsonb; att_emails text[] := '{}'; att_names text[] := '{}'; att_domains text[] := '{}';
  v_pid uuid; v_ev text; v_val text; v_cid uuid; v_bemail text; v_bname text;
  n int; v_verdict text; v_strength text; v_opened text; v_why text;
  first_out timestamptz; first_in timestamptz; conn_at timestamptz; eng_at timestamptz; thread_start timestamptz;
  first_touch timestamptz; first_what text; engage_start timestamptz; open_channel boolean;
  v_stamped boolean := false; v_rationale text; v_action text; v_card uuid; res jsonb;
begin
  if v_client not in ('arch','risedtc') then
    return jsonb_build_object('ok', false, 'error', 'client_id must be arch or risedtc');
  end if;
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'event_id required'); end if;

  cfg := coalesce((select value::jsonb from integration_config where key = 'booking_sync_config'), '{}'::jsonb);
  own  := array(select lower(jsonb_array_elements_text(coalesce(cfg->'own_domains'->v_client, '[]'::jsonb))));
  sys  := array(select lower(jsonb_array_elements_text(coalesce(cfg->'system_domains', '[]'::jsonb))));
  free := array(select lower(jsonb_array_elements_text(coalesce(cfg->'free_domains', '[]'::jsonb))));
  win  := make_interval(mins => coalesce((cfg->>'same_meeting_window_minutes')::int, 30));
  camp_ids := array(select id from outreach_campaigns where client_id = v_client);
  if coalesce(array_length(camp_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no campaigns for client ' || v_client);
  end if;

  -- external attendees (never our own side, never the scheduling system)
  for att in select * from jsonb_array_elements(coalesce(p->'attendees', '[]'::jsonb)) loop
    if _bk_email_domain(att->>'email') is null then continue; end if;
    if _bk_email_domain(att->>'email') = any(own) or _bk_email_domain(att->>'email') = any(sys)
       or exists (select 1 from unnest(own || sys) d where _bk_email_domain(att->>'email') like '%.' || d) then continue; end if;
    att_emails := att_emails || lower(btrim(att->>'email'));
    att_names := att_names || coalesce(att->>'name', '');
    if not (_bk_email_domain(att->>'email') = any(free)) then att_domains := att_domains || _bk_email_domain(att->>'email'); end if;
  end loop;
  v_bemail := att_emails[1]; v_bname := nullif(att_names[1], '');

  select * into ex from booking_attributions where meeting_id = v_event;
  if found and ex.client_id is distinct from v_client then
    return jsonb_build_object('ok', false, 'error', 'event belongs to client ' || ex.client_id);
  end if;

  -- ---------- 1. known event ----------
  if ex.meeting_id is not null then
    if (ex.meeting_id like 'manual-%' or coalesce(ex.rationale, '') ilike 'hand-entered%') and not v_hand then
      v_action := 'hand_entered_untouched';
      if (v_status = 'cancelled') or (v_start is not null and abs(extract(epoch from (v_start - ex.meeting_start))) > 300) then
        v_action := 'hand_entered_conflict_card';
        if not v_dry then
          v_card := _bk_task_card('booking_conflict:' || v_event || ':' || v_status || ':' || coalesce(v_start::text, ''),
            'Check ' || coalesce(ex.booker_name, 'a booking') || '''s call time (you entered it by hand)' || chr(10) ||
            'You entered ' || to_char(ex.meeting_start at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC. ' ||
            initcap(v_source) || ' now says ' || case when v_status = 'cancelled' then 'it was CANCELLED' else to_char(v_start at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC' end ||
            '. Nothing was changed; fix it by hand if the new time is right.',
            jsonb_build_object('client_id', v_client, 'meeting_id', ex.meeting_id, 'prospect_id', ex.prospect_id, 'kind_detail', 'booking_conflict'));
        end if;
      end if;
    elsif v_status = 'cancelled' then
      v_action := 'cancelled';
      if not v_dry then perform _bk_cancel_row(v_event, v_source); end if;
    else
      if v_start is not null and ex.meeting_start is distinct from v_start then
        v_action := 'rescheduled';
        if not v_dry then
          update booking_attributions set meeting_start = v_start, meeting_outcome = 'SCHEDULED', updated_at = now(),
                 rationale = left(coalesce(rationale, '') || ' Rescheduled from ' || coalesce(to_char(ex.meeting_start at time zone 'UTC', 'DD Mon HH24:MI'), '?') || ' UTC (' || v_source || ').', 1400)
           where meeting_id = v_event;
        end if;
      else
        v_action := 'unchanged';
      end if;
    end if;
    res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', v_event, 'prospect_id', ex.prospect_id, 'card', v_card, 'dry_run', v_dry);
    insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
    values (v_client, v_source, v_event, v_status, v_action, ex.prospect_id, v_dry, p - 'attendees' || jsonb_build_object('result', res));
    return res;
  end if;

  -- ---------- 2. match a prospect (tenant-scoped) ----------
  if v_forced is not null then
    select id, name, email, campaign_id, linkedin_profile_id, linkedin_url, call_booked_at into pr
      from outreach_prospects where id = v_forced and campaign_id = any(camp_ids);
    if not found then return jsonb_build_object('ok', false, 'error', 'prospect not in client ' || v_client); end if;
    v_pid := pr.id; v_cid := pr.campaign_id;
    if nullif(btrim(pr.email), '') is not null then v_ev := 'stated_email_exact'; v_val := lower(btrim(pr.email));
    else v_ev := 'linkedin_profile_id'; v_val := coalesce(nullif(pr.linkedin_profile_id, ''), li_slug(pr.linkedin_url), pr.id::text); end if;
    v_bemail := coalesce(v_bemail, lower(nullif(btrim(pr.email), ''))); v_bname := coalesce(v_bname, pr.name);
  elsif coalesce(array_length(att_emails, 1), 0) > 0 then
    -- 2a exact email: prospect.email, or an address we mailed on the thread
    with c as (
      select p2.id, p2.name, p2.campaign_id, p2.reply_count, p2.last_reply_at, p2.created_at, lower(btrim(p2.email)) as em
        from outreach_prospects p2
       where p2.campaign_id = any(camp_ids) and lower(btrim(p2.email)) = any(att_emails)
      union
      select p2.id, p2.name, p2.campaign_id, p2.reply_count, p2.last_reply_at, p2.created_at, lower(btrim(m.recipient_email))
        from outreach_messages m join outreach_prospects p2 on p2.id = m.prospect_id
       where p2.campaign_id = any(camp_ids) and lower(btrim(m.recipient_email)) = any(att_emails)
      union
      -- the address they booked with before (a HubSpot booking already joined this person)
      select p2.id, p2.name, p2.campaign_id, p2.reply_count, p2.last_reply_at, p2.created_at, lower(btrim(b.booker_email))
        from booking_attributions b join outreach_prospects p2 on p2.id = b.prospect_id
       where b.client_id = v_client and p2.campaign_id = any(camp_ids) and lower(btrim(b.booker_email)) = any(att_emails)
    )
    select c.id, c.campaign_id, c.em into v_pid, v_cid, v_val from c
     order by (exists (select 1 from unnest(att_names) an where _bk_name_match(an, c.name))) desc,
              coalesce(c.reply_count, 0) desc, c.last_reply_at desc nulls last, c.created_at asc
     limit 1;
    if v_pid is not null then
      v_ev := 'email_exact';
      v_bemail := v_val;
    else
      -- 2a' the exact address typed by the prospect in their own inbound message (Basile, Jacky, Alan cases)
      select p2.id, p2.campaign_id, e.em into v_pid, v_cid, v_val
        from outreach_messages m join outreach_prospects p2 on p2.id = m.prospect_id
        cross join unnest(att_emails) e(em)
       where p2.campaign_id = any(camp_ids) and m.direction = 'inbound'
         and position(e.em in lower(coalesce(m.message_text, ''))) > 0
       order by (exists (select 1 from unnest(att_names) an where _bk_name_match(an, p2.name))) desc,
                coalesce(p2.reply_count, 0) desc, m.sent_at desc nulls last
       limit 1;
      if v_pid is not null then v_ev := 'stated_email_exact'; v_bemail := v_val; end if;
    end if;
    if v_pid is not null then
      null;
    elsif coalesce(array_length(att_domains, 1), 0) > 0 then
      -- 2b exact company domain (non-free); a name only breaks a tie
      select count(*) into n from outreach_prospects p2
       where p2.campaign_id = any(camp_ids)
         and (_bk_host(p2.company_domain) = any(att_domains) or (_bk_email_domain(p2.email) = any(att_domains)));
      if n = 1 then
        select p2.id, p2.campaign_id, coalesce(case when _bk_host(p2.company_domain) = any(att_domains) then _bk_host(p2.company_domain) end, _bk_email_domain(p2.email))
          into v_pid, v_cid, v_val from outreach_prospects p2
         where p2.campaign_id = any(camp_ids)
           and (_bk_host(p2.company_domain) = any(att_domains) or (_bk_email_domain(p2.email) = any(att_domains)));
        v_ev := 'email_domain';
      elsif n > 1 then
        select count(*) into n from outreach_prospects p2
         where p2.campaign_id = any(camp_ids)
           and (_bk_host(p2.company_domain) = any(att_domains) or (_bk_email_domain(p2.email) = any(att_domains)))
           and exists (select 1 from unnest(att_names) an where _bk_name_match(an, p2.name));
        if n >= 1 then
          -- several rows can be the same human (dupe rows): only admit when every name-matched row shares one person key
          select p2.id, p2.campaign_id, coalesce(_bk_host(p2.company_domain), _bk_email_domain(p2.email)) into v_pid, v_cid, v_val
            from outreach_prospects p2
           where p2.campaign_id = any(camp_ids)
             and (_bk_host(p2.company_domain) = any(att_domains) or (_bk_email_domain(p2.email) = any(att_domains)))
             and exists (select 1 from unnest(att_names) an where _bk_name_match(an, p2.name))
           order by coalesce(p2.reply_count, 0) desc, p2.last_reply_at desc nulls last, p2.created_at asc limit 1;
          if (select count(distinct _bk_norm_name(p2.name)) from outreach_prospects p2
               where p2.campaign_id = any(camp_ids)
                 and (_bk_host(p2.company_domain) = any(att_domains) or (_bk_email_domain(p2.email) = any(att_domains)))
                 and exists (select 1 from unnest(att_names) an where _bk_name_match(an, p2.name))) > 1 then
            v_pid := null; v_action := 'ambiguous_domain';
          else
            v_ev := 'email_domain';
          end if;
        else
          v_action := 'ambiguous_domain';
        end if;
      end if;
    end if;
  end if;

  if v_pid is null then
    v_action := coalesce(v_action, case when coalesce(array_length(att_emails, 1), 0) = 0 then 'no_external_attendee' else 'unmatched' end);
    -- a cancellation / reschedule for an event we never saw, from a prospect who has a hand-entered booking, is Ivan's call
    res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', v_event, 'dry_run', v_dry, 'attendees', to_jsonb(att_emails));
    -- a calendar source reads the seat owner's private calendar: an event that is not one of our prospects is never logged
    if v_source not like 'gcal%' then
      insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
      values (v_client, v_source, v_event, v_status, v_action, null, v_dry, p - 'attendees' || jsonb_build_object('result', res, 'attendees', to_jsonb(att_emails)));
    end if;
    return res;
  end if;

  select id, name, email, campaign_id, connection_sent_at, call_booked_at into pr from outreach_prospects where id = v_pid;

  -- ---------- 3. same meeting already on record (another source / hand-entered) ----------
  select * into hand_row from booking_attributions b
   where b.client_id = v_client and b.prospect_id = v_pid
     and (b.meeting_id like 'manual-%' or coalesce(b.rationale, '') ilike 'hand-entered%')
     and coalesce(b.meeting_outcome, '') not in ('CANCELED','CANCELLED')
   order by abs(extract(epoch from (b.meeting_start - coalesce(v_start, b.meeting_start)))) asc limit 1;
  if hand_row.meeting_id is not null and not v_hand then
    if v_status = 'cancelled' or (v_start is not null and hand_row.meeting_start is not null
        and abs(extract(epoch from (v_start - hand_row.meeting_start))) > 300
        and abs(extract(epoch from (v_start - hand_row.meeting_start))) <= 14 * 86400) then
      v_action := 'hand_entered_conflict_card';
      if not v_dry then
        v_card := _bk_task_card('booking_conflict:' || v_event || ':' || v_status || ':' || coalesce(v_start::text, ''),
          'Check ' || coalesce(pr.name, 'a booking') || '''s call time (you entered it by hand)' || chr(10) ||
          'You entered ' || to_char(hand_row.meeting_start at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC. ' ||
          initcap(v_source) || ' says ' || case when v_status = 'cancelled' then 'it was CANCELLED' else to_char(v_start at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC' end ||
          '. Nothing was changed; fix it by hand if that is right.',
          jsonb_build_object('client_id', v_client, 'meeting_id', hand_row.meeting_id, 'event_id', v_event, 'prospect_id', v_pid, 'kind_detail', 'booking_conflict'));
      end if;
    elsif v_start is null or hand_row.meeting_start is null or abs(extract(epoch from (v_start - hand_row.meeting_start))) <= 300 then
      v_action := 'same_as_hand_entered';
    end if;
    if v_action is not null then
      res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', hand_row.meeting_id, 'event_id', v_event, 'prospect_id', v_pid, 'card', v_card, 'dry_run', v_dry);
      insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
      values (v_client, v_source, v_event, v_status, v_action, v_pid, v_dry, p - 'attendees' || jsonb_build_object('result', res));
      return res;
    end if;
  end if;

  -- an event id we never stored, but the prospect has a live synced row at that start (Calendly cancel mails carry no id)
  if v_status = 'cancelled' or v_prev is not null then
    select * into same_row from booking_attributions b
     where b.client_id = v_client and b.prospect_id = v_pid
       and b.meeting_id not like 'manual-%' and coalesce(b.rationale, '') not ilike 'hand-entered%'
       and coalesce(b.meeting_outcome, '') not in ('CANCELED','CANCELLED')
       and b.meeting_start is not null
       and abs(extract(epoch from (b.meeting_start - coalesce(case when v_status = 'cancelled' then v_start end, v_prev)))) <= 300
     limit 1;
    if same_row.meeting_id is not null then
      v_action := case when v_status = 'cancelled' then 'cancelled_by_time' else 'rescheduled_by_previous' end;
      if not v_dry then
        if v_status = 'cancelled' then perform _bk_cancel_row(same_row.meeting_id, v_source);
        else
          update booking_attributions set meeting_start = v_start, meeting_outcome = 'SCHEDULED', updated_at = now(),
                 rationale = left(coalesce(rationale, '') || ' Rescheduled from ' || to_char(same_row.meeting_start at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC (' || v_source || ', new event ' || v_event || ').', 1400)
           where meeting_id = same_row.meeting_id;
        end if;
      end if;
      res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', same_row.meeting_id, 'event_id', v_event, 'prospect_id', v_pid, 'dry_run', v_dry);
      insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
      values (v_client, v_source, v_event, v_status, v_action, v_pid, v_dry, p - 'attendees' || jsonb_build_object('result', res));
      return res;
    end if;
  end if;

  if v_status = 'cancelled' then
    v_action := 'cancel_unknown_event';
    res := jsonb_build_object('ok', true, 'action', v_action, 'event_id', v_event, 'prospect_id', v_pid, 'dry_run', v_dry);
    insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
    values (v_client, v_source, v_event, v_status, v_action, v_pid, v_dry, p - 'attendees' || jsonb_build_object('result', res));
    return res;
  end if;

  select * into same_row from booking_attributions b
   where b.client_id = v_client
     and (b.prospect_id = v_pid or (b.prospect_id is null and v_bemail is not null and lower(b.booker_email) = v_bemail))
     and coalesce(b.meeting_outcome, '') not in ('CANCELED','CANCELLED')
     and v_start is not null and b.meeting_start is not null
     and abs(extract(epoch from (b.meeting_start - v_start))) <= extract(epoch from win)
   limit 1;
  if same_row.meeting_id is not null then
    v_action := 'same_meeting_other_source';
    res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', same_row.meeting_id, 'event_id', v_event, 'prospect_id', v_pid, 'dry_run', v_dry);
    insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
    values (v_client, v_source, v_event, v_status, v_action, v_pid, v_dry, p - 'attendees' || jsonb_build_object('result', res));
    return res;
  end if;

  -- ---------- 4. verdict (mirrors the HubSpot tracker, db/034 strength rule) ----------
  select min(coalesce(sent_at, created_at)) filter (where direction = 'outbound'),
         min(coalesce(sent_at, created_at)) filter (where direction = 'inbound'),
         bool_or(direction = 'inbound' or message_type in ('dm','inmail'))
    into first_out, first_in, open_channel
    from outreach_messages
   where prospect_id = v_pid and coalesce(sent_at, created_at) < v_booked
     and (direction = 'inbound' or sent_at is not null);
  select min(coalesce(sent_at, created_at)) into thread_start from outreach_messages
   where prospect_id = v_pid and (direction = 'inbound' or sent_at is not null);
  conn_at := case when pr.connection_sent_at < v_booked then pr.connection_sent_at end;
  select min(created_at) into eng_at from outreach_engagement_log where prospect_id = v_pid and success is true and created_at < v_booked;
  first_touch := least(conn_at, first_out, eng_at);
  first_what := case when first_touch is null then null when first_touch = conn_at then 'connection request'
                     when first_touch = first_out then 'outbound message' else 'engagement action' end;
  v_opened := case when first_out is not null and first_in is not null then (case when first_out < first_in then 'us' else 'them' end)
                   when first_out is not null then 'us' when first_in is not null then 'them' end;
  if first_touch is null and first_in is null then v_verdict := 'unattributed'; v_why := 'no_touch';
  elsif v_opened = 'them' then v_verdict := 'inbound_engaged';
  else v_verdict := 'engine_sourced'; end if;
  engage_start := coalesce(nullif((select value from integration_config where key = v_client || '_engagement_start'), '')::timestamptz,
                           case when v_client = 'arch' then '2026-08-13T00:00:00Z'::timestamptz else '2026-07-19T00:00:00Z'::timestamptz end);
  if v_verdict <> 'unattributed' and thread_start is not null and thread_start < engage_start then v_verdict := 'unattributed'; v_why := 'pre_engagement'; end if;
  v_strength := case when v_verdict = 'unattributed' then null when coalesce(open_channel, false) then 'proven' else 'inferred' end;

  v_rationale := case
    when v_hand then 'Hand-entered via the Ops card (' || v_source || '): Ivan booked this on the prospect''s own link and entered the time. '
    else 'Booking sync (' || v_source || '): ' end ||
    case
      when v_verdict = 'unattributed' and v_why = 'pre_engagement' then 'matched a ' || v_client || ' prospect on ' || v_ev || ' (' || v_val || '), but the thread predates the engagement - never claimed.'
      when v_verdict = 'unattributed' then 'matched a ' || v_client || ' prospect on ' || v_ev || ' (' || v_val || '), but no touch of ours preceded the booking, so it is not claimed.'
      when v_verdict = 'engine_sourced' then 'joined on ' || v_ev || ' (' || v_val || '); we moved first with our ' || coalesce(first_what, 'outreach') || coalesce(' on ' || to_char(first_touch at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC', '') || '.'
      else 'joined on ' || v_ev || ' (' || v_val || '); they opened the thread on ' || to_char(first_in at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC.'
    end || coalesce(' Ref: ' || v_raw, '');

  if v_dry then
    res := jsonb_build_object('ok', true, 'action', 'would_insert', 'meeting_id', v_event, 'prospect_id', v_pid, 'prospect', pr.name,
                              'verdict', v_verdict, 'strength', v_strength, 'evidence', v_ev, 'value', v_val,
                              'start_at', v_start, 'would_stamp', (v_verdict <> 'unattributed' and pr.call_booked_at is null), 'dry_run', true);
    insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
    values (v_client, v_source, v_event, v_status, 'would_insert', v_pid, true, p - 'attendees' || jsonb_build_object('result', res));
    return res;
  end if;

  if v_verdict <> 'unattributed' then
    update outreach_prospects set call_booked_at = v_booked where id = v_pid and call_booked_at is null;
    v_stamped := true;   -- the column ends up non-null either way (first booking wins)
  end if;

  insert into booking_attributions (meeting_id, client_id, slug, meeting_title, booked_at, meeting_start, meeting_outcome,
    booker_email, booker_name, booker_website, verdict, evidence_type, evidence_value, prospect_id, campaign_id, opened_by,
    rationale, replayed, prospect_stamped, evidence_strength, updated_at)
  values (v_event, v_client, null, coalesce(v_title, v_source || ' booking'), v_booked, v_start, 'SCHEDULED',
    v_bemail, v_bname, null, v_verdict,
    case when v_verdict <> 'unattributed' then v_ev end, case when v_verdict <> 'unattributed' then v_val end,
    case when v_verdict <> 'unattributed' then v_pid end, case when v_verdict <> 'unattributed' then v_cid end,
    case when v_verdict <> 'unattributed' then v_opened end,
    left(v_rationale, 1400), false, v_verdict <> 'unattributed' and v_stamped, v_strength, now());

  v_action := 'inserted';
  res := jsonb_build_object('ok', true, 'action', v_action, 'meeting_id', v_event, 'prospect_id', v_pid, 'prospect', pr.name,
                            'verdict', v_verdict, 'strength', v_strength, 'evidence', v_ev, 'start_at', v_start,
                            'stamped_now', (v_verdict <> 'unattributed' and pr.call_booked_at is null));
  insert into booking_sync_log (client_id, source, event_id, status, action, prospect_id, dry_run, detail)
  values (v_client, v_source, v_event, v_status, v_action, v_pid, false, p - 'attendees' || jsonb_build_object('result', res));
  return res;
end $$;

revoke all on function public.booking_ingest_event(jsonb) from public, anon, authenticated;
grant execute on function public.booking_ingest_event(jsonb) to service_role;
revoke all on function public.board_truth_flush() from public, anon, authenticated;
grant execute on function public.board_truth_flush() to service_role;

-- every minute: flush dirty boards (cheap no-op when nothing is dirty)
select cron.unschedule(jobid) from cron.job where jobname = 'board-truth-flush';
select cron.schedule('board-truth-flush', '* * * * *', 'select public.board_truth_flush()');
