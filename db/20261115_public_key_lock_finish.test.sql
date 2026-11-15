-- Rolled-back test of 20261115t, u, v, w on live data, one transaction:
--   phase 0 = the live state when the test starts, phase 1 = the migrations applied (only the ones not live yet),
--   phase 2 = planted faults for the daily check, phase 3 = the rollbacks of what this run applied (the catalog,
--   full ACLs included, must equal phase 0 exactly), then the rollbacks of the migrations that were already live.
-- Probes run as each real role (anon = public key, authenticated, service_role). At the end the block RAISEs, so
-- nothing stays: no row, no function, no cron job. The runner replaces each MIG / RB placeholder (letters T, U, V, W,
-- wrapped in double underscores) with that file's body, BEGIN; / COMMIT; lines removed, and sets the LIVE list to the
-- migrations already applied (their MIG is skipped, their rollback runs last, after the exact comparison).
-- Nothing here sends anything. Probe rows use the slug "zz-lock-test".
DO $t$
DECLARE
  mig_t text := $mig$__MIG_T__$mig$;
  mig_u text := $mig$__MIG_U__$mig$;
  mig_v text := $mig$__MIG_V__$mig$;
  mig_w text := $mig$__MIG_W__$mig$;
  rb_t text := $mig$__RB_T__$mig$;
  rb_u text := $mig$__RB_U__$mig$;
  rb_v text := $mig$__RB_V__$mig$;
  rb_w text := $mig$__RB_W__$mig$;
  live text := '__LIVE__';  -- letters of the migrations already applied, e.g. 'tu'
  closed text[] := ARRAY['transcripts','audience_audits','calendar_events','sales_scripts','shared_page_edits'];
  probes jsonb; p jsonb; r text; n int; t text;
  out1 jsonb := '{}'::jsonb; chk jsonb := '{}'::jsonb; snap0 jsonb; snap1 jsonb; snap3 jsonb;
  c1 jsonb; c2 jsonb; alert_green int; alert_red int; sf jsonb; sf_before int; sf_after_green int;
  md_rise text; md_pro text; stamp0 timestamptz; stamp1 timestamptz;
  cnt0 jsonb := '{}'::jsonb; snap3_live jsonb; lt text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- What the catalog says about the five tables and the job, as one comparable value.
  SELECT jsonb_build_object(
    'policies', (SELECT coalesce(jsonb_agg(c.relname||'.'||p.polname||'|'||p.polcmd::text||'|'||p.polroles::regrole[]::text||'|'||
                   coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ORDER BY c.relname||'.'||p.polname||'|'||p.polcmd::text||'|'||p.polroles::regrole[]::text||'|'||
                   coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')), '[]')
                 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    -- the full table and column ACLs (every grantee, every privilege incl. MAINTAIN, grant options), from the catalog
    'table_acl', (SELECT coalesce(jsonb_agg(c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END ORDER BY c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END), '[]')
                 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    'column_acl', (SELECT coalesce(jsonb_agg(c.relname||'.'||t.attname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END ORDER BY c.relname||'.'||t.attname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END), '[]')
                 FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped AND t.attacl IS NOT NULL
                 CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    'new_objects', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') FROM (
                 SELECT p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
                   ('shared_page_edits_load','shared_page_edits_save','public_key_surface_check','public_key_surface_check_alert')
                 UNION ALL SELECT 'table '||relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='shared_page_edit_pages'
                 UNION ALL SELECT 'cron '||jobname FROM cron.job WHERE jobname='public-key-surface-check') s),
    'secdef_fn_anon', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    'rows', (SELECT jsonb_object_agg(s.page_slug, s.cnt) FROM (SELECT e.page_slug, count(*) cnt FROM public.shared_page_edits e GROUP BY 1) s),
    'rows_md5', (SELECT md5(string_agg(page_slug||'|'||item_key||'|'||body||'|'||updated_at::text, E'\n' ORDER BY page_slug, item_key)) FROM public.shared_page_edits)
  ) INTO snap0;
  SELECT count(*) INTO sf_before FROM public.silent_failures WHERE source = 'public-key-surface-check';
  -- How many rows each real role reads in each of the five tables, before anything is applied.
  FOREACH t IN ARRAY closed LOOP
    FOREACH r IN ARRAY ARRAY['service_role','authenticated'] LOOP
      EXECUTE format('set local role %I', r);
      EXECUTE format('select count(*) from public.%I', t) INTO n;
      RESET ROLE;
      cnt0 := cnt0 || jsonb_build_object(r||'|read.'||t, n::text);
    END LOOP;
  END LOOP;

  -- Phase 1: apply what is not live yet.
  IF position('t' IN live) = 0 THEN EXECUTE mig_t; END IF;
  IF position('u' IN live) = 0 THEN EXECUTE mig_u; END IF;
  IF position('v' IN live) = 0 THEN EXECUTE mig_v; END IF;
  IF position('w' IN live) = 0 THEN EXECUTE mig_w; END IF;

  SELECT md5(string_agg(item_key||'|'||body, E'\n' ORDER BY item_key)) INTO md_rise FROM public.shared_page_edits WHERE page_slug='rise-personal-posts-0807';
  SELECT md5(string_agg(item_key||'|'||body, E'\n' ORDER BY item_key)) INTO md_pro FROM public.shared_page_edits WHERE page_slug='proswppp-plan-37386b43';

  -- role, key, kind (q = returns one text, x = statement, result is its row count), sql
  probes := '[]'::jsonb;
  FOREACH t IN ARRAY closed LOOP
    probes := probes || jsonb_build_array(
      jsonb_build_array('anon', 'read.'||t, 'q', format('select count(*)::text from public.%I', t)),
      jsonb_build_array('service_role', 'read.'||t, 'q', format('select count(*)::text from public.%I', t)),
      jsonb_build_array('authenticated', 'read.'||t, 'q', format('select count(*)::text from public.%I', t)));
  END LOOP;
  probes := probes || jsonb_build_array(
    jsonb_build_array('anon', 'listener.calendar', 'q', 'select count(*)::text from (select id,title,start_time,end_time,attendees,meeting_type,platform,meeting_url,is_all_day from public.calendar_events limit 6) s'),
    jsonb_build_array('anon', 'listener.transcripts', 'q', 'select count(*)::text from (select id,title,date,duration_minutes,participants,meeting_type from public.transcripts limit 6) s'),
    jsonb_build_array('anon', 'listener.audits', 'q', 'select count(*)::text from (select prospect_name,onepager_url from public.audience_audits limit 50) s'),
    jsonb_build_array('anon', 'listener.script', 'q', 'select count(*)::text from (select id,name,meeting_type,version,is_active,phases from public.sales_scripts limit 1) s'),
    jsonb_build_array('anon', 'spe.table_insert', 'x', $q$insert into public.shared_page_edits(page_slug,item_key,body) values ('zz-lock-test','direct','x')$q$),
    jsonb_build_array('anon', 'spe.table_update', 'x', $q$update public.shared_page_edits set body = body where page_slug = 'rise-personal-posts-0807'$q$),
    jsonb_build_array('anon', 'spe.table_delete', 'x', $q$delete from public.shared_page_edits where page_slug = 'zz-none'$q$),
    jsonb_build_array('anon', 'spe.registry_read', 'q', 'select count(*)::text from public.shared_page_edit_pages'),
    jsonb_build_array('anon', 'spe.registry_insert', 'x', $q$insert into public.shared_page_edit_pages(page_slug) values ('zz-self-registered')$q$),
    jsonb_build_array('anon', 'spe.load_rise', 'q', $q$select count(*)::text||' '||md5(string_agg(item_key||'|'||body, E'\n' order by item_key)) from public.shared_page_edits_load('rise-personal-posts-0807')$q$),
    jsonb_build_array('anon', 'spe.load_proswppp', 'q', $q$select count(*)::text||' '||md5(string_agg(item_key||'|'||body, E'\n' order by item_key)) from public.shared_page_edits_load('proswppp-plan-37386b43')$q$),
    jsonb_build_array('anon', 'spe.load_unknown', 'q', $q$select count(*)::text from public.shared_page_edits_load('zz-lock-test')$q$),
    jsonb_build_array('anon', 'spe.load_null', 'q', $q$select count(*)::text from public.shared_page_edits_load(null)$q$),
    jsonb_build_array('anon', 'spe.save_unknown', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k1','first')$q$),
    jsonb_build_array('anon', 'spe.save_null_slug', 'x', $q$select public.shared_page_edits_save(null,'k1','first')$q$),
    jsonb_build_array('postgres', 'spe.register_test_slug', 'x', $q$insert into public.shared_page_edit_pages(page_slug) values ('zz-lock-test')$q$),
    jsonb_build_array('anon', 'spe.save_new', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k1','first')$q$),
    jsonb_build_array('postgres', 'spe.saved_body_1', 'q', $q$select body from public.shared_page_edits where page_slug='zz-lock-test' and item_key='k1'$q$),
    jsonb_build_array('anon', 'spe.save_replace', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k1','second')$q$),
    jsonb_build_array('postgres', 'spe.saved_body_2', 'q', $q$select body||' rows='||(select count(*) from public.shared_page_edits where page_slug='zz-lock-test') from public.shared_page_edits where page_slug='zz-lock-test' and item_key='k1'$q$),
    jsonb_build_array('anon', 'spe.save_empty_body', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k2','')$q$),
    jsonb_build_array('anon', 'spe.save_null_body', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k3',null)$q$),
    jsonb_build_array('anon', 'spe.save_empty_key', 'x', $q$select public.shared_page_edits_save('zz-lock-test','','x')$q$),
    jsonb_build_array('anon', 'spe.save_long_key', 'x', $q$select public.shared_page_edits_save('zz-lock-test',repeat('k',201),'x')$q$),
    jsonb_build_array('anon', 'spe.save_body_20000', 'x', $q$select public.shared_page_edits_save('zz-lock-test','big',repeat('b',20000))$q$),
    jsonb_build_array('anon', 'spe.save_body_20001', 'x', $q$select public.shared_page_edits_save('zz-lock-test','big',repeat('b',20001))$q$),
    jsonb_build_array('anon', 'spe.load_test', 'q', $q$select count(*)::text from public.shared_page_edits_load('zz-lock-test')$q$),
    jsonb_build_array('postgres', 'spe.fill_to_200', 'x', $q$insert into public.shared_page_edits(page_slug,item_key,body) select 'zz-lock-test','fill'||g,'x' from generate_series(1,197) g$q$),
    jsonb_build_array('anon', 'spe.save_item_201', 'x', $q$select public.shared_page_edits_save('zz-lock-test','one-too-many','x')$q$),
    jsonb_build_array('anon', 'spe.save_existing_at_cap', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k1','third')$q$),
    jsonb_build_array('anon', 'spe.other_page_untouched', 'q', $q$select count(*)::text from public.shared_page_edits_load('rise-personal-posts-0807')$q$),
    jsonb_build_array('authenticated', 'spe.load_rise', 'q', $q$select count(*)::text from public.shared_page_edits_load('rise-personal-posts-0807')$q$),
    jsonb_build_array('authenticated', 'spe.save', 'x', $q$select public.shared_page_edits_save('zz-lock-test','k1','as-user')$q$),
    jsonb_build_array('service_role', 'spe.load_rise', 'q', $q$select count(*)::text from public.shared_page_edits_load('rise-personal-posts-0807')$q$),
    jsonb_build_array('anon', 'check.run', 'q', 'select count(*)::text from public.public_key_surface_check()'),
    jsonb_build_array('anon', 'check.alert', 'q', 'select public.public_key_surface_check_alert()::text'),
    jsonb_build_array('authenticated', 'check.run', 'q', 'select count(*)::text from public.public_key_surface_check()'),
    jsonb_build_array('service_role', 'check.run', 'q', 'select count(*)::text from public.public_key_surface_check()'));

  SELECT updated_at INTO stamp0 FROM public.shared_page_edits WHERE page_slug='rise-personal-posts-0807' ORDER BY item_key LIMIT 1;
  FOR p IN SELECT * FROM jsonb_array_elements(probes) LOOP
    BEGIN
      IF p->>0 <> 'postgres' THEN EXECUTE format('set local role %I', p->>0); END IF;
      IF p->>2 = 'q' THEN EXECUTE p->>3 INTO r; ELSE EXECUTE p->>3; GET DIAGNOSTICS n = ROW_COUNT; r := 'rows='||n; END IF;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      r := 'E'||SQLSTATE||' '||left(SQLERRM, 60);
    END;
    out1 := out1 || jsonb_build_object((p->>0)||'|'||(p->>1), coalesce(r, 'NULL'));
  END LOOP;
  SELECT updated_at INTO stamp1 FROM public.shared_page_edits WHERE page_slug='rise-personal-posts-0807' ORDER BY item_key LIMIT 1;
  DELETE FROM public.shared_page_edits WHERE page_slug = 'zz-lock-test';
  DELETE FROM public.shared_page_edit_pages WHERE page_slug = 'zz-lock-test';

  -- The daily check on the applied state: green, no row written.
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.check_name) INTO c1 FROM public.public_key_surface_check() c;
  alert_green := public.public_key_surface_check_alert();
  SELECT count(*) INTO sf_after_green FROM public.silent_failures WHERE source = 'public-key-surface-check';
  SELECT jsonb_build_object(
    'policies', (SELECT coalesce(jsonb_agg(c.relname||'.'||p.polname ORDER BY c.relname||'.'||p.polname), '[]') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed) AND 'anon'::regrole = ANY(p.polroles)),
    'anon_any_priv', (SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname), '[]') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
                 AND c.relname = ANY(closed || ARRAY['shared_page_edit_pages'])
                 AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                      OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))),
    'job', (SELECT jsonb_agg(jsonb_build_object('schedule', schedule, 'command', command, 'active', active)) FROM cron.job WHERE jobname='public-key-surface-check')
  ) INTO snap1;

  -- Phase 2: planted faults, one per kind the check watches, plus one "missing". The alert must count all five
  -- checks as off and write one row.
  EXECUTE $f$CREATE FUNCTION public.zz_planted_open_fn() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS 'select 1'$f$;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.shared_page_edits_load(text) FROM anon';
  EXECUTE 'CREATE POLICY zz_planted ON public.calendar_events FOR SELECT TO anon USING (true)';
  EXECUTE 'GRANT SELECT (id) ON TABLE public.calendar_events TO anon';
  EXECUTE 'CREATE VIEW public.zz_planted_view AS SELECT 1 AS one';
  EXECUTE 'CREATE TABLE public.zz_planted_norls (id int)';
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.check_name) INTO c2 FROM public.public_key_surface_check() c;
  alert_red := public.public_key_surface_check_alert();
  SELECT jsonb_agg(jsonb_build_object('source', source, 'detail', detail)) INTO sf FROM public.silent_failures
   WHERE source = 'public-key-surface-check' AND created_at >= transaction_timestamp();
  EXECUTE 'DROP FUNCTION public.zz_planted_open_fn()';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.shared_page_edits_load(text) TO anon';
  EXECUTE 'DROP POLICY zz_planted ON public.calendar_events';
  EXECUTE 'REVOKE SELECT (id) ON TABLE public.calendar_events FROM anon';
  EXECUTE 'DROP VIEW public.zz_planted_view';
  EXECUTE 'DROP TABLE public.zz_planted_norls';
  DELETE FROM public.silent_failures WHERE source = 'public-key-surface-check' AND created_at >= transaction_timestamp();

  -- Phase 3: every rollback, newest first. The catalog must read as the pre-lock state (the state after 20261115q).
  IF position('w' IN live) = 0 THEN EXECUTE rb_w; END IF;
  IF position('v' IN live) = 0 THEN EXECUTE rb_v; END IF;
  IF position('u' IN live) = 0 THEN EXECUTE rb_u; END IF;
  IF position('t' IN live) = 0 THEN EXECUTE rb_t; END IF;
  SELECT jsonb_build_object(
    'policies', (SELECT coalesce(jsonb_agg(c.relname||'.'||p.polname||'|'||p.polcmd::text||'|'||p.polroles::regrole[]::text||'|'||
                   coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ORDER BY c.relname||'.'||p.polname||'|'||p.polcmd::text||'|'||p.polroles::regrole[]::text||'|'||
                   coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')), '[]')
                 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    -- the full table and column ACLs (every grantee, every privilege incl. MAINTAIN, grant options), from the catalog
    'table_acl', (SELECT coalesce(jsonb_agg(c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END ORDER BY c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END), '[]')
                 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    'column_acl', (SELECT coalesce(jsonb_agg(c.relname||'.'||t.attname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END ORDER BY c.relname||'.'||t.attname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||CASE WHEN a.is_grantable THEN '*' ELSE '' END), '[]')
                 FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped AND t.attacl IS NOT NULL
                 CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed)),
    'new_objects', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') FROM (
                 SELECT p.oid::regprocedure::text x FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
                   ('shared_page_edits_load','shared_page_edits_save','public_key_surface_check','public_key_surface_check_alert')
                 UNION ALL SELECT 'table '||relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='shared_page_edit_pages'
                 UNION ALL SELECT 'cron '||jobname FROM cron.job WHERE jobname='public-key-surface-check') s),
    'secdef_fn_anon', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    'rows', (SELECT jsonb_object_agg(s.page_slug, s.cnt) FROM (SELECT e.page_slug, count(*) cnt FROM public.shared_page_edits e GROUP BY 1) s),
    'rows_md5', (SELECT md5(string_agg(page_slug||'|'||item_key||'|'||body||'|'||updated_at::text, E'\n' ORDER BY page_slug, item_key)) FROM public.shared_page_edits)
  ) INTO snap3;

  -- Then the rollbacks of the migrations that were already live, newest first, to prove those still run cleanly.
  FOREACH lt IN ARRAY ARRAY['w','v','u','t'] LOOP
    IF position(lt IN live) > 0 THEN
      EXECUTE CASE lt WHEN 'w' THEN rb_w WHEN 'v' THEN rb_v WHEN 'u' THEN rb_u ELSE rb_t END;
    END IF;
  END LOOP;
  SELECT jsonb_build_object(
    'anon_policies', (SELECT coalesce(jsonb_agg(c.relname||'.'||p.polname ORDER BY c.relname||'.'||p.polname), '[]') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed) AND 'anon'::regrole = ANY(p.polroles)),
    'anon_column_grants', (SELECT count(*) FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid AND t.attnum > 0 AND NOT t.attisdropped AND t.attacl IS NOT NULL
                 CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed) AND a.grantee = 'anon'::regrole),
    'anon_table_grants', (SELECT coalesce(jsonb_agg(c.relname||':'||a.privilege_type ORDER BY c.relname||':'||a.privilege_type), '[]') FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                 WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(closed) AND a.grantee = 'anon'::regrole),
    'new_objects_left', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
                   ('shared_page_edits_load','shared_page_edits_save','public_key_surface_check','public_key_surface_check_alert'))
                 + (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='shared_page_edit_pages')
                 + (SELECT count(*) FROM cron.job WHERE jobname='public-key-surface-check')
  ) INTO snap3_live;

  chk := jsonb_build_object(
    'listener_tables_refused_for_anon', (SELECT bool_and(out1->>('anon|'||k) LIKE 'E42501%') FROM unnest(ARRAY['read.transcripts','read.audience_audits','read.calendar_events','read.sales_scripts','listener.calendar','listener.transcripts','listener.audits','listener.script']) k),
    'service_reads_same_row_counts', (SELECT bool_and(out1->>('service_role|read.'||k) = cnt0->>('service_role|read.'||k) AND (cnt0->>('service_role|read.'||k))::int > 0) FROM unnest(closed) k),
    'signed_in_reads_same_row_counts', (SELECT bool_and(out1->>('authenticated|read.'||k) = cnt0->>('authenticated|read.'||k)) FROM unnest(closed) k),
    'role_row_counts_before', cnt0,
    'spe_table_closed_to_anon', out1->>'anon|read.shared_page_edits' LIKE 'E42501%' AND out1->>'anon|spe.table_insert' LIKE 'E42501%'
        AND out1->>'anon|spe.table_update' LIKE 'E42501%' AND out1->>'anon|spe.table_delete' LIKE 'E42501%',
    'spe_registry_closed_to_anon', out1->>'anon|spe.registry_read' LIKE 'E42501%' AND out1->>'anon|spe.registry_insert' LIKE 'E42501%',
    'spe_load_same_rows_as_table', out1->>'anon|spe.load_rise' = (snap0->'rows'->>'rise-personal-posts-0807')||' '||md_rise
        AND out1->>'anon|spe.load_proswppp' = (snap0->'rows'->>'proswppp-plan-37386b43')||' '||md_pro,
    'spe_unknown_slug_reads_nothing', out1->>'anon|spe.load_unknown' = '0' AND out1->>'anon|spe.load_null' = '0',
    'spe_unknown_slug_save_refused', out1->>'anon|spe.save_unknown' LIKE 'E42501%' AND out1->>'anon|spe.save_null_slug' LIKE 'E42501%',
    'spe_save_adds_then_replaces', out1->>'anon|spe.save_new' = 'rows=1' AND out1->>'postgres|spe.saved_body_1' = 'first'
        AND out1->>'anon|spe.save_replace' = 'rows=1' AND out1->>'postgres|spe.saved_body_2' = 'second rows=1',
    'spe_limits', out1->>'anon|spe.save_empty_body' = 'rows=1' AND out1->>'anon|spe.save_null_body' LIKE 'E22023%'
        AND out1->>'anon|spe.save_empty_key' LIKE 'E22023%' AND out1->>'anon|spe.save_long_key' LIKE 'E22023%'
        AND out1->>'anon|spe.save_body_20000' = 'rows=1' AND out1->>'anon|spe.save_body_20001' LIKE 'E22023%'
        AND out1->>'anon|spe.load_test' = '3' AND out1->>'postgres|spe.fill_to_200' = 'rows=197'
        AND out1->>'anon|spe.save_item_201' LIKE 'E22023%' AND out1->>'anon|spe.save_existing_at_cap' = 'rows=1',
    'spe_real_pages_untouched_by_probes', out1->>'anon|spe.other_page_untouched' = snap0->'rows'->>'rise-personal-posts-0807' AND stamp0 = stamp1,
    'spe_functions_not_for_signed_in', out1->>'authenticated|spe.load_rise' LIKE 'E42501%' AND out1->>'authenticated|spe.save' LIKE 'E42501%',
    'spe_service_can_load', out1->>'service_role|spe.load_rise' = snap0->'rows'->>'rise-personal-posts-0807',
    'check_closed_to_anon_and_signed_in', out1->>'anon|check.run' LIKE 'E42501%' AND out1->>'anon|check.alert' LIKE 'E42501%' AND out1->>'authenticated|check.run' LIKE 'E42501%',
    'check_service_can_run', out1->>'service_role|check.run' = '5',
    'check_green_on_applied_state', (SELECT bool_and((e->>'ok')::boolean) AND count(*) = 5 FROM jsonb_array_elements(c1) e),
    'check_expected_values', (SELECT jsonb_object_agg(e->>'check_name', (e->>'expected')||'/'||(e->>'actual')) FROM jsonb_array_elements(c1) e),
    'alert_green_returns_0_and_writes_nothing', alert_green = 0 AND sf_after_green = sf_before,
    'applied_state', snap1,
    'check_red_on_planted_faults', (SELECT jsonb_object_agg(e->>'check_name', (e->>'ok')||' '||(e->>'expected')||'/'||(e->>'actual')||' +['||(e->>'not_expected')||'] -['||(e->>'missing')||']') FROM jsonb_array_elements(c2) e),
    'alert_red_returns_5_and_writes_one_row', alert_red = 5 AND jsonb_array_length(coalesce(sf, '[]'::jsonb)) = 1,
    'alert_row', sf,
    'rollback_back_to_start_state_exact', snap3 = snap0,
    'rollback_state', snap3 - 'rows_md5',
    'after_every_rollback_incl_live_ones', snap3_live,
    'rows_identical_after_rollback', snap3->>'rows_md5' = snap0->>'rows_md5',
    'start_state', snap0 - 'rows_md5');

  RAISE EXCEPTION 'RESULT %', jsonb_build_object('checks', chk, 'probes', out1);
END
$t$;
