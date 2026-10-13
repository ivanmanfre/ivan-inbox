-- db/270: plainer plan_ready alert wording. Title says "is ready" only when every post is written and waits
-- for your OK; otherwise "is planned". "N waits for you to start" becomes "N topic(s) need you to tap Generate draft"
-- (the button on a proposal card). A failed draft is mentioned only while its slot is still open: once the planner
-- refilled it, the alert said "2 failed" about posts already replaced (RISE week of 26 Oct). Nothing else changes.
-- Rollback = 270_plan_alert_wording_rollback.sql (the live body before this change).
CREATE OR REPLACE FUNCTION public.content_plan_ready_check(p_account text, p_week date, p_now timestamp with time zone DEFAULT now(), p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
declare
  led public.content_plan_alerts%rowtype; st jsonb; w jsonb; filled timestamptz;
  v_total int; v_written int; v_waiting int; v_unwritten int; v_proposal int; v_low int; v_failed int; v_open int;
  v_name text; v_label text; v_title text; v_body text; v_ideas text; v_payload jsonb; v_url text; v_secret text; v_req bigint; v_claimed int; v_had boolean;
begin
  if not public.content_plan_service_ok() then raise exception 'service only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('content-plan-ready:' || p_account || ':' || p_week::text, 0));

  select * into led from public.content_plan_alerts where account = p_account and week_start = p_week;
  v_had := found;
  if v_had and led.sent_at is not null then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
  -- Planned before db/265 and already full: never alerted. A seed marked "open places" may alert once, when the week is full (below).
  if v_had and led.note is not null and led.note not like '%open places' then return jsonb_build_object('fire', false, 'why', 'planned before the alert existed'); end if;
  -- Nothing to plan: no run for this week ever picked anything. A run with picked = 0 (or one with no target week) is not a plan.
  if not exists (select 1 from public.content_plan_runs r where r.account = p_account and r.target_week = p_week and r.picked > 0) then
    return jsonb_build_object('fire', false, 'why', 'nothing planned');
  end if;
  if not v_had then
    if not p_dry then
      insert into public.content_plan_alerts(account, week_start, filled_at) values (p_account, p_week, p_now)
        on conflict (account, week_start) do nothing;
      select * into led from public.content_plan_alerts where account = p_account and week_start = p_week;
      if led.sent_at is not null then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
    end if;
    filled := p_now;
  else
    filled := led.filled_at;
  end if;

  st := public.content_plan_week(p_account, p_now);
  select x into w from jsonb_array_elements(st->'weeks') x where x->>'start' = p_week::text;
  if w is null then return jsonb_build_object('fire', false, 'why', 'week not in view'); end if;

  with it as (
    select 'post' as src, x->>'status' as status, coalesce((x #>> '{brain,flags,low_score}')::boolean, false) as low from jsonb_array_elements(w->'posts') x
    union all
    select 'planned', x->>'status', coalesce((x #>> '{brain,flags,low_score}')::boolean, false) from jsonb_array_elements(w->'planned') x)
  select count(*),
         count(*) filter (where src = 'post' or status = 'waiting_review'),
         count(*) filter (where (src = 'post' and status = 'review') or (src = 'planned' and status = 'waiting_review')),
         count(*) filter (where src = 'planned' and status in ('planned','requested','drafting')),
         count(*) filter (where src = 'planned' and status = 'proposal'),
         count(*) filter (where low and ((src = 'post' and status = 'review') or (src = 'planned' and status = 'waiting_review')))
    into v_total, v_written, v_waiting, v_unwritten, v_proposal, v_low from it;
  if v_total = 0 then return jsonb_build_object('fire', false, 'why', 'nothing in the week'); end if;
  v_open := coalesce((w->>'open')::int, 0);

  -- A week seeded with open places: quiet until the planner fills it, then it is judged like any new week (6 h clock starts now).
  if v_had and led.note is not null then
    if v_open > 0 then return jsonb_build_object('fire', false, 'why', 'planned before the alert existed, still has open places', 'open', v_open); end if;
    filled := p_now;
    if not p_dry then update public.content_plan_alerts set note = null, filled_at = p_now where account = p_account and week_start = p_week; end if;
  end if;

  -- Wait for the drafts (or for the planner to finish filling the week), but never longer than 6 hours from first seen filled.
  if (v_unwritten > 0 or v_open > 0) and p_now < filled + interval '6 hours' then
    return jsonb_build_object('fire', false, 'why', 'drafts still being written', 'unwritten', v_unwritten, 'open', v_open, 'filled_at', filled);
  end if;

  select count(*) into v_failed from public.content_plan_slots s join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
   where s.account = p_account and s.week_start = p_week and s.status in ('planned','proposal','requested') and ci.status in ('approved','live')
     and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
     and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));

  -- db/270: a failed draft whose slot the planner already refilled (the week has no open slot) is not news.
  if v_open = 0 then v_failed := 0; end if;

  v_name := case p_account when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end;
  v_label := to_char(p_week, 'FMDD Mon');
  v_title := v_name || ' · week of ' || v_label || ' is planned';
  if v_unwritten = 0 and v_proposal = 0 and v_low = 0 and v_failed = 0 and v_written = v_waiting and v_written > 0 then
    v_title := v_name || ' · week of ' || v_label || ' is ready';
    v_body := v_written || case when v_written = 1 then ' post written and checked. It waits' else ' posts written and checked. They wait' end || ' for your OK.';
  else
    v_body := case when v_written = 0 then 'No post is written yet.'
                   else v_written || ' written, ' || case when v_waiting = 0 then 'none wait' when v_waiting = 1 then '1 waits' else v_waiting || ' wait' end || ' for your OK.' end;
    if v_unwritten > 0 then v_body := v_body || ' ' || v_unwritten || case when v_unwritten = 1 then ' is' else ' are' end || ' still being written.'; end if;
    if v_proposal > 0 then v_body := v_body || ' ' || v_proposal || case when v_proposal = 1 then ' topic needs' else ' topics need' end || ' you to tap Generate draft.'; end if;
    if v_low > 0 then v_body := v_body || ' ' || v_low || case when v_low = 1 then ' has' else ' have' end || ' a low score.'; end if;
    if v_failed > 0 then v_body := v_body || ' ' || v_failed || case when v_failed = 1 then ' draft' else ' drafts' end || ' failed the quality check. The planner is picking new topics.'; end if;
  end if;
  select string_agg(regexp_replace(regexp_replace(x->>'text', '^Out of ideas for ', ''), ' \(.*\)$', ''), ' and ') into v_ideas
    from jsonb_array_elements(st->'warnings') x where x->>'code' = 'empty_topic_area' and x->>'text' like 'Out of ideas for %';
  if v_ideas is not null then v_body := v_body || ' Out of ideas for ' || v_ideas || '.'; end if;

  v_payload := jsonb_build_object('family', 'content_plan', 'source', 'content-plan', 'dedupe_key', 'plan-ready:' || p_account || ':' || p_week::text,
    'severity', 'info', 'title', v_title, 'body', v_body, 'url', './#exp/d/content/plan?lane=' || p_account,
    'media', jsonb_build_object('kind', 'plan_ready', 'account', p_account, 'week', p_week), 'push', true);
  if p_dry then return jsonb_build_object('fire', true, 'dry', true, 'payload', v_payload); end if;

  -- One sender: the row is claimed before the post, so a second caller (apply and sweep together) finds it sent.
  update public.content_plan_alerts set sent_at = p_now, payload = v_payload where account = p_account and week_start = p_week and sent_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return jsonb_build_object('fire', false, 'why', 'already sent'); end if;
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
           body := v_payload, timeout_milliseconds := 30000) into v_req;
  update public.content_plan_alerts set request_id = v_req where account = p_account and week_start = p_week;
  return jsonb_build_object('fire', true, 'payload', v_payload);
end $function$;
