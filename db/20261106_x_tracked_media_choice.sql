-- 20261106 — operator_set_draft_media_choice: Video / Photos / Text only on a
-- copied X-outlier draft (report item #29, 2026-11-06).
--
-- WHY
-- The X ingestor (n8n 99LHX3WdkXcjoeoA) now copies the tracked tweet's video
-- into storage (post-videos/x-tracked/<handle>/<tweet_id>.mp4) next to its
-- photos and poster frame, and records the copies on
-- source_detail.media_copy = {video_url, poster_url, photo_urls[], ...}.
-- A fresh draft defaults to the video (Ivan wants the source's media).
-- LinkedIn cannot post a video and photos together, so Ivan picks one in the
-- inbox card. This is the write behind that switch.
--
-- WHAT EACH CHOICE WRITES (Ivan's own drafts only, client_id is null)
--   video   type 'video', video_url = media_copy.video_url,
--           image_urls = [media_copy.poster_url] (the inbox shows image_urls[0]
--           as the still; the bridge and publisher post video_url for type video)
--   photos  type 'text', video_url null, image_urls = media_copy.photo_urls
--   text    type 'text', video_url null, image_urls = [], taxonomy.no_photo = true
--           (the selfie assigner skips no_photo rows)
--   taxonomy.media_choice = the choice. no_photo = (choice = 'text').
--
-- REFUSALS
--   bad_gate, bad_choice, not_found, not_ivan, published, bad_status
--   (review / approved / scheduled only), not_text_or_video (never a carousel
--   or single_image row), no_media_copy, no_video, no_photos,
--   posting (the publisher has claimed a queue row and is sending it),
--   ig_queued (a pending Instagram row exists: the bridge only fans a video
--   out to IG, and switching under it would leave a stale Reel queued).
--
-- QUEUE
-- A scheduled draft may already have its pending LinkedIn row. The media
-- trigger copies image_urls onto it, which would make a video post publish its
-- poster jpg. So after the draft write this function sets that row's
-- post_format and media_urls itself: [video_url] for video, the image_urls
-- otherwise. The publisher re-reads the draft at send time too
-- (canonicalSendMedia), but post_format comes only from the queue row.
--
-- The UPDATE repeats the predicates; no row matched = RAISE (nothing written).
-- Grants: house shape (db/230). Rollback: db/20261106_x_tracked_media_choice_rollback.sql

CREATE OR REPLACE FUNCTION public.operator_set_draft_media_choice(p_gate text, p_draft_id uuid, p_choice text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d carousel_drafts;
  v_copy jsonb;
  v_video text;
  v_poster text;
  v_photos text[];
  v_type text;
  v_vurl text;
  v_imgs text[];
  v_tax jsonb;
  v_n int;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  if coalesce(p_choice, '') not in ('video', 'photos', 'text') then
    return jsonb_build_object('ok', false, 'error', 'bad_choice');
  end if;

  -- Locked: a concurrent copy edit or ingestor write waits, so the taxonomy merged below is current (Sol r1 #5).
  select * into d from carousel_drafts where id = p_draft_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.client_id is not null then return jsonb_build_object('ok', false, 'error', 'not_ivan'); end if;
  if d.published_at is not null then return jsonb_build_object('ok', false, 'error', 'published'); end if;
  if d.status not in ('review', 'approved', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  if coalesce(d.type, '') not in ('text', 'video') then
    return jsonb_build_object('ok', false, 'error', 'not_text_or_video', 'type', d.type);
  end if;

  v_copy := case when jsonb_typeof(d.source_detail -> 'media_copy') = 'object' then d.source_detail -> 'media_copy' end;
  if v_copy is null then return jsonb_build_object('ok', false, 'error', 'no_media_copy'); end if;
  v_video := nullif(v_copy ->> 'video_url', '');
  v_poster := nullif(v_copy ->> 'poster_url', '');
  v_photos := coalesce(array(
    select x from jsonb_array_elements_text(case when jsonb_typeof(v_copy -> 'photo_urls') = 'array' then v_copy -> 'photo_urls' else '[]'::jsonb end) x
     where x ~ '^https://'), ARRAY[]::text[]);

  if p_choice = 'video' then
    if v_video is null or v_video !~ '^https://' then return jsonb_build_object('ok', false, 'error', 'no_video'); end if;
    v_type := 'video'; v_vurl := v_video;
    v_imgs := case when v_poster ~ '^https://' then ARRAY[v_poster] else ARRAY[]::text[] end;
  elsif p_choice = 'photos' then
    if cardinality(v_photos) = 0 then return jsonb_build_object('ok', false, 'error', 'no_photos'); end if;
    v_type := 'text'; v_vurl := null; v_imgs := v_photos;
  else
    v_type := 'text'; v_vurl := null; v_imgs := ARRAY[]::text[];
  end if;

  -- Lock the draft's queue rows too: the publisher claims a row by setting it to 'posting'
  -- (scheduled_post_claim_if_unchanged). Mid-send = refuse, so the draft never disagrees with what posts (Sol r1 #4).
  perform 1 from scheduled_posts where clickup_task_id = p_draft_id::text for update;
  if exists (select 1 from scheduled_posts where clickup_task_id = p_draft_id::text and status = 'posting') then
    return jsonb_build_object('ok', false, 'error', 'posting');
  end if;
  if exists (select 1 from scheduled_posts
              where clickup_task_id = p_draft_id::text and platform = 'instagram' and status in ('pending', 'queued_v2')) then
    return jsonb_build_object('ok', false, 'error', 'ig_queued');
  end if;

  v_tax := (case jsonb_typeof(d.taxonomy)
              when 'object' then d.taxonomy
              when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                      else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
              else '{}'::jsonb
            end) || jsonb_build_object('media_choice', p_choice, 'no_photo', p_choice = 'text');

  update carousel_drafts
     set type = v_type, video_url = v_vurl, image_urls = v_imgs, taxonomy = v_tax, updated_at = now()
   where id = p_draft_id
     and client_id is null
     and published_at is null
     and status in ('review', 'approved', 'scheduled')
     and type in ('text', 'video');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'operator_set_draft_media_choice: draft % changed before the write; nothing was updated', p_draft_id;
  end if;

  update scheduled_posts
     set post_format = v_type,
         media_urls = case when v_type = 'video' then ARRAY[v_vurl] else v_imgs end
   where clickup_task_id = p_draft_id::text
     and platform = 'linkedin'
     and status in ('pending', 'queued_v2');

  return jsonb_build_object('ok', true, 'id', p_draft_id, 'choice', p_choice, 'type', v_type,
                            'video_url', v_vurl, 'image_urls', to_jsonb(v_imgs));
end; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_set_draft_media_choice(text, uuid, text) FROM public, anon;
