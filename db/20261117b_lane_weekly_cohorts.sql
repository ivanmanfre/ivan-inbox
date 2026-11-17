-- Lanes: the "by targeting change" rows become weekly rows. Periods defined by
-- changes went stale as time moved on (the newest period only grew), so each
-- row is now one Europe/Warsaw week, Monday to Sunday, for the current week and
-- the 7 before it. Same function, same return columns, same operator check;
-- only the body changes. Additive and read-only.
--
-- A recorded targeting change (integration_config key 'lane_adjustments', a
-- JSON array of {"client_id","effective_on":"YYYY-MM-DD","label"}) is no longer
-- a period boundary: it is a note on the week it took effect, returned in
-- `label` as "Label (5 Nov)", several joined by "; ". A week with none has ''.
--
-- Acceptance counts invites that have had 72 hours; replies count invites that
-- have had 168 hours (7 days, in elapsed hours so a clock change never moves
-- the window). Younger invites stay out of both rates and are returned as raw
-- counts. Reactions, vendor pitches and auto-replies are not replies. Only
-- clients with an invite in the 8 weeks are returned; a week with no invite
-- returns zeros.
create or replace function public.inbox_lane_adjustment_cohorts()
returns table(client_id text, period_from date, period_to date, label text,
  invites bigint, accept_base bigint, accepted bigint, reply_base bigint,
  replied bigint, replied_so_far bigint, calls bigint)
language plpgsql stable security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare
  as_of timestamptz := statement_timestamp();
  this_monday date;
  marks jsonb;
  good jsonb := '[]'::jsonb;
  e jsonb;
  d date;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode='42501'; end if;
  this_monday := date_trunc('week', (as_of at time zone 'Europe/Warsaw'))::date;
  begin
    select c.value::jsonb into marks from public.integration_config c where c.key='lane_adjustments';
  exception when others then marks := null;
  end;
  -- One entry at a time: a malformed entry (not an object, blank client or
  -- label, a date that does not exist) is left out and never fails the read.
  -- No readable list means weeks without notes, never an empty answer.
  if marks is not null and jsonb_typeof(marks) = 'array' then
    for e in select t.x from jsonb_array_elements(marks) t(x) loop
      begin
        if jsonb_typeof(e) = 'object'
          and btrim(coalesce(e->>'client_id','')) <> ''
          and btrim(coalesce(e->>'label','')) <> ''
          and (e->>'effective_on') ~ '^\d{4}-\d{2}-\d{2}$' then
          d := (e->>'effective_on')::date;
          good := good || jsonb_build_object('client_id', btrim(e->>'client_id'),
            'label', btrim(e->>'label'), 'd', d);
        end if;
      exception when others then null;
      end;
    end loop;
  end if;
  return query
  with wk as (
    select (this_monday - 7 * g.n) d0, (this_monday - 7 * g.n + 7) d1
    from generate_series(0, 7) g(n)
  ), b as (
    select w.d0, w.d1,
      w.d0::timestamp at time zone 'Europe/Warsaw' t0,
      w.d1::timestamp at time zone 'Europe/Warsaw' t1
    from wk w
  ), inv as materialized (
    select coalesce(c.client_id,'ivan') client_id, o.id, o.connection_sent_at s,
      o.connected_at a, o.call_booked_at k
    from public.outreach_prospects o
    join public.outreach_campaigns c on c.id=o.campaign_id
    where o.connection_sent_at >= (select min(b.t0) from b)
      and o.connection_sent_at <= as_of
  ), fr as (
    select g.prospect_id, min(g.sent_at) r
    from public.outreach_messages g
    join inv on inv.id=g.prospect_id
    where g.direction='inbound' and coalesce(g.is_reaction,false)=false
      and g.reply_intent is distinct from 'vendor_pitch'
      and g.reply_intent is distinct from 'auto_reply'
      and g.sent_at >= inv.s
    group by g.prospect_id
  ), cl as (
    select distinct i.client_id from inv i
  ), note as (
    select m.client_id, b.d0,
      string_agg(m.label || ' (' || to_char(m.d, 'FMDD Mon') || ')', '; ' order by m.d, m.label) txt
    from (select distinct g.client_id, g.label, g.d
          from jsonb_to_recordset(good) as g(client_id text, label text, d date)) m
    join b on m.d >= b.d0 and m.d < b.d1
    -- A change dated later this week has not taken effect yet.
    where m.d <= (as_of at time zone 'Europe/Warsaw')::date
    group by m.client_id, b.d0
  )
  select cl.client_id, b.d0, (b.d1 - 1), coalesce(n.txt, ''),
    count(i.id),
    count(i.id) filter (where i.s <= as_of - interval '72 hours'),
    count(i.id) filter (where i.s <= as_of - interval '72 hours'
      and i.a >= i.s and i.a <= i.s + interval '72 hours'),
    count(i.id) filter (where i.s <= as_of - interval '168 hours'),
    count(i.id) filter (where i.s <= as_of - interval '168 hours'
      and fr.r <= i.s + interval '168 hours'),
    count(i.id) filter (where fr.r is not null),
    count(i.id) filter (where i.k is not null)
  from cl
  cross join b
  left join inv i on i.client_id=cl.client_id and i.s >= b.t0 and i.s < b.t1
  left join fr on fr.prospect_id=i.id
  left join note n on n.client_id=cl.client_id and n.d0=b.d0
  group by cl.client_id, b.d0, b.d1, n.txt
  order by cl.client_id, b.d0;
end $$;
revoke all on function public.inbox_lane_adjustment_cohorts() from public, anon;
grant execute on function public.inbox_lane_adjustment_cohorts() to authenticated, service_role;
