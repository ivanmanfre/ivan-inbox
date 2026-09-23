-- Non-destructive rollback. Imported notes get a new withheld head; immutable
-- earlier versions remain readable in their original manifests. Refresh already
-- excludes denied/withheld heads. No evidence is deleted or relabelled.
begin;
lock table public.editorial_sources in share row exclusive mode;
insert into public.editorial_sources
  (client_id,source_id,seen_version,source_kind,source_client_scope,source_url,
   excerpt_pointer,owner,source_published_at,published_date_state,captured_at,
   body_sha256,passage,retained_context,limitation,independent,derived_from,
   permission_state,gap_state,candidate_fields,snapshot_hash)
select client_id,source_id,seen_version+1,source_kind,source_client_scope,source_url,
   excerpt_pointer,owner,source_published_at,published_date_state,now(),
   body_sha256,passage,retained_context,limitation,independent,derived_from,
   'withheld',jsonb_build_object('reason','permission_denied','detail','Author-note import withdrawn by migration 209 rollback.'),
   candidate_fields,encode(sha256(convert_to(snapshot_hash||':withdraw209:'||seen_version::text,'UTF8')),'hex')
from (select distinct on (client_id,source_id) * from public.editorial_sources
      where source_kind='author_note' order by client_id,source_id,seen_version desc) latest
where permission_state not in ('withheld','denied');
do $$ begin
  if not exists (select 1 from public.editorial_sources where source_kind='author_note') then
    alter table public.editorial_sources drop constraint if exists editorial_sources_author_note_chk;
    alter table public.editorial_sources drop constraint editorial_sources_kind_chk;
    alter table public.editorial_sources add constraint editorial_sources_kind_chk
      check (source_kind in ('candidate','market_study','call','own_post','asset','public_post'));
  end if;
end $$;
commit;
