-- Revert only the explicit GPT checks exception; preserve truthful historical rows.
BEGIN;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.cb22_promote(text,text,text,jsonb)'::regprocedure);
BEGIN
 IF position($old$  if p_mode = 'checks' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'checks', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.platform = v_j ->> 'platform' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'engagement', '') not in ('idea', 'job_ad', 'repost', 'borrowed_media', 'paid_promo', 'bait', 'announcement')
         or coalesce(v_j ->> 'topic', '') not in ('direct', 'stretch') or coalesce(v_j ->> 'audience', '') not in ('reader', 'adjacent', 'other')
         or coalesce(btrim(v_j ->> 'reason'), '') = ''
         or (coalesce(v_j ->> 'served_model', '') not like '%opus%' and not (coalesce(v_j ->> 'client','') = 'swishdm' and coalesce(v_j ->> 'served_model','') = 'gpt-6.1-sol')) or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
$old$ in d)=0 THEN RAISE EXCEPTION '285 checks provider guard drift'; END IF;
 EXECUTE replace(d,$old$  if p_mode = 'checks' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'checks', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.platform = v_j ->> 'platform' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'engagement', '') not in ('idea', 'job_ad', 'repost', 'borrowed_media', 'paid_promo', 'bait', 'announcement')
         or coalesce(v_j ->> 'topic', '') not in ('direct', 'stretch') or coalesce(v_j ->> 'audience', '') not in ('reader', 'adjacent', 'other')
         or coalesce(btrim(v_j ->> 'reason'), '') = ''
         or (coalesce(v_j ->> 'served_model', '') not like '%opus%' and not (coalesce(v_j ->> 'client','') = 'swishdm' and coalesce(v_j ->> 'served_model','') = 'gpt-6.1-sol')) or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
$old$,$new$  if p_mode = 'checks' then
    v_ok := 0; v_bad := 0;
    for v_j in select * from jsonb_array_elements(coalesce(p_payload -> 'checks', '[]'::jsonb)) loop
      if not exists (select 1 from pg_temp.cb22_cand c where c.client_id = v_j ->> 'client' and c.platform = v_j ->> 'platform' and c.post_id = v_j ->> 'post_id')
         or coalesce(v_j ->> 'engagement', '') not in ('idea', 'job_ad', 'repost', 'borrowed_media', 'paid_promo', 'bait', 'announcement')
         or coalesce(v_j ->> 'topic', '') not in ('direct', 'stretch') or coalesce(v_j ->> 'audience', '') not in ('reader', 'adjacent', 'other')
         or coalesce(btrim(v_j ->> 'reason'), '') = ''
         or coalesce(v_j ->> 'served_model', '') not like '%opus%' or coalesce(v_j ->> 'prompt_sha256', '') !~ '^[0-9a-f]{64}$' then
        v_bad := v_bad + 1; continue;
      end if;
$new$);
END
$patch$;
COMMIT;
