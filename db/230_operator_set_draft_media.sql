-- 230 — operator_set_draft_media: change or remove a post's picture from the
-- inbox, on every lane, through ONE gated write (content-images-2026-09-29).
--
-- 🔴 NOT APPLIED. Shipped as a file. The app's Picture row calls this RPC, so
-- apply it BEFORE the inbox build that calls it goes out.
--
-- WHY
-- Ivan, 29 Sep: "can't do basic shit like change the pictures from there".
-- The inbox had no way to change a CLIENT post's picture (setDraftImage is
-- scoped `.is('client_id', null)`), and a direct image_urls write on a client
-- row is wrong twice over: the client board renders a cached copy of the queue
-- (client_boards.board->'queue'), and the RISE Photo Assigner treats the
-- `set_media` row in client_board_actions as the authoritative pick. Both are
-- done by the existing _client_board_apply_media, so client rows go through it
-- unchanged, with p_by = 'operator'.
--
-- THE RULES, AND WHERE EACH ONE COMES FROM
--   · gate first                                        -> 'bad_gate'
--     (operator_set_board_visible / operator_set_schedule_date, verbatim)
--   · p_url longer than 2000 or not https               -> 'bad_url'
--     (the 2000 cap is _client_board_apply_media's own; https is ours: every
--      picture this app pins is a public storage URL)
--   · no such row                                       -> 'not_found'
--   · type not text / single_image                      -> 'not_single_photo'
--     BOTH lanes. image_urls is replaced wholesale, so one picture on a
--     carousel IS the deck being replaced by one image, and the propagate
--     trigger pushes that to scheduled_posts.media_urls. The inner function
--     only refuses SCHEDULED carousels; a review carousel on a client lane
--     would still lose its slides, so the wrapper refuses it first.
--   · published_at set                                  -> 'published'
--
--   CLIENT ROW (client_id is not null)
--   · the board is `client_boards where client_id = d.client_id`. `=` never
--     matches NULL, so the fourteen prospect boards that carry client_id NULL
--     can never be picked for a client draft. Exactly one board or refuse:
--       zero -> 'no_board', more than one -> 'ambiguous_board'
--   · then _client_board_apply_media(v_board, v_board.slug, id, url, 'operator'):
--     status must be review or scheduled ('draft_not_editable'), a scheduled
--     row must be single-photo ('unschedule_first'); it writes image_urls,
--     patches the board's queue copy (media_url, image, image_urls, no_photo),
--     and logs `set_media`. Its refusals come back to the caller unchanged.
--     No queue-sync webhook is needed for the picture: the blob is patched in
--     place.
--   · 🔴 ARCH: the ARCH publisher (JfZldgbf22AbG9ew) posts rows at status
--     'review' without approval. This function writes image_urls, updated_at,
--     the board blob and one action row. It never writes status, scheduled_at,
--     board_visible or published_at, on either lane.
--
--   IVAN ROW (client_id is null)
--   · status in ('review','approved','scheduled')       -> else 'bad_status'
--   · image_urls = [url], or [] on removal
--   · taxonomy.no_photo = true on removal, false on attach. The Text Post
--     Photo Assigner (NuQTHLHmOOC6U6tf, every 10 min) skips a row carrying
--     no_photo = true (live since 2026-09-29 16:48Z); without the stamp a
--     removal came back within ten minutes.
--     taxonomy is merged the way the app's stampTaxonomy merges it: an object
--     keeps its keys, a legacy bare-string taxonomy becomes
--     {structure_used: <string>}, anything else starts from {}.
--   · the UPDATE repeats every predicate; if it matches no row (the draft
--     moved between the read and the write) the function RAISES, so a caller
--     can never read success off a write that did not happen.
--
-- NOT touched: taxonomy.human_edited (a picture pick is not a copy edit; the
-- same reason setDraftImage gives), status, dates, board visibility.
--
-- Triggers that fire on the Ivan write, all intended: touch_updated_at;
-- carousel_drafts_propagate_media (a SCHEDULED row's new picture reaches its
-- pending scheduled_posts row); the editorial forecast trigger on scheduled
-- rows. protect_human_edited_draft only intercepts service_role, and the
-- operator's JWT role is authenticated, so it passes the write through.
--
-- Grants: the house shape (db/032, db/039). Supabase's default privileges give
-- EXECUTE to authenticated; this revokes it from public and anon, so the
-- operator login can call it and the anon key cannot.
--
-- Rollback: db/230_operator_set_draft_media_rollback.sql

CREATE OR REPLACE FUNCTION public.operator_set_draft_media(p_gate text, p_draft_id uuid, p_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d carousel_drafts;
  v_board client_boards;
  v_boards int;
  v_clear boolean;
  v_res jsonb;
  v_n int;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;

  v_clear := coalesce(p_url, '') = '';
  if not v_clear and (length(p_url) > 2000 or p_url !~ '^https://') then
    return jsonb_build_object('ok', false, 'error', 'bad_url');
  end if;

  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(d.type, '') not in ('text', 'single_image') then
    return jsonb_build_object('ok', false, 'error', 'not_single_photo', 'type', d.type);
  end if;
  if d.published_at is not null then
    return jsonb_build_object('ok', false, 'error', 'published');
  end if;

  -- ---- a client's post: the board's own write path ------------------------
  if d.client_id is not null then
    select count(*) into v_boards from client_boards where client_id = d.client_id;
    if v_boards = 0 then
      return jsonb_build_object('ok', false, 'error', 'no_board', 'client_id', d.client_id);
    end if;
    if v_boards > 1 then
      return jsonb_build_object('ok', false, 'error', 'ambiguous_board', 'client_id', d.client_id);
    end if;
    select * into v_board from client_boards where client_id = d.client_id;
    v_res := _client_board_apply_media(v_board, v_board.slug, p_draft_id, nullif(p_url, ''), 'operator');
    if coalesce((v_res ->> 'ok')::boolean, false) then
      return v_res || jsonb_build_object('id', p_draft_id, 'client_id', d.client_id, 'slug', v_board.slug);
    end if;
    return v_res;
  end if;

  -- ---- Ivan's own post -----------------------------------------------------
  if d.status not in ('review', 'approved', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;

  update carousel_drafts
     set image_urls = case when v_clear then ARRAY[]::text[] else ARRAY[p_url]::text[] end,
         taxonomy = (case jsonb_typeof(taxonomy)
                       when 'object' then taxonomy
                       when 'string' then case when btrim(taxonomy #>> '{}') = '' then '{}'::jsonb
                                               else jsonb_build_object('structure_used', btrim(taxonomy #>> '{}')) end
                       else '{}'::jsonb
                     end) || jsonb_build_object('no_photo', v_clear),
         updated_at = now()
   where id = p_draft_id
     and client_id is null
     and status in ('review', 'approved', 'scheduled')
     and published_at is null
     and type in ('text', 'single_image');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'operator_set_draft_media: draft % changed before the write; nothing was updated', p_draft_id;
  end if;

  return jsonb_build_object('ok', true, 'id', p_draft_id, 'media_url', coalesce(p_url, ''), 'no_photo', v_clear);
end; $function$;

REVOKE EXECUTE ON FUNCTION public.operator_set_draft_media(text, uuid, text) FROM public, anon;
