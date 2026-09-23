-- Author notes are neither published posts nor transcript quotations.
-- Additive only. Existing immutable source rows and permissions are unchanged.
begin;
alter table public.editorial_sources drop constraint editorial_sources_kind_chk;
alter table public.editorial_sources add constraint editorial_sources_kind_chk
  check (source_kind in ('candidate','market_study','call','own_post','asset','public_post','author_note'));
alter table public.editorial_sources drop constraint if exists editorial_sources_author_note_chk;
alter table public.editorial_sources add constraint editorial_sources_author_note_chk check (
  source_kind <> 'author_note' or coalesce((
    source_client_scope = client_id and source_published_at is null
    and published_date_state = 'unknown'
    and permission_state in ('unknown','granted','withheld','denied')
    and nullif(btrim(passage),'') is not null
    and nullif(btrim(body_sha256),'') is not null
    and passage = candidate_fields->'author_note_contract'->>'original_user_statement'
    and body_sha256 = encode(sha256(convert_to(passage,'UTF8')),'hex')
    and coalesce(candidate_fields->'author_note_contract'->>'origin_state','') = 'user_confirmed_themes'
    and coalesce(candidate_fields->'author_note_contract'->>'passage_is_exact_confirmation','') = 'true'
    and coalesce(candidate_fields->'author_note_contract'->>'not_an_exact_story_quote','') = 'true'
    and coalesce(candidate_fields->'author_note_contract'->>'public_release_hold','') = 'true'
    and nullif(btrim(candidate_fields->'author_note_contract'->>'origin_pointer'),'') is not null
    and jsonb_typeof(candidate_fields->'author_note_contract'->'confirmed_fields') = 'array'
    and jsonb_typeof(candidate_fields->'author_note_contract'->'unknown_fields') = 'array'
    and jsonb_array_length(candidate_fields->'author_note_contract'->'confirmed_fields') > 0
    and jsonb_array_length(candidate_fields->'author_note_contract'->'unknown_fields') > 0
  ), false)
);
commit;
