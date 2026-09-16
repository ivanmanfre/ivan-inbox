-- 069: outreach_perf_payload: per-lane DM performance for the Strategy "Outreach" view and the
-- weekly WhatsApp digest. Spec: docs/superpowers/specs/2026-09-16-outreach-performance-alerts-design.md
-- Counts only DM/InMail sends (never connection notes), matured 7 days, active campaigns only.
-- Ivan 2026-09-16: "only show active lanes and dm sends". Alert only, never an action.

create or replace function perf_wilson_upper(k bigint, n bigint) returns numeric
language sql immutable as $$
  select case when n = 0 then 0 else
    ((k::numeric / n) + (1.2816^2) / (2 * n)
      + 1.2816 * sqrt(((k::numeric / n) * (1 - k::numeric / n)) / n + (1.2816^2) / (4 * n::numeric * n)))
    / (1 + (1.2816^2) / n) end
$$;

create or replace function outreach_perf_payload(p_client_id text, p_days int default 90)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_mature timestamptz := now() - interval '7 days';
  v_cur_from timestamptz := now() - interval '21 days';
  v_base_from timestamptz := now() - interval '81 days';
  v_table_from timestamptz := now() - make_interval(days => greatest(p_days, 21));
  v_floor int := 30;
  v_child_floor int := 15;
  v_lanes jsonb;
  v_threaded bigint;
  v_stamp bigint;
begin
  drop table if exists perf_sends; drop table if exists perf_scored;
  create temp table perf_sends on commit drop as
  select m.id, m.prospect_id, m.sent_at, coalesce(m.ai_model, 'unknown') as variant,
         case when m.channel = 'linkedin_inmail' then 'inmail'
              when coalesce(m.sequence_step, 1) <= 1 then 'dm1'
              when m.sequence_step = 2 then 'nudge'
              else 'dm3' end as step,
         lane_of(c.name) as lane, c.name as campaign,
         coalesce(pr.enrichment_data->>'source', pr.enrichment_data->>'source_kind', pr.enrichment_data->>'seed', 'unknown') as source,
         coalesce(nullif(pr.country, ''), 'unknown') as country,
         coalesce(pr.enrichment_data->'gate'->>'vertical', pr.enrichment_data->>'vertical', 'unknown') as vertical,
         pr.last_reply_at
  from outreach_messages m
  join outreach_prospects pr on pr.id = m.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  where m.direction = 'outbound'
    and m.sent_at is not null and m.sent_at >= v_table_from and m.sent_at <= v_mature
    and m.message_type in ('dm', 'inmail')
    and coalesce(m.ai_model, '') <> 'manual_mirror'
    and c.is_active and not coalesce(c.archived, false)
    and case when p_client_id = 'ivan' then c.client_id is null else c.client_id = p_client_id end;

  create temp table perf_scored on commit drop as
  select s.*,
    exists (select 1 from outreach_messages r where r.replies_to_message_id = s.id
              and r.direction = 'inbound' and not coalesce(r.is_reaction, false)) as threaded,
    (s.last_reply_at is not null and s.last_reply_at > s.sent_at
      and not exists (select 1 from perf_sends s2 where s2.prospect_id = s.prospect_id
                        and s2.sent_at > s.sent_at and s2.sent_at < s.last_reply_at)) as stamp_hit,
    (select r.reply_intent from outreach_messages r where r.replies_to_message_id = s.id
       and r.direction = 'inbound' and not coalesce(r.is_reaction, false)
       order by r.sent_at limit 1) as intent,
    (s.sent_at >= v_cur_from) as cur,
    (s.sent_at >= v_base_from and s.sent_at < v_cur_from) as base
  from perf_sends s;

  select count(*) filter (where threaded), count(*) filter (where stamp_hit and not threaded)
    into v_threaded, v_stamp from perf_scored;

  with cells as (
    select lane, step,
      count(*) filter (where cur) as n,
      count(*) filter (where cur and (threaded or stamp_hit)) as replies,
      count(*) filter (where cur and intent = 'positive') as positive_n,
      bool_or(cur and intent is not null) as has_intent,
      count(*) filter (where base) as base_n,
      count(*) filter (where base and (threaded or stamp_hit)) as base_replies
    from perf_scored group by lane, step
  ),
  variants as (
    select lane, step, variant,
      count(*) filter (where cur) as n,
      count(*) filter (where cur and (threaded or stamp_hit)) as replies
    from perf_scored group by lane, step, variant
  ),
  splits as (
    select lane, step, dim, value, count(*) as n, count(*) filter (where threaded or stamp_hit) as replies
    from perf_scored, lateral (values ('source', source), ('variant', variant), ('country', country), ('vertical', vertical)) d(dim, value)
    where cur group by lane, step, dim, value
  ),
  tbl as (
    select lane, step, variant, source, country, vertical, count(*) as n,
      count(*) filter (where threaded or stamp_hit) as replies
    from perf_scored group by lane, step, variant, source, country, vertical
  ),
  lanes as (select distinct lane from perf_scored)
  select coalesce(jsonb_agg(jsonb_build_object(
    'lane', l.lane,
    'campaigns', (select coalesce(jsonb_agg(distinct campaign), '[]'::jsonb) from perf_sends where lane = l.lane),
    'cells', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', c.step, 'n', c.n, 'replies', c.replies,
        'rate', case when c.n = 0 then 0 else round(c.replies::numeric / c.n, 4) end,
        'positive_n', c.positive_n,
        'positive_rate', case when c.has_intent and c.n > 0 then round(c.positive_n::numeric / c.n, 4) else null end,
        'base_n', c.base_n, 'base_replies', c.base_replies,
        'base_rate', case when c.base_n = 0 then 0 else round(c.base_replies::numeric / c.base_n, 4) end,
        'status', case when c.n < v_floor or c.base_n < v_floor then 'thin' else 'ok' end
      ) order by c.step), '[]'::jsonb) from cells c where c.lane = l.lane),
    'variants', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', v.step, 'variant', v.variant, 'n', v.n, 'replies', v.replies,
        'rate', case when v.n = 0 then 0 else round(v.replies::numeric / v.n, 4) end,
        'others_n', o.n, 'others_rate', case when o.n = 0 then 0 else round(o.replies::numeric / o.n, 4) end,
        'status', case when v.n < v_floor or o.n < v_floor then 'thin' else 'ok' end
      ) order by v.step, v.n desc), '[]'::jsonb)
      from variants v
      cross join lateral (select coalesce(sum(n), 0) as n, coalesce(sum(replies), 0) as replies
                          from variants w where w.lane = v.lane and w.step = v.step and w.variant <> v.variant) o
      where v.lane = l.lane and v.n > 0),
    'splits', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', s.step, 'dim', s.dim, 'value', s.value, 'n', s.n, 'replies', s.replies,
        'rate', round(s.replies::numeric / s.n, 4)) order by s.step, s.dim, s.n desc), '[]'::jsonb)
      from splits s where s.lane = l.lane),
    'alarms', '[]'::jsonb,
    'table', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', t.step, 'variant', t.variant, 'source', t.source, 'country', t.country, 'vertical', t.vertical,
        'n', t.n, 'replies', t.replies, 'rate', round(t.replies::numeric / t.n, 4)) order by t.step, t.n desc), '[]'::jsonb)
      from tbl t where t.lane = l.lane)
  ) order by l.lane), '[]'::jsonb)
  into v_lanes from lanes l;

  return jsonb_build_object(
    'ok', true, 'client_id', p_client_id, 'days', p_days, 'generated_at', now(),
    'mature_before', v_mature, 'cur_from', v_cur_from, 'base_from', v_base_from,
    'floor', v_floor, 'child_floor', v_child_floor,
    'lanes', v_lanes,
    'reply_basis', jsonb_build_object('threaded', v_threaded, 'stamp_only', v_stamp));
end $$;

revoke all on function outreach_perf_payload(text, int) from public, anon;
grant execute on function outreach_perf_payload(text, int) to authenticated, service_role;
revoke all on function perf_wilson_upper(bigint, bigint) from public, anon;
grant execute on function perf_wilson_upper(bigint, bigint) to authenticated, service_role;
