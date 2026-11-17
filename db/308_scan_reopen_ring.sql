-- 308 open tracking truth, part 6: ring the owner on a second-day human reopen (Ivan and RISE lanes). Plan Task 9.
-- BUILT AND LEFT OFF: it rings only when integration_config scan_reopen_ring = 'on'. This file never creates that row.
-- Only scan_open_finalize, on the first label of a fresh row (the scan-open edge function), can reach the ring.

create table if not exists public.scan_reopen_rings (
  slug text not null,
  day date not null,
  prospect_id uuid not null,
  lane text not null,
  open_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (slug, day)
);
alter table public.scan_reopen_rings enable row level security;
revoke all on public.scan_reopen_rings from anon, authenticated;
grant all on public.scan_reopen_rings to service_role;

-- Returns true when it posted. Every condition below must hold (plan Task 9, Interfaces 1-7).
create or replace function public.scan_reopen_ring_step(p_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.scan_opens;
  v_slug text; v_slug_re text; v_day date; v_pid uuid; v_lane text; v_n int; v_first_link timestamptz;
  v_first_open timestamptz; v_days int; v_name text; v_company text; v_url text; v_secret text; v_title text;
begin
  select * into r from public.scan_opens where id = p_id;
  if not found or not public.open_may_ring(r.open_class, r.class_reason) or r.opened_at <= now() - interval '10 minutes' then return false; end if;
  if coalesce((select value from public.integration_config where key = 'scan_reopen_ring'), '') <> 'on' then return false; end if;
  v_slug := lower(r.company_slug);
  v_slug_re := regexp_replace(v_slug, '([^a-z0-9_-])', '\\\1', 'g');
  v_day := (r.opened_at at time zone 'UTC')::date;
  -- 3. exactly one prospect got this scan link, in an Ivan (client_id null) or RISE campaign
  select count(distinct m.prospect_id), min(m.prospect_id::text)::uuid,
         min(case when c.client_id is null then 'ivan' else c.client_id end), min(m.sent_at)
    into v_n, v_pid, v_lane, v_first_link
    from public.outreach_messages m
    join public.outreach_prospects p on p.id = m.prospect_id
    join public.outreach_campaigns c on c.id = p.campaign_id
   where m.direction = 'outbound' and m.sent_at is not null
     and lower(m.message_text) ~ ('/scan/' || v_slug_re || '([^a-z0-9_-]|$)')
     and (c.client_id is null or c.client_id = 'risedtc');
  if v_n <> 1 or v_lane not in ('ivan', 'risedtc') then return false; end if;
  -- 4. an earlier human open on an earlier UTC date
  if not exists (select 1 from public.scan_opens o
                  where lower(o.company_slug) = v_slug and public.open_is_signal(o.open_class, o.class_reason) and o.id <> r.id
                    and (o.opened_at at time zone 'UTC')::date < v_day) then return false; end if;
  -- 5. no real reply since the first link, no call booked
  if exists (select 1 from public.outreach_messages i
              where i.prospect_id = v_pid and i.direction = 'inbound' and coalesce(i.is_reaction, false) = false
                and i.created_at > v_first_link) then return false; end if;
  select p.name, p.company into v_name, v_company from public.outreach_prospects p where p.id = v_pid and p.call_booked_at is null;
  if not found then return false; end if;
  -- 7. at most 3 rings per lane per UTC day (serialised per lane and day), 6. one per slug per day
  perform pg_advisory_xact_lock(hashtextextended('scan_reopen:' || v_lane || ':' || v_day::text, 0));
  if (select count(*) from public.scan_reopen_rings where lane = v_lane and day = v_day) >= 3 then return false; end if;
  insert into public.scan_reopen_rings (slug, day, prospect_id, lane, open_id) values (v_slug, v_day, v_pid, v_lane, p_id)
  on conflict (slug, day) do nothing;
  if not found then return false; end if;
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if v_url is null or v_secret is null then raise exception 'inbox notify not configured'; end if;
  select min(o.opened_at), count(distinct (o.opened_at at time zone 'UTC')::date) into v_first_open, v_days
    from public.scan_opens o where lower(o.company_slug) = v_slug and public.open_is_signal(o.open_class, o.class_reason);
  v_title := case when r.view = 'team' then format('%s''s team page was opened', coalesce(v_name, 'A prospect'))
                  else format('%s reopened the scan', coalesce(v_name, 'A prospect')) end;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
    body := jsonb_build_object('family', 'page_open_notice', 'source', 'db:scan_reopen',
      'dedupe_key', 'scan_reopen:' || v_slug || ':' || v_day::text,
      'severity', 'attention',
      'title', left(v_title, 200),
      'body', left(format('%s (%s) opened the scan again today. First opened %s, %s days with an open. No reply since the link went out on %s. Nothing was sent to them.',
               coalesce(v_name, '?'), coalesce(v_company, '?'),
               to_char(v_first_open at time zone 'UTC', 'FMDD Mon'), v_days,
               to_char(v_first_link at time zone 'UTC', 'FMDD Mon')), 4000),
      'media', jsonb_build_object('kind', 'scan_reopen', 'lane', v_lane, 'prospect_id', v_pid, 'slug', v_slug),
      'push', true),
    timeout_milliseconds := 30000);
  return true;
end $$;
revoke all on function public.scan_reopen_ring_step(bigint) from public, anon, authenticated;
grant execute on function public.scan_reopen_ring_step(bigint) to service_role;

-- scan_open_finalize = the 304 body plus the ring step at the end.
-- Round 2 (finding 2): only the row's FIRST label can ring. scan_open_label locks the row and reports first_label =
-- nothing (no finalize, no relabel, no backfill) ever labelled it, so a second finalize, a relabelled row or a
-- backfilled row never rings, whatever its age. The 10-minute fence stays as a second guard. A person whose network
-- is unknown, or who sits on the scanner network with no behaviour behind it, never rings (open_may_ring).
create or replace function public.scan_open_finalize(p_id bigint, p_asn int, p_org text, p_country text, p_city text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l record; v_ring boolean := false;
begin
  select * into l from public.scan_open_label(p_id, p_asn, p_org, p_country, p_city);
  if l.open_class is null then
    return jsonb_build_object('open_class', null, 'class_reason', 'no_row', 'ring', false);
  end if;
  -- Own block: a ring failure never fails the open (and leaves no ledger row).
  if l.first_label and public.open_may_ring(l.open_class, l.class_reason) and l.opened_at > now() - interval '10 minutes' then
    begin
      v_ring := public.scan_reopen_ring_step(p_id);
    exception when others then
      raise warning 'scan_open_finalize ring failed: %', sqlerrm;
      v_ring := false;
    end;
  end if;
  return jsonb_build_object('open_class', l.open_class, 'class_reason', l.class_reason, 'ring', v_ring);
end $$;

revoke all on function public.scan_open_finalize(bigint, int, text, text, text) from public, anon, authenticated;
grant execute on function public.scan_open_finalize(bigint, int, text, text, text) to service_role;
