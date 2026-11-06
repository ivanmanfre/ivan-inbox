-- 20261106 operator_set_draft_photos: set the whole photo list of one of Ivan's
-- LinkedIn posts from the inbox (multi-photo build, report items #4 and #44).
--
-- WHY
-- Ivan, 6 Nov: X outlier copies should come into his lane "including the pics".
-- The Rome draft 2aa68333 has 3 photos. The Scheduled Post Publisher
-- (0Ym6bP7gEmskPJZn) now posts every photo in one LinkedIn post, so the inbox
-- has to show and edit the list, not only image_urls[0]. db/230
-- operator_set_draft_media writes ONE url (image_urls = [url]), so removing one
-- photo of three through it would drop the other two.
--
-- THE RULES (db/230's, plus the list ones)
--   · gate first                                        -> 'bad_gate'
--   · Ivan rows only (client_id is null)                -> 'client_row'
--     Client lanes keep db/230: their publishers post one photo, and client
--     rows go through the board's own _client_board_apply_media.
--   · more than 9 urls                                  -> 'too_many_photos'
--     (the publisher's Publish Lint Gate blocks a set over 9; same cap here so
--      the inbox never stores a list that cannot post)
--   · any url empty, longer than 2000 or not https      -> 'bad_url'
--   · the same url twice                                -> 'duplicate_photo'
--   · no such row                                       -> 'not_found'
--   · type not text / single_image                      -> 'not_single_photo'
--     (a carousel is one PDF, a video is one mp4; neither takes a photo list)
--   · published_at set                                  -> 'published'
--   · status not review / approved / scheduled          -> 'bad_status'
--   · its LinkedIn queue row is mid-publish ('posting') -> 'posting_now'
--     (the publisher already holds the photos; a change now would show in the
--      app and not on the post)
--   · calendar lock busy                                -> 'calendar_busy'
--
-- LOCKS (Sol r1): the same order as scheduled_post_claim_if_unchanged and the
-- calendar RPCs: the 'content-plan:ivan' advisory lock first, then the draft row
-- FOR UPDATE, so taxonomy is read and written under one lock (no lost
-- photo_options or concurrent taxonomy keys) and a claim cannot start between
-- the 'posting' check and the write. The propagate trigger then touches
-- scheduled_posts, after both locks, as the claim does.
--
-- WHAT IT WRITES (Ivan row)
--   · image_urls = p_urls in the given order (the order they post in). [] = text only.
--   · taxonomy.no_photo = (list is empty), exactly like db/230, so the Text
--     Post Photo Assigner leaves a bare post bare.
--   · taxonomy.photo_options = every photo this post has had: the old options,
--     then the old image_urls, then the new list, de-duplicated, at most 24.
--     The inbox draws these as the option row, so a removed photo stays one tap
--     away (the X quick-post rule Ivan accepted on 6 Nov, PR #87).
--   · the UPDATE repeats every predicate and RAISES if it matched nothing.
-- NOT touched: status, dates, board visibility, taxonomy.human_edited.
--
-- Triggers: carousel_drafts_propagate_media copies the new list onto a
-- scheduled row's pending scheduled_posts row; the publisher's Dedup Guard
-- re-reads image_urls at send time either way.
--
-- Grants: house shape (db/230): revoked from public and anon.
-- Rollback: db/20261106_operator_set_draft_photos_rollback.sql

CREATE OR REPLACE FUNCTION public.operator_set_draft_photos(p_gate text, p_draft_id uuid, p_urls text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET lock_timeout TO '2s'
AS $function$
declare
  d carousel_drafts;
  v_urls text[] := coalesce(p_urls, ARRAY[]::text[]);
  v_tax jsonb;
  v_old_opts text[];
  v_opts text[];
  v_n int;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  if cardinality(v_urls) > 9 then
    return jsonb_build_object('ok', false, 'error', 'too_many_photos', 'count', cardinality(v_urls));
  end if;
  if exists (select 1 from unnest(v_urls) u where u is null or u = '' or length(u) > 2000 or u !~ '^https://') then
    return jsonb_build_object('ok', false, 'error', 'bad_url');
  end if;
  if (select count(distinct u) from unnest(v_urls) u) <> cardinality(v_urls) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_photo');
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('content-plan:ivan', 0)) then
    return jsonb_build_object('ok', false, 'error', 'calendar_busy');
  end if;
  select * into d from carousel_drafts where id = p_draft_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if d.client_id is not null then
    return jsonb_build_object('ok', false, 'error', 'client_row');
  end if;
  if coalesce(d.type, '') not in ('text', 'single_image') then
    return jsonb_build_object('ok', false, 'error', 'not_single_photo', 'type', d.type);
  end if;
  if d.published_at is not null then
    return jsonb_build_object('ok', false, 'error', 'published');
  end if;
  if d.status not in ('review', 'approved', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  if exists (select 1 from scheduled_posts sp where sp.clickup_task_id = p_draft_id::text and sp.status = 'posting') then
    return jsonb_build_object('ok', false, 'error', 'posting_now');
  end if;

  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb
           end;
  v_old_opts := case when jsonb_typeof(v_tax -> 'photo_options') = 'array'
                     then array(select jsonb_array_elements_text(v_tax -> 'photo_options'))
                     else ARRAY[]::text[] end;
  -- first appearance wins the position: old options, then old photos, then the new list
  select coalesce(array_agg(u order by first_pos), ARRAY[]::text[]) into v_opts
    from (select u, min(pos) first_pos
            from unnest(v_old_opts || coalesce(d.image_urls, ARRAY[]::text[]) || v_urls) with ordinality as t(u, pos)
           where u ~ '^https://'
           group by u
           order by min(pos)
           limit 24) x;

  update carousel_drafts
     set image_urls = v_urls,
         taxonomy = v_tax || jsonb_build_object('no_photo', cardinality(v_urls) = 0, 'photo_options', to_jsonb(v_opts)),
         updated_at = now()
   where id = p_draft_id
     and client_id is null
     and status in ('review', 'approved', 'scheduled')
     and published_at is null
     and type in ('text', 'single_image');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'operator_set_draft_photos: draft % changed before the write; nothing was updated', p_draft_id;
  end if;

  return jsonb_build_object('ok', true, 'id', p_draft_id, 'image_urls', to_jsonb(v_urls), 'photo_options', to_jsonb(v_opts), 'no_photo', cardinality(v_urls) = 0);
end; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_set_draft_photos(text, uuid, text[]) FROM public, anon;
