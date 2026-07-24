-- Normalized per-person governor. Both people use the client-parameterized
-- adaptive weekly governor (outreach_sender_health). accept_rate is returned as a
-- fraction by the RPC -> multiply by 100 for a percent. Rise also carries its
-- monthly ceiling from the key/value integration_config table.
-- See db/NOTES-kpi-verification.md (SENDER_HEALTH_FIELDS, MONTHLY_CAP).
create or replace function inbox_governor()
returns table (
  client_id text, model text, cap int, used int, window_label text, mode text,
  daily_used int, daily_cap int, accept_rate numeric, headroom_week int, headroom_day int,
  monthly_cap int, monthly_used int
) language plpgsql security definer as $$
declare h jsonb; today_ct int; mtd int;
begin
  -- ---- Ivan ----
  select to_jsonb(x) into h from outreach_sender_health() x;
  select count(*) into today_ct from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id
    join outreach_campaigns c on c.id=p.campaign_id
    where coalesce(c.client_id,'ivan')='ivan' and m.direction='outbound'
      and m.message_type='connection_note' and m.sent_at >= date_trunc('day', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;
  client_id := 'ivan'; model := 'weekly_adaptive';
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'cohort')::int,0) > 0
                    and coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct; daily_cap := 20;
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(20 - today_ct, 0);
  monthly_cap := null; monthly_used := null; return next;

  -- ---- Rise ----
  select to_jsonb(x) into h from outreach_sender_health(p_client_id => 'risedtc') x;
  select count(*) into today_ct from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('day', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;
  select count(*) into mtd from (
    select distinct on (m.prospect_id, m.message_text, m.sent_at) m.id
    from outreach_messages m
    join outreach_prospects p on p.id=m.prospect_id join outreach_campaigns c on c.id=p.campaign_id
    where c.client_id='risedtc' and m.direction='outbound' and m.message_type='connection_note'
      and m.sent_at >= date_trunc('month', now())
    order by m.prospect_id, m.message_text, m.sent_at, m.id
  ) d;
  client_id := 'risedtc'; model := 'weekly_adaptive';
  cap := coalesce((h->>'cap')::int,35); used := coalesce((h->>'weekly_sends')::int,0);
  window_label := 'week';
  mode := case when (h->>'warm_only')::boolean then 'warm_only'
               when coalesce((h->>'cohort')::int,0) > 0
                    and coalesce((h->>'accept_rate')::numeric,1) < 0.12 then 'cold_paused'
               else 'normal' end;
  daily_used := today_ct;
  daily_cap := coalesce((select value::int from integration_config where key='risedtc_connect_daily_cap'),20);
  accept_rate := round(coalesce((h->>'accept_rate')::numeric,0) * 100, 1);
  headroom_week := greatest(cap - used, 0); headroom_day := greatest(daily_cap - today_ct, 0);
  monthly_cap := coalesce((select value::int from integration_config where key='risedtc_connect_monthly_cap'),400);
  monthly_used := mtd; return next;
end $$;

grant execute on function inbox_governor() to anon, authenticated;
