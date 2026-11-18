-- Content Desk r6 (eval E1, 2026-11-18): desk_brief_core with the postable call-line block fixed.
-- Everything else is the live body as of 2026-11-18 (snapshot in OUT/snapshots/20261118m_r6_pre.json).

CREATE OR REPLACE FUNCTION public.desk_brief_core(p_fixtures boolean DEFAULT false, p_with_panel boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Europe/Warsaw')::date;
  v_this_mon   date := date_trunc('week', (now() at time zone 'Europe/Warsaw'))::date;
  v_panel      jsonb;
  v_drafts     jsonb;
  v_queue      jsonb;
  v_posts      jsonb;
  v_calls      jsonb;
  v_lines      jsonb;
  v_beliefs    jsonb;
  v_rulings    jsonb;
  v_autopilot  jsonb;
  v_ideas      jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'desk_brief_ivan: service role only' using errcode = '42501';
  end if;

  if p_with_panel then
    begin
      v_panel := public.cp17_calendar_panel_ivan();
    exception when others then
      v_panel := jsonb_build_object('ok', false, 'error', left(sqlerrm, 200));
    end;
  else
    v_panel := jsonb_build_object('omitted', true);
  end if;

  -- Ivan's live drafts: everything not finished, plus anything published in
  -- the last 14 days.
  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) into v_drafts from (
    select jsonb_build_object(
      'id', d.id,
      'status', d.status,
      'type', d.type,
      'scheduled_at', d.scheduled_at,
      'published_at', d.published_at,
      'first_line', public.desk_first_line(d.post_body),
      'title', left(coalesce(d.title, d.topic, ''), 120),
      -- belief / vehicle: the draft's own taxonomy, else the post labeler (published posts)
      'belief', coalesce(case when d.taxonomy->>'belief' ~ '^[1-5]$' then (d.taxonomy->>'belief')::int end, lb.belief::int),
      'vehicle', coalesce(nullif(d.taxonomy->>'vehicle', ''), lb.vehicle),
      'recipe', d.qa->>'recipe',
      'qa_verdict', d.qa->>'verdict',
      'is_copy', (d.taxonomy->>'outlier_copy' = 'true'
                  or d.taxonomy->>'source' in ('linkedin_outlier_copy', 'x_tracked_outlier')
                  or coalesce(d.source_ref, '') like 'outlier:%'),
      'photos', coalesce(array_length(d.image_urls, 1), 0),
      'brain', (d.taxonomy->>'source' = 'content-brain'
                or (d.status in ('review', 'error')
                    and coalesce((select v.cb34_p2_member from public.cb34_p2_safe_drafts v where v.id = d.id), false))),
      'human_edited', d.taxonomy->>'human_edited' = 'true',
      'slot_kind', nullif(d.taxonomy->>'slot_kind', ''),
      -- same selling marker cp17_belief_quota_check reads
      'selling', (coalesce(d.taxonomy->>'slot_kind', '') = 'selling_claim' or coalesce(d.taxonomy->>'kind', '') = 'selling_claim'
                  or coalesce(d.taxonomy->>'selling_claim', '') = 'true'
                  or (d.taxonomy->>'source' = 'manual' and d.taxonomy ? 'hand_dated_at' and coalesce(d.taxonomy->>'approval', '') like 'explicit-user-%')),
      'chars', length(coalesce(d.post_body, '')),
      'created_at', d.created_at,
      'fixture', d.taxonomy->>'desk_eval_fixture',
      'sort', coalesce(to_char(d.scheduled_at, 'YYYY-MM-DD"T"HH24:MI'), '9999') || to_char(d.created_at, 'YYYYMMDDHH24MISS')
    ) as x
    from public.carousel_drafts d
    left join lateral (select l.belief, l.vehicle from public.cp17_post_labels l
                        where l.draft_id = d.id order by l.labeled_at desc limit 1) lb on true
    where d.client_id is null
      and coalesce(d.taxonomy->>'deleted_by_operator', '') = ''
      and (
        (coalesce(d.taxonomy->>'internal_test', '') <> 'true' and d.taxonomy->>'desk_eval_fixture' is null)
        or (p_fixtures and d.taxonomy->>'desk_eval_fixture' is not null)
      )
      and (
        d.status in ('review', 'approved', 'scheduled', 'generating', 'error')
        or (d.status = 'published' and d.published_at > v_now - interval '14 days')
      )
    order by d.created_at desc
    limit 120
  ) s;

  -- The publish queue for the next 21 days (the Next rows), with the
  -- autopilot / own origin the app shows.
  select coalesce(jsonb_agg(jsonb_build_object(
      'queue_id', q.id, 'draft_id', d.id, 'slot_at', q.scheduled_at,
      'origin', case when coalesce((public.content_autonomy_publish_state_ivan(q.id)->>'required')::boolean, false)
                     then 'autopilot' else 'own' end,
      'first_line', public.desk_first_line(d.post_body)
    ) order by q.scheduled_at), '[]'::jsonb) into v_queue
  from public.scheduled_posts q
  join public.carousel_drafts d on d.id::text = q.clickup_task_id
  where q.platform = 'linkedin' and q.status = 'pending' and coalesce(q.is_repost, false) = false
    and d.client_id is null and q.scheduled_at > v_now and q.scheduled_at < v_now + interval '21 days';

  begin
    v_posts := public.ivan_week_posts_worked(v_now - interval '31 days', v_now);
  exception when others then
    v_posts := jsonb_build_object('error', left(sqlerrm, 200));
  end;

  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) into v_calls from (
    select jsonb_build_object(
      'id', t.id, 'date', t.date, 'title', left(coalesce(t.title, ''), 80),
      'call_kind', t.call_review->>'call_kind',
      'booked', t.call_review->'next_step'->>'booked',
      'next_when', t.call_review->'next_step'->>'when',
      'next_note', left(coalesce(t.call_review->'next_step'->>'note', ''), 200)
    ) as x
    from public.transcripts t
    -- Ivan's own calls only (his Mac listener), never a client's recordings
    where t.source = 'ivan-listener' and t.call_review is not null and t.call_review->>'status' is null
    order by t.date desc nulls last
    limit 5
  ) s;

  -- Postable lines from calls: the call extractor's lines in Ivan's own words (r6, eval E1). Only rows
  -- that carry his words ('said') and the call date ('when'): rows without them never take a slot, so
  -- newer dated calls are never pushed out by lines that have no text. Picked like the app's call-line
  -- list (newest ingest, then score), then shown newest call first.
  select coalesce(jsonb_agg(x order by x->>'when' desc, (x->>'score')::numeric desc nulls last), '[]'::jsonb) into v_lines from (
    select jsonb_build_object(
      'id', i.id, 'ingested_at', i.ingested_at, 'status', i.status,
      'topic', left(coalesce(i.raw_topic, ''), 200),
      'said', left(i.evidence->0->>'said', 400),
      'when', i.evidence->0->>'when',
      'belief', i.evidence->0->>'belief', 'vehicle', i.evidence->0->>'vehicle',
      'score', i.composite_score,
      'draft_id', i.promoted_draft_id
    ) as x
    from public.lm_idea_candidates i
    where i.source = 'ivan_call'
      -- the app's ideaDecidable lane guard: own workspace, no campaign
      and lower(btrim(coalesce(i.workspace_type, ''))) in ('', 'own') and i.campaign_id is null
      and i.status in ('scored', 'reviewing', 'promoted')  -- scored lines only; pending ones are not yet judged
      and i.ingested_at > v_now - interval '21 days'
      and coalesce(btrim(i.evidence->0->>'said'), '') <> ''
      and coalesce(i.evidence->0->>'when', '') ~ '^\d{4}-\d{2}-\d{2}'
    order by i.ingested_at desc, i.composite_score desc nulls last
    limit 12
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('n', regexp_replace(b.id, '^.*-', ''), 'belief', b.belief, 'why', left(coalesce(b.why_disagreeable, ''), 240)) order by b.id), '[]'::jsonb)
    into v_beliefs
  from public.cb44_beliefs b where b.client_id = 'ivan' and b.status = 'kept';

  -- Ivan's dated rulings that touch content: feedback notes whose NAME is about
  -- content work, newest ruling date first (the date in the file name).
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_rulings from (
    select jsonb_build_object(
      'note', regexp_replace(m.file_path, '^.*/|\.md$', '', 'g'),
      'at', coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')),
      'rule', left(btrim(coalesce(substring(m.content from 'description:[ \t]*([^\n]*)'), ''), ' "'), 300)
    ) as x
    from public.claude_memory m
    where m.client_id = 'ivan' and m.file_path like 'project/feedback-%'
      and m.file_path ~* '(post|content|voice|copy|hook|carousel|lm-|writer|belief|calendar|photo|poland|feed|draft|caption|story|angle|outlier|selfie)'
      and m.file_path !~* '(rise|arch|swishdm|dm-|scan|outreach|invite|follow-?up|apollo|harvest|reply)'
    order by coalesce(substring(m.file_path from '(\d{4}-\d{2}-\d{2})'), to_char(m.updated_at, 'YYYY-MM-DD')) desc
    limit 14
  ) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_autopilot from (
    select jsonb_build_object('ran_at', r.ran_at, 'week_start', r.week_start, 'mode', r.mode,
      'picked', r.picked, 'scheduled', r.scheduled, 'open_before', r.open_before, 'outcome', r.outcome,
      'summary', left(coalesce(r.summary, ''), 400)) as x
    from public.content_autopilot_runs r
    where r.account = 'ivan'
    order by r.ran_at desc limit 3
  ) s;

  select jsonb_build_object(
    -- the same lane guard as the app's ideaDecidable: own workspace, no campaign
    'reviewing', (select count(*) from public.lm_idea_candidates where status = 'reviewing'
                    and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null),
    'newest', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'source', i.source, 'topic', left(coalesce(i.raw_topic, ''), 140), 'at', i.ingested_at) order by i.ingested_at desc)
       from (select * from public.lm_idea_candidates where status in ('reviewing', 'pending', 'scored')
               and lower(btrim(coalesce(workspace_type, ''))) in ('', 'own') and campaign_id is null
             order by ingested_at desc limit 6) i), '[]'::jsonb)
  ) into v_ideas;

  return jsonb_build_object(
    'as_of', v_now,
    'today', v_today,
    'this_monday', v_this_mon,
    'panel', v_panel,
    'drafts', v_drafts,
    'queue', v_queue,
    'posts', v_posts,
    'calls', v_calls,
    'call_lines', v_lines,
    'beliefs', v_beliefs,
    'rulings', v_rulings,
    'autopilot', v_autopilot,
    'ideas', v_ideas
  );
end $function$;
