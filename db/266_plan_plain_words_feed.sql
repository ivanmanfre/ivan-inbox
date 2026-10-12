-- db/266: Monday card plan lines, brain line and rule-change feed in plain words (plan-tab Oxygen, Task 12, spec R3.6 + R4).
-- Only the TEXT changes. Signatures, return types, volatility, search_path, timeouts and side effects are the live ones.
--   * brain_monday_line(timestamptz): no raw rule codes ("R06-link-ivan: ... set to ..."); rule names come from brain_rule_plain,
--     gains from brain_rules with the follow sign ("54% more views, 46 creators"); the Undo link keeps its token in the URL.
--     The rule-change feed row is this line: no other SQL function writes a "rule moved to in force" row.
--   * content_plan_monday_lines(timestamptz): "Ivan: next 2 weeks planned. 3 wait for your OK. 5 posts this week. Your rule is 2 to 4."
-- cb39_monday_card, the cron jobs and the dedupe keys are untouched. Rollback: db/266_plan_plain_words_feed_rollback.sql
begin;

create or replace function public.brain_monday_line(p_now timestamp with time zone default now())
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set statement_timeout to '5s'
as $fn$
declare since timestamptz := date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'; base text; parts text[] := '{}';
        x record; n int := 0; held text; n_held int; tested text; res text;
        nm text; sc text; gain text; what text; part text;
begin
  select value into base from public.integration_config where key = 'brain_undo_url';
  for x in
    select e.id, e.rule_id, e.kind, e.from_status, e.to_status, e.undo_token,
           exists (select 1 from public.brain_rule_events b where b.reverts_event_id = e.id and b.kind = 'rollback') undone,
           r.scope, r.effect_pct, r.ci_lo_pct, r.ci_hi_pct, r.creators,
           coalesce(p.follow_sign, case when r.claimed_sign in (-1, 1) then r.claimed_sign end, 1) as sg,
           coalesce(p.metric, 'views') as metric,
           coalesce(p.name, nullif(btrim(regexp_replace(r.statement, '\s*[.;(].*$', '')), ''), 'a rule') as rname
      from public.brain_rule_events e
      left join public.brain_rules r on r.rule_id = e.rule_id
      left join public.brain_rule_plain p on p.rule_id = e.rule_id
     where e.created_at >= since and e.created_at <= p_now and e.kind in ('apply','transition')
     order by e.created_at
  loop
    if x.rule_id like 'zz-%' and x.undone then continue; end if;  -- an undone self-test leaves no line
    n := n + 1;
    if n > 3 then continue; end if;
    nm := lower(left(x.rname, 1)) || substr(x.rname, 2);
    sc := case x.scope when 'risedtc' then 'for Rise' when 'arch' then 'for Arch' when 'ivan' then 'for Ivan' else 'for all accounts' end;
    gain := case
              when x.effect_pct is null then case when x.creators is not null then x.creators || ' creator' || case when x.creators = 1 then '' else 's' end end
              when x.ci_lo_pct < 0 and x.ci_hi_pct > 0 then 'not clear in the data'
              else round(abs(x.effect_pct)) || '% ' || case when x.effect_pct * x.sg >= 0 then 'more ' else 'fewer ' end || x.metric
                   || case when x.creators is not null then ', ' || x.creators || ' creator' || case when x.creators = 1 then '' else 's' end else '' end
            end;
    what := case coalesce(x.to_status, x.from_status) when 'live' then 'Now in force ' when 'shadow' then 'Now being tested ' when 'retired' then 'No longer used ' else 'Changed ' end || sc;
    part := case when x.undone then 'Undone ' || sc || ': ' || nm || '.'
                 else what || ': ' || nm || case when gain is not null then ' (' || gain || ')' else '' end || '.' end
         || case when x.undone then ''
                 when x.undo_token is not null and base is not null then ' Undo: ' || base || '?t=' || x.undo_token
                 else '' end;
    parts := parts || part;
  end loop;

  select count(*),
         string_agg(lower(left(h.rname, 1)) || substr(h.rname, 2) || ' (' ||
           case h.kind when 'retire' then 'stop using it' when 'flip' then 'the data now says the opposite'
                       when 'locked_disagrees' then 'your locked rule and the data disagree' when 'over_cap' then 'too many changes at once'
                       when 'client_scope' then 'it changes a client schedule' when 'block_mode' then 'it would start blocking posts'
                       else 'needs your look' end || ')', ', ' order by h.created_at)
    into n_held, held
    from (select pr.kind, pr.created_at,
                 coalesce(p.name, nullif(btrim(regexp_replace(r.statement, '\s*[.;(].*$', '')), ''), 'a rule') as rname
            from public.brain_rule_proposals pr
            left join public.brain_rules r on r.rule_id = pr.rule_id
            left join public.brain_rule_plain p on p.rule_id = pr.rule_id
           where pr.state = 'open' and pr.created_at >= since and pr.created_at <= p_now and pr.rule_id not like 'zz-%'
           order by pr.created_at limit 5) h;

  -- The strongest rule still being tested (not used yet), only when the data is clear and following it helps.
  select lower(left(t.rname, 1)) || substr(t.rname, 2) || ', ' || round(abs(t.effect_pct)) || '% '
           || case when t.effect_pct * t.sg >= 0 then 'more ' else 'fewer ' end || t.metric || ' '
           || case t.scope when 'risedtc' then 'for Rise creators' when 'arch' then 'for Arch creators' when 'ivan' then 'in Ivan''s niche' else 'for creators' end
    into tested
    from (select r.scope, r.effect_pct, r.rule_id,
                 coalesce(p.follow_sign, case when r.claimed_sign in (-1, 1) then r.claimed_sign end, 1) as sg,
                 coalesce(p.metric, 'views') as metric,
                 coalesce(p.name, nullif(btrim(regexp_replace(r.statement, '\s*[.;(].*$', '')), ''), 'a rule') as rname
            from public.brain_rules r left join public.brain_rule_plain p on p.rule_id = r.rule_id
           where r.status = 'shadow' and r.rule_id not like 'zz-%' and r.effect_pct is not null
             and not (r.ci_lo_pct < 0 and r.ci_hi_pct > 0)) t
   where t.effect_pct * t.sg > 0
   order by t.effect_pct * t.sg desc, t.rule_id
   limit 1;

  res := case when n = 0 then 'Brain: no rule changed this month.'
              else 'Brain this month: ' || array_to_string(parts, ' ') || case when n > 3 then ' ' || (n - 3) || ' more change' || case when n - 3 = 1 then '' else 's' end || '.' else '' end end
         || case when coalesce(n_held, 0) > 0 then ' Waiting for your OK: ' || held || '.' else '' end
         || case when tested is not null then ' Being tested: ' || tested || '.' else '' end;
  return res;
end $fn$;

create or replace function public.content_plan_monday_lines(p_now timestamp with time zone default now())
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set statement_timeout to '12s'
as $fn$
declare a text; st jsonb; nm text; line text; out text := ''; w jsonb; n_ok int; x jsonb; m text[]; rel text; wtxt text; sentences text[];
begin
  foreach a in array array['ivan','risedtc','arch'] loop
    nm := case a when 'ivan' then 'Ivan' when 'risedtc' then 'Rise' else 'Arch' end;
    begin
      st := public.content_plan_week(a, p_now);
      if st->>'state' = 'two_weeks_planned' then
        line := nm || ': next 2 weeks planned.';
      else
        select y into w from jsonb_array_elements(st->'weeks') y where y->>'start' = st->>'target_week';
        line := nm || ': week of ' || to_char((st->>'target_week')::date,'FMDD Mon') || ', ' || coalesce(w->>'filled','0') || ' of ' || coalesce(w->>'target','0') || ' posts planned.'
          || case when (st->>'proposals_only')::boolean and jsonb_array_length(coalesce(w->'planned','[]'::jsonb)) > 0
                  then ' ' || jsonb_array_length(w->'planned') || ' of them ' || case when jsonb_array_length(w->'planned') = 1 then 'is a proposal' else 'are proposals' end || '.' else '' end;
      end if;
      -- Posts that wait for Ivan: written drafts in Review, and planned slots whose draft is waiting in Review.
      select count(*) into n_ok
        from jsonb_array_elements(st->'weeks') y,
             lateral (select p from jsonb_array_elements(coalesce(y->'posts','[]'::jsonb)) p where p->>'status' = 'review'
                      union all
                      select p from jsonb_array_elements(coalesce(y->'planned','[]'::jsonb)) p where p->>'status' = 'waiting_review') z;
      if n_ok > 0 then
        line := line || ' ' || n_ok || case when n_ok = 1 then ' waits' else ' wait' end || ' for your OK.';
      end if;
      -- Warnings: one sentence each. A week over the rule reads "5 posts this week. Your rule is 2 to 4."
      sentences := '{}';
      -- rule breaks come first, then the other gaps
      for x in select e from jsonb_array_elements(coalesce(st->'warnings','[]'::jsonb)) with ordinality t(e, o)
                order by (e->>'code' not in ('over_rule','weekend_post')), o loop
        wtxt := regexp_replace(coalesce(x->>'text',''), '\.\s*$', '');
        if wtxt = '' then continue; end if;
        if x->>'code' = 'over_rule' then
          m := regexp_match(wtxt, '^Week of (.+?) has (\d+) posts?\.\s*(.*)$');
          if m is not null then
            select case y->>'which' when 'this' then 'this week' when 'next' then 'next week' else 'the week of ' || m[1] end into rel
              from jsonb_array_elements(st->'weeks') y where to_char((y->>'start')::date,'FMDD Mon') = m[1] limit 1;
            wtxt := m[2] || ' post' || case when m[2] = '1' then '' else 's' end || ' ' || coalesce(rel, 'the week of ' || m[1]) || '. ' || m[3];
            wtxt := regexp_replace(wtxt, '\.\s*$', '');
          end if;
        end if;
        sentences := sentences || wtxt;
      end loop;
      if array_length(sentences, 1) > 0 then
        line := line || ' ' || array_to_string(sentences, '. ') || '.';
      end if;
    exception when others then line := nm || ': plan could not be read.';
    end;
    out := out || case when out = '' then '' else E'\n' end || line;
  end loop;
  return out;
end $fn$;

commit;
