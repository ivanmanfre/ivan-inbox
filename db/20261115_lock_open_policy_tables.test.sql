-- Rolled-back test of 20261115p, q, r on live data. Three phases in one transaction:
--   phase 0 = live state before, phase 1 = the three batches applied, phase 2 = the three rollbacks applied.
-- Every phase runs the same probes as each real role (anon = public key, authenticated = the one signed-in user,
-- service_role), inside a sub-block that is always rolled back, so probe writes never survive a phase. At the end the
-- block RAISEs, so nothing stays. The runner replaces each MIG / RB placeholder (letters P, Q, R, wrapped in double
-- underscores) with that file's body, BEGIN; / COMMIT; lines removed. The result is the RAISE text.
-- Nothing here sends anything. The probe rows use the slug / id prefix "zz-lock-test".
DO $t$
DECLARE
  mig_p text := $mig$__MIG_P__$mig$;
  mig_q text := $mig$__MIG_Q__$mig$;
  mig_r text := $mig$__MIG_R__$mig$;
  rb_p text := $mig$__RB_P__$mig$;
  rb_q text := $mig$__RB_Q__$mig$;
  rb_r text := $mig$__RB_R__$mig$;
  tabs text[] := ARRAY['transcripts','call_reports','calendar_events','audience_audits','sales_scripts','video_ideas',
    'own_posts','content_photos','outreach_filter_spec','pageviews','recording_comments','shared_page_edits'];
  read_tabs text[] := ARRAY['transcripts','call_reports','calendar_events','audience_audits','sales_scripts',
    'video_ideas','own_posts','content_photos','outreach_filter_spec'];
  locked text[] := ARRAY['call_reports','video_ideas','own_posts','content_photos','outreach_filter_spec'];
  narrowed jsonb := jsonb_build_object(
    'transcripts', jsonb_build_array('id','title','date','duration_minutes','participants','meeting_type'),
    'audience_audits', jsonb_build_array('prospect_name','onepager_url','audited_at'),
    'calendar_events', jsonb_build_array('id','title','start_time','end_time','attendees','meeting_type','platform','meeting_url','is_all_day'),
    'sales_scripts', jsonb_build_array('id','name','meeting_type','version','is_active','phases'));
  uid uuid; emb text; tid uuid; ph int; t text; c text; k text; q text; r text; kind text; rl text; n int;
  probes jsonb; outj jsonb; res jsonb := '{}'::jsonb; snap jsonb; p jsonb; chk jsonb := '{}'::jsonb;
  bad jsonb; ok_cols jsonb; den_cols jsonb; p0 jsonb; p1 jsonb; p2 jsonb; fnc int; vwc int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT id INTO uid FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT embedding::text, id INTO emb, tid FROM public.transcripts WHERE embedding IS NOT NULL ORDER BY date DESC LIMIT 1;

  -- The probe list: role, key, kind (q = query that returns one text, x = statement, result is its row count), sql.
  probes := '[]'::jsonb;
  FOREACH t IN ARRAY tabs LOOP
    probes := probes || jsonb_build_array(jsonb_build_array('anon', 'count.'||t, 'q', format('select count(*)::text from public.%I', t)));
    probes := probes || jsonb_build_array(jsonb_build_array('service_role', 'count.'||t, 'q', format('select count(*)::text from public.%I', t)));
  END LOOP;
  FOREACH t IN ARRAY read_tabs LOOP
    probes := probes || jsonb_build_array(jsonb_build_array('anon', 'star.'||t, 'q', format('select count(*)::text from (select to_jsonb(z) from public.%I z limit 1) y', t)));
    SELECT a.attname INTO c FROM pg_attribute a WHERE a.attrelid = ('public.'||t)::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1;
    probes := probes || jsonb_build_array(jsonb_build_array('anon', 'upd.'||t, 'x', format('update public.%I set %I = %I where false', t, c, c)));
    probes := probes || jsonb_build_array(jsonb_build_array('anon', 'del.'||t, 'x', format('delete from public.%I where false', t)));
    probes := probes || jsonb_build_array(jsonb_build_array('anon', 'ins.'||t, 'x', format('insert into public.%I default values', t)));
    FOR c IN SELECT a.attname FROM pg_attribute a WHERE a.attrelid = ('public.'||t)::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LOOP
      probes := probes || jsonb_build_array(jsonb_build_array('anon', 'col.'||t||'.'||c, 'q', format('select count(%I)::text from public.%I', c, t)));
    END LOOP;
  END LOOP;
  probes := probes || jsonb_build_array(
    -- Ivan Listener, public key: the five request shapes from the gateway logs.
    jsonb_build_array('anon', 'listener.calendar_6', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,start_time,end_time,attendees,meeting_type,platform,meeting_url,is_all_day from public.calendar_events where start_time >= now() order by start_time asc limit 6) x$q$),
    jsonb_build_array('anon', 'listener.calendar_8', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,start_time,end_time,attendees,meeting_type,platform,meeting_url,is_all_day from public.calendar_events where start_time >= now() - interval '3 hours' order by start_time asc limit 8) x$q$),
    jsonb_build_array('anon', 'listener.audits', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select prospect_name,onepager_url from public.audience_audits where onepager_url is not null order by audited_at desc limit 50) x$q$),
    jsonb_build_array('anon', 'listener.transcripts', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,date,duration_minutes,participants,meeting_type from public.transcripts order by date desc limit 6) x$q$),
    jsonb_build_array('anon', 'listener.script', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,name,meeting_type,version,is_active,phases from public.sales_scripts where meeting_type = 'discovery_sales' and is_active = true limit 1) x$q$),
    -- The inbox app's signed-out reads of calendar_events (4 in 7 days): expected to be refused in phase 1.
    jsonb_build_array('anon', 'inbox_signed_out.calendar', 'q', $q$select count(*)::text from (select id,title,start_time,end_time,attendees,meeting_url,is_all_day,is_test,meeting_type,source,referral_token,booking_source_path from public.calendar_events where is_all_day = false order by start_time limit 20) x$q$),
    -- Public pages, public key: owner-rights functions that read own_posts.
    jsonb_build_array('anon', 'fn.recent_own_posts', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from public.recent_own_posts(3) x$q$),
    jsonb_build_array('anon', 'fn.public_engine_metrics', 'q', $q$select md5((public.public_engine_metrics()::jsonb - 'generated_at')::text)$q$),
    jsonb_build_array('anon', 'fn.match_transcripts', 'q', format($q$select 'rows='||count(*)||' text_chars='||coalesce(sum(length(transcript_text)),0) from public.match_transcripts(%L::vector, 0.0, 3)$q$, emb)),
    -- Public pages, public key: pageviews insert (trackers), shared page edits (client review pages).
    jsonb_build_array('anon', 'pub.pageviews_insert', 'x', $q$insert into public.pageviews(session_id, path, is_test) values ('zz-lock-test', '/zz-lock-test', true)$q$),
    jsonb_build_array('anon', 'pub.pageviews_select', 'q', $q$select count(*)::text from public.pageviews where session_id = 'zz-lock-test'$q$),
    jsonb_build_array('anon', 'pub.spe_upsert_new', 'x', $q$insert into public.shared_page_edits(page_slug, item_key, body) values ('zz-lock-test', 'k1', 'a') on conflict (page_slug, item_key) do update set page_slug = excluded.page_slug, item_key = excluded.item_key, body = excluded.body$q$),
    jsonb_build_array('anon', 'pub.spe_upsert_again', 'x', $q$insert into public.shared_page_edits(page_slug, item_key, body) values ('zz-lock-test', 'k1', 'b') on conflict (page_slug, item_key) do update set page_slug = excluded.page_slug, item_key = excluded.item_key, body = excluded.body$q$),
    jsonb_build_array('anon', 'pub.spe_select', 'q', $q$select coalesce(string_agg(item_key||'='||body, ','), '') from (select item_key, body from public.shared_page_edits where page_slug = 'zz-lock-test') x$q$),
    jsonb_build_array('anon', 'pub.spe_delete', 'x', $q$delete from public.shared_page_edits where page_slug = 'zz-lock-test'$q$),
    -- Public video page, public key. Fixtures first (as postgres): one public and one private recording, one comment each.
    jsonb_build_array('postgres', 'fix.recordings', 'x', $q$insert into public.recordings(id, title, original_path, is_public) values ('00000000-0000-4000-8000-0000000000a1', 'zz-lock-test public', 'zz-lock-test/pub', true), ('00000000-0000-4000-8000-0000000000a2', 'zz-lock-test private', 'zz-lock-test/priv', false)$q$),
    jsonb_build_array('postgres', 'fix.comments', 'x', $q$insert into public.recording_comments(id, recording_id, author_name, comment_text) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'owner', 'on public'), ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2', 'owner', 'on private')$q$),
    jsonb_build_array('anon', 'rc.insert_public', 'x', $q$insert into public.recording_comments(recording_id, author_name, comment_text, timestamp_seconds, parent_id) values ('00000000-0000-4000-8000-0000000000a1', 'viewer', 'hello', null, null)$q$),
    jsonb_build_array('anon', 'rc.read_public', 'q', $q$select count(*)::text from (select * from public.recording_comments where recording_id = '00000000-0000-4000-8000-0000000000a1' order by created_at) x$q$),
    jsonb_build_array('anon', 'rc.read_private', 'q', $q$select count(*)::text from (select * from public.recording_comments where recording_id = '00000000-0000-4000-8000-0000000000a2' order by created_at) x$q$),
    jsonb_build_array('anon', 'rc.read_all', 'q', $q$select count(*)::text from public.recording_comments$q$),
    jsonb_build_array('authenticated', 'rc.read_all', 'q', $q$select count(*)::text from public.recording_comments$q$),
    jsonb_build_array('authenticated', 'rc.update', 'x', $q$update public.recording_comments set comment_text = 'edited by owner' where id = '00000000-0000-4000-8000-0000000000c2'$q$),
    jsonb_build_array('authenticated', 'rc.delete', 'x', $q$delete from public.recording_comments where id = '00000000-0000-4000-8000-0000000000c2'$q$),
    jsonb_build_array('anon', 'rc.update_other', 'x', $q$update public.recording_comments set comment_text = 'defaced' where id = '00000000-0000-4000-8000-0000000000c1'$q$),
    jsonb_build_array('anon', 'rc.delete_other', 'x', $q$delete from public.recording_comments where id = '00000000-0000-4000-8000-0000000000c1'$q$),
    -- Signed-in apps: the inbox app's real request shapes and the dashboard's reads.
    jsonb_build_array('authenticated', 'inbox.calendar_next', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,start_time,end_time,attendees,meeting_url,is_all_day,is_test,meeting_type,source,referral_token,booking_source_path from public.calendar_events where end_time >= now() and start_time <= now() + interval '7 days' and is_all_day = false order by start_time asc limit 20) x$q$),
    jsonb_build_array('authenticated', 'inbox.calendar_week', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,start_time,end_time,attendees,meeting_url,is_all_day,is_test,meeting_type,source,referral_token,booking_source_path from public.calendar_events where start_time >= now() - interval '7 days' and start_time <= now() + interval '7 days' and is_all_day = false order by start_time asc limit 100) x$q$),
    jsonb_build_array('authenticated', 'inbox.transcripts_list', 'q', $q$select md5(coalesce(jsonb_agg(to_jsonb(x))::text,''))||':'||count(*) from (select id,title,date,duration_minutes,participants,summary,action_items,topics,follow_up_draft,follow_up_sent,source,meeting_type,brief from public.transcripts order by date desc, id desc limit 200) x$q$),
    jsonb_build_array('authenticated', 'inbox.transcript_text', 'q', format($q$select md5(coalesce(transcript_text,''))||':'||length(coalesce(transcript_text,'')) from public.transcripts where id = %L$q$, tid)),
    jsonb_build_array('authenticated', 'dash.call_reports', 'q', $q$select count(*)::text from public.call_reports$q$),
    jsonb_build_array('authenticated', 'dash.video_ideas', 'q', $q$select count(*)::text from public.video_ideas$q$),
    jsonb_build_array('authenticated', 'dash.audience_audits', 'q', $q$select count(*)::text from public.audience_audits$q$),
    jsonb_build_array('authenticated', 'dash.sales_scripts', 'q', $q$select count(*)::text from public.sales_scripts$q$),
    jsonb_build_array('authenticated', 'dash.own_posts', 'q', $q$select count(*)::text from public.own_posts$q$),
    jsonb_build_array('authenticated', 'dash.pageviews', 'q', $q$select count(*)::text from public.pageviews$q$),
    jsonb_build_array('authenticated', 'inbox.content_photos', 'q', $q$select count(*)::text from public.content_photos$q$),
    jsonb_build_array('authenticated', 'inbox.search_content_photos', 'q', $q$select count(*)::text from public.search_content_photos('', 500)$q$),
    jsonb_build_array('authenticated', 'inbox.filter_spec_v', 'q', $q$select count(*)::text from public.inbox_filter_spec_v$q$),
    jsonb_build_array('authenticated', 'inbox.filter_spec', 'q', $q$select count(*)::text from public.outreach_filter_spec$q$),
    -- Service callers: a write shape per written table (n8n, runner). Rows are rolled back with the phase.
    jsonb_build_array('service_role', 'svc.own_posts_update', 'x', $q$update public.own_posts set metrics_updated_at = metrics_updated_at where id = (select id from public.own_posts order by posted_at desc nulls last limit 1)$q$),
    jsonb_build_array('service_role', 'svc.filter_spec_upsert', 'x', $q$insert into public.outreach_filter_spec(client_id, run_tag, spec) values ('zz-lock-test', 'zz-lock-test', '{}'::jsonb) on conflict (client_id, run_tag) do update set spec = excluded.spec$q$),
    jsonb_build_array('service_role', 'svc.calendar_delete_none', 'x', $q$delete from public.calendar_events where end_time < '2000-01-01'$q$),
    jsonb_build_array('service_role', 'svc.transcripts_read', 'q', format($q$select length(coalesce(transcript_text,''))::text from public.transcripts where id = %L$q$, tid)),
    jsonb_build_array('service_role', 'svc.match_transcripts', 'q', format($q$select 'rows='||count(*) from public.match_transcripts(%L::vector, 0.0, 3)$q$, emb))
  );

  FOR ph IN 0..2 LOOP
    IF ph = 1 THEN EXECUTE mig_p; EXECUTE mig_q; EXECUTE mig_r; END IF;
    IF ph = 2 THEN EXECUTE rb_r; EXECUTE rb_q; EXECUTE rb_p; END IF;

    -- Catalog snapshot of the 12 tables: table grants, column grants, policies.
    SELECT jsonb_object_agg(cl.relname, jsonb_build_object(
        'rls', cl.relrowsecurity,
        'acl', (SELECT coalesce(jsonb_agg(a.ax ORDER BY a.ax), '[]'::jsonb) FROM (SELECT i::text ax FROM unnest(cl.relacl) i WHERE i::text ~ '^(anon|authenticated|service_role)?=') a),
        'colacl', (SELECT coalesce(jsonb_agg(at.attname||':'||at.attacl::text ORDER BY at.attname), '[]'::jsonb) FROM pg_attribute at WHERE at.attrelid = cl.oid AND at.attnum > 0 AND at.attacl IS NOT NULL AND cardinality(at.attacl) > 0),
        'pol', (SELECT coalesce(jsonb_agg(jsonb_build_object('n', po.polname, 'c', po.polcmd::text, 'perm', po.polpermissive,
                  'r', (SELECT jsonb_agg(coalesce(ro.rolname, 'PUBLIC') ORDER BY coalesce(ro.rolname, 'PUBLIC')) FROM unnest(po.polroles) u(o) LEFT JOIN pg_roles ro ON ro.oid = u.o),
                  'q', pg_get_expr(po.polqual, po.polrelid), 'w', pg_get_expr(po.polwithcheck, po.polrelid)) ORDER BY po.polname), '[]'::jsonb)
                FROM pg_policy po WHERE po.polrelid = cl.oid)))
      INTO snap
      FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE ns.nspname = 'public' AND cl.relname = ANY (tabs);
    SELECT count(*) INTO fnc FROM pg_proc pp JOIN pg_namespace ns ON ns.oid = pp.pronamespace
     WHERE ns.nspname = 'public' AND pp.prosecdef AND has_function_privilege('anon', pp.oid, 'EXECUTE');
    SELECT count(*) INTO vwc FROM pg_class cl JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE ns.nspname = 'public' AND cl.relkind IN ('v','m')
       AND EXISTS (SELECT 1 FROM aclexplode(cl.relacl) a JOIN pg_roles ro ON ro.oid = a.grantee WHERE ro.rolname = 'anon');

    outj := '{}'::jsonb;
    BEGIN
      FOR p IN SELECT * FROM jsonb_array_elements(probes) LOOP
        rl := p->>0; k := (p->>0)||'|'||(p->>1); kind := p->>2; q := p->>3;
        BEGIN
          IF rl = 'postgres' THEN
            EXECUTE 'reset role';
          ELSE
            EXECUTE format('set local role %I', rl);
            PERFORM set_config('request.jwt.claims', CASE WHEN rl = 'authenticated'
              THEN jsonb_build_object('sub', uid, 'role', 'authenticated')::text ELSE jsonb_build_object('role', rl)::text END, true);
          END IF;
          IF kind = 'q' THEN
            EXECUTE q INTO r;
          ELSE
            EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT; r := 'rows='||n;
          END IF;
          EXECUTE 'reset role';
          outj := outj || jsonb_build_object(k, r);
        EXCEPTION WHEN OTHERS THEN
          -- the failed sub-block already undid its own SET LOCAL ROLE
          outj := outj || jsonb_build_object(k, 'E'||SQLSTATE||' '||left(SQLERRM, 46));
        END;
      END LOOP;
      RAISE EXCEPTION USING ERRCODE = 'ZZ001', MESSAGE = 'undo probe writes';
    EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
    END;
    res := res || jsonb_build_object('p'||ph, jsonb_build_object('snap', snap, 'probes', outj, 'secdef_fn_anon', fnc, 'views_anon', vwc));
  END LOOP;

  p0 := res->'p0'->'probes'; p1 := res->'p1'->'probes'; p2 := res->'p2'->'probes';

  -- 1. Rollback restores the exact catalog state and every probe result.
  chk := chk || jsonb_build_object('rollback_catalog_exact', (res->'p2'->'snap') = (res->'p0'->'snap'),
    'rollback_probes_exact', p2 = p0,
    'rollback_fn_count_back', (res->'p2'->>'secdef_fn_anon') = (res->'p0'->>'secdef_fn_anon'));

  -- 2. Locked tables: the public key read rows before, and is refused everything after.
  bad := '[]'::jsonb;
  FOREACH t IN ARRAY locked LOOP
    IF (p0->>('anon|count.'||t)) !~ '^[0-9]+$' THEN bad := bad || to_jsonb('before-not-readable '||t); END IF;
    FOR k IN SELECT key FROM jsonb_each_text(p1) WHERE key ~ ('^anon\|(count|star|upd|del|ins|col)\.'||t||'(\.|$)') LOOP
      IF (p1->>k) NOT LIKE 'E42501 permission denied for table%' THEN bad := bad || to_jsonb(k||' => '||(p1->>k)); END IF;
    END LOOP;
  END LOOP;
  chk := chk || jsonb_build_object('locked_tables_refuse_anon', bad = '[]'::jsonb, 'locked_bad', bad);

  -- 3. Narrowed tables: exactly the granted columns are readable, nothing else, no writes.
  bad := '[]'::jsonb;
  FOR t IN SELECT key FROM jsonb_each(narrowed) LOOP
    SELECT coalesce(jsonb_agg(split_part(key, '.', 3) ORDER BY split_part(key, '.', 3)), '[]'::jsonb) INTO ok_cols
      FROM jsonb_each_text(p1) WHERE key LIKE 'anon|col.'||t||'.%' AND value ~ '^[0-9]+$';
    SELECT coalesce(jsonb_agg(split_part(key, '.', 3) ORDER BY split_part(key, '.', 3)), '[]'::jsonb) INTO den_cols
      FROM jsonb_each_text(p1) WHERE key LIKE 'anon|col.'||t||'.%' AND value NOT LIKE 'E42501 permission denied%' AND value !~ '^[0-9]+$';
    IF ok_cols <> (SELECT jsonb_agg(v ORDER BY v) FROM jsonb_array_elements_text(narrowed->t) v) THEN bad := bad || jsonb_build_object(t, ok_cols); END IF;
    IF den_cols <> '[]'::jsonb THEN bad := bad || jsonb_build_object(t||'_odd', den_cols); END IF;
    FOREACH c IN ARRAY ARRAY['star','upd','del','ins'] LOOP
      IF (p1->>('anon|'||c||'.'||t)) NOT LIKE 'E42501 permission denied for table%' THEN bad := bad || to_jsonb(c||'.'||t||' => '||(p1->>('anon|'||c||'.'||t))); END IF;
    END LOOP;
    IF (SELECT count(*) FROM jsonb_each_text(p0) WHERE key LIKE 'anon|col.'||t||'.%' AND value !~ '^[0-9]+$') > 0 THEN bad := bad || to_jsonb('before-col-not-readable '||t); END IF;
  END LOOP;
  chk := chk || jsonb_build_object('narrowed_tables_exact_columns', bad = '[]'::jsonb, 'narrowed_bad', bad);

  -- 4. Same results before and after for: Listener, the signed-in apps, service callers, the public pages.
  SELECT coalesce(jsonb_agg(key||' : '||coalesce(p0->>key,'-')||' -> '||value ORDER BY key), '[]'::jsonb) INTO bad
    FROM jsonb_each_text(p1)
   WHERE (key LIKE 'anon|listener.%' OR key LIKE 'authenticated|%' OR key LIKE 'service_role|%' OR key LIKE 'anon|pub.%'
          OR key IN ('anon|fn.recent_own_posts', 'anon|fn.public_engine_metrics', 'anon|rc.insert_public', 'anon|rc.read_public',
                     'anon|count.pageviews', 'anon|count.shared_page_edits', 'postgres|fix.recordings', 'postgres|fix.comments'))
     AND value IS DISTINCT FROM (p0->>key);
  chk := chk || jsonb_build_object('unchanged_for_real_callers', bad = '[]'::jsonb, 'changed', bad);
  SELECT coalesce(jsonb_agg(key||' : '||value ORDER BY key), '[]'::jsonb) INTO bad FROM (
    SELECT 'p0 '||key AS key, value FROM jsonb_each_text(p0) UNION ALL SELECT 'p1 '||key, value FROM jsonb_each_text(p1)) e
   WHERE (key ~ '^p[01] (anon\|listener\.|authenticated\||service_role\||anon\|pub\.|anon\|fn\.recent|anon\|fn\.public|postgres\|fix\.)'
          OR key ~ '^p[01] anon\|rc\.(insert_public|read_public)$') AND value LIKE 'E%';
  chk := chk || jsonb_build_object('no_real_caller_errors_before_or_after', bad = '[]'::jsonb, 'real_caller_errors', bad);

  -- 5. What must change for the public key.
  chk := chk || jsonb_build_object(
    'match_transcripts_leak_closed', (p0->>'anon|fn.match_transcripts') ~ '^rows=[1-9]' AND (p1->>'anon|fn.match_transcripts') LIKE 'E42501%',
    'rc_private_read_closed', (p0->>'anon|rc.read_private') = '1' AND (p1->>'anon|rc.read_private') = '0',
    'rc_update_closed', (p0->>'anon|rc.update_other') = 'rows=1' AND (p1->>'anon|rc.update_other') = 'rows=0',
    'rc_delete_closed', (p0->>'anon|rc.delete_other') = 'rows=1' AND (p1->>'anon|rc.delete_other') = 'rows=0',
    'rc_public_read_kept', (p0->>'anon|rc.read_public') = '2' AND (p1->>'anon|rc.read_public') = '2',
    'inbox_signed_out_calendar_refused', (p0->>'anon|inbox_signed_out.calendar') ~ '^[0-9]+$' AND (p1->>'anon|inbox_signed_out.calendar') LIKE 'E42501%',
    'secdef_fn_anon_before_after', (res->'p0'->>'secdef_fn_anon')||' -> '||(res->'p1'->>'secdef_fn_anon'),
    'views_anon_before_after', (res->'p0'->>'views_anon')||' -> '||(res->'p1'->>'views_anon'));

  RAISE EXCEPTION 'RESULT %', jsonb_build_object('checks', chk,
    'p0', (SELECT jsonb_object_agg(key, value) FROM jsonb_each(p0) WHERE key NOT LIKE 'anon|col.%'),
    'p1', (SELECT jsonb_object_agg(key, value) FROM jsonb_each(p1) WHERE key NOT LIKE 'anon|col.%'),
    'p1_snap', res->'p1'->'snap');
END
$t$;
