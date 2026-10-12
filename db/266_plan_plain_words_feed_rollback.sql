-- db/266 rollback: restores the exact live bodies captured with pg_get_functiondef on 2026-10-13, before the plain-words change.
begin;
CREATE OR REPLACE FUNCTION public.brain_monday_line(p_now timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
AS $function$
declare since timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'; base text; parts text[] := '{}';
        x record; n int := 0; held text; n_held int;
begin
  select value into base from public.integration_config where key = 'brain_undo_url';
  for x in
    select e.id, e.rule_id, e.kind, e.from_status, e.to_status, e.consumer_ref, e.after_value, e.undo_token,
           exists (select 1 from public.brain_rule_events b where b.reverts_event_id = e.id and b.kind = 'rollback') undone
      from public.brain_rule_events e
     where e.created_at >= since and e.created_at <= p_now and e.kind in ('apply','transition')
     order by e.created_at
  loop
    if x.rule_id like 'zz-%' and x.undone then continue; end if;  -- an undone self-test leaves no line
    n := n + 1;
    if n > 3 then continue; end if;
    parts := parts || (x.rule_id || ': ' ||
      case when x.kind = 'apply' then coalesce(x.consumer_ref ->> 'key', x.consumer_ref ->> 'code', 'consumer') || ' set to ' || (x.after_value -> 'value')::text
           else x.from_status || ' to ' || x.to_status end ||
      case when x.undone then ' (undone)'
           when x.undo_token is not null and base is not null then ' Undo: ' || base || '?t=' || x.undo_token
           else '' end);
  end loop;
  select count(*), string_agg(rule_id || ' (' || replace(kind, '_', ' ') || ')', ', ' order by created_at)
    into n_held, held
    from (select rule_id, kind, created_at from public.brain_rule_proposals
           where state = 'open' and created_at >= since and created_at <= p_now and rule_id not like 'zz-%'
           order by created_at limit 5) h;
  if n = 0 and coalesce(n_held, 0) = 0 then return 'Brain: nothing changed this month.'; end if;
  return case when n = 0 then 'Brain: nothing changed this month'
              else 'Brain this month: ' || array_to_string(parts, '; ') || case when n > 3 then '; and ' || (n - 3) || ' more' else '' end end
         || case when coalesce(n_held, 0) > 0 then '. Held back, not applied: ' || held else '' end || '.';
end $function$
;

CREATE OR REPLACE FUNCTION public.content_plan_monday_lines(p_now timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '12s'
AS $function$
declare a text; st jsonb; line text; out text := ''; w jsonb;
begin
  foreach a in array array['ivan','risedtc','arch'] loop
    begin
      st := public.content_plan_week(a, p_now);
      line := case a when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end || ': ';
      if st->>'state' = 'two_weeks_planned' then
        line := line || 'next 2 weeks planned';
      else
        select x into w from jsonb_array_elements(st->'weeks') x where x->>'start' = st->>'target_week';
        line := line || 'week of ' || to_char((st->>'target_week')::date,'FMDD Mon') || ' ' || (w->>'filled') || ' of ' || (w->>'target') || ' planned'
          || case when (st->>'proposals_only')::boolean and jsonb_array_length(w->'planned') > 0 then ', ' || jsonb_array_length(w->'planned') || ' as proposals' else '' end;
      end if;
      if jsonb_array_length(st->'warnings') > 0 then
        line := line || '. ' || (select string_agg(x->>'text', '; ') from jsonb_array_elements(st->'warnings') x);
      end if;
    exception when others then line := case a when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end || ': plan could not be read';
    end;
    out := out || case when out = '' then '' else E'\n' end || line;
  end loop;
  return out;
end $function$
;

commit;
