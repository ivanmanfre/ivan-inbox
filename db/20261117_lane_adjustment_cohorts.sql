-- Lanes: acceptance, replies and calls grouped by the targeting change that was
-- live when the invite went out. Additive and read-only: one operator RPC. No
-- table, view, workflow or policy is added or changed.
--
-- The dated changes are one settings value, written by the operator and never
-- by the app: integration_config key 'lane_adjustments', a JSON array of
--   {"client_id": "...", "effective_on": "YYYY-MM-DD", "label": "..."}
-- A missing or unreadable value returns no rows.
--
-- One row per recorded change, per client. A period starts on its change date
-- (Europe/Warsaw) and ends the day before the next one; the newest is open.
-- Acceptance counts invites that have had 72 hours; replies count invites that
-- have had 7 days. Younger invites stay out of both rates and are returned as
-- raw counts. Reactions, vendor pitches and auto-replies are not replies.
create or replace function public.inbox_lane_adjustment_cohorts()
returns table(client_id text, period_from date, period_to date, label text,
  invites bigint, accept_base bigint, accepted bigint, reply_base bigint,
  replied bigint, replied_so_far bigint, calls bigint)
language plpgsql stable security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare
  as_of timestamptz := statement_timestamp();
  marks jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.outreach_agent_accounts a
    where a.client_id='ivan' and auth.uid()=any(a.operator_ids)
  ) then raise exception 'operator_denied' using errcode='42501'; end if;
  begin
    select c.value::jsonb into marks from public.integration_config c where c.key='lane_adjustments';
  exception when others then marks := null;
  end;
  if marks is null or jsonb_typeof(marks) <> 'array' then return; end if;
  return query
  with raw as (
    select btrim(e->>'client_id') client_id, btrim(e->>'label') label, e->>'effective_on' as eff
    from jsonb_array_elements(marks) e
  ), ok as (
    -- A malformed entry is left out; it never fails the whole read.
    select distinct on (r.client_id, r.eff) r.client_id, r.label, r.eff::date effective_on
    from raw r
    where r.client_id <> '' and r.label <> '' and r.eff ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
      and to_char(to_date(r.eff,'YYYY-MM-DD'),'YYYY-MM-DD') = r.eff
    order by r.client_id, r.eff
  ), per as (
    select m.client_id, m.label, m.effective_on d0,
      lead(m.effective_on) over (partition by m.client_id order by m.effective_on) d1
    from ok m
  ), b as (
    select p.client_id, p.label, p.d0, p.d1,
      p.d0::timestamp at time zone 'Europe/Warsaw' t0,
      coalesce(p.d1::timestamp at time zone 'Europe/Warsaw', 'infinity'::timestamptz) t1
    from per p
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
  )
  select b.client_id, b.d0, (b.d1 - 1), b.label,
    count(i.id),
    count(i.id) filter (where i.s <= as_of - interval '72 hours'),
    count(i.id) filter (where i.s <= as_of - interval '72 hours'
      and i.a >= i.s and i.a <= i.s + interval '72 hours'),
    count(i.id) filter (where i.s <= as_of - interval '7 days'),
    count(i.id) filter (where i.s <= as_of - interval '7 days'
      and fr.r <= i.s + interval '7 days'),
    count(i.id) filter (where fr.r is not null),
    count(i.id) filter (where i.k is not null)
  from b
  left join inv i on i.client_id=b.client_id and i.s >= b.t0 and i.s < b.t1
  left join fr on fr.prospect_id=i.id
  group by b.client_id, b.d0, b.d1, b.label
  order by b.client_id, b.d0;
end $$;
revoke all on function public.inbox_lane_adjustment_cohorts() from public, anon;
grant execute on function public.inbox_lane_adjustment_cohorts() to authenticated, service_role;
