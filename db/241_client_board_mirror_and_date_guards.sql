-- The client boards show what the post actually is, whoever edits it (Ivan 2026-10-08: "ensure
-- compatibility between content section here and each client panels for when i change media or
-- add media, change copy, dates, time").
--
-- The panels render copy, title and pictures from a cached queue in client_boards.board. Only some
-- writers patched it (client_board_edit_draft_v2, _client_board_apply_media); the inbox copy save
-- (operator_edit_draft_body), n8n rewrites and status changes did not, so Mattan and Davorin kept
-- reading an old body until an unrelated queue sync, and a panel save from that stale body undid
-- Ivan's edit. From here a row change on carousel_drafts patches its queue entry directly:
-- body / post_body / hook on a copy change, title, the picture fields, the date and the stage.
-- Only the fields that changed, only boards of the row's own client, only an entry already there
-- (adding or dropping entries stays with the queue sync).
create or replace function public.client_board_mirror_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p jsonb := '{}'::jsonb;
  v_first text;
begin
  if new.client_id is null then return new; end if;
  if new.post_body is distinct from old.post_body and coalesce(btrim(new.post_body), '') <> '' and new.status <> 'generating' then
    v_first := nullif(btrim(split_part(btrim(new.post_body, E' \n\r\t'), E'\n', 1)), '');
    p := p || jsonb_build_object('body', new.post_body, 'post_body', new.post_body)
           || case when v_first is not null then jsonb_build_object('hook', v_first) else '{}'::jsonb end;
  end if;
  if new.title is distinct from old.title and coalesce(btrim(new.title), '') <> '' then
    p := p || jsonb_build_object('title', new.title);
  end if;
  if new.image_urls is distinct from old.image_urls and new.status <> 'generating' then
    p := p || jsonb_build_object(
      'image_urls', to_jsonb(coalesce(new.image_urls, ARRAY[]::text[])),
      'image', new.image_urls[1],
      'media_url', new.image_urls[1],
      -- An empty picture is a choice the board must show (no display-only decoration).
      'no_photo', coalesce(array_length(new.image_urls, 1), 0) = 0 and coalesce(new.type, 'text') in ('text', 'single_image'));
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    p := p || jsonb_build_object('scheduled_at', new.scheduled_at,
      'publish_date', to_char(new.scheduled_at at time zone 'UTC', 'YYYY-MM-DD'));
  end if;
  if new.published_at is distinct from old.published_at then
    p := p || jsonb_build_object('published_at', new.published_at);
  end if;
  if new.status is distinct from old.status and new.status in ('review', 'scheduled', 'published') then
    p := p || jsonb_build_object('stage', new.status);
  end if;
  if p = '{}'::jsonb then return new; end if;
  update public.client_boards b
     set board = jsonb_set(b.board, '{queue}', (
       select jsonb_agg(case when q->>'id' = new.id::text then q || p else q end order by ord)
         from jsonb_array_elements(b.board->'queue') with ordinality as t(q, ord)))
   where b.client_id = new.client_id
     and jsonb_typeof(b.board->'queue') = 'array'
     and b.board->'queue' @> jsonb_build_array(jsonb_build_object('id', new.id::text));
  return new;
end $$;
revoke execute on function public.client_board_mirror_draft() from public, anon, authenticated;

drop trigger if exists client_board_mirror_draft on public.carousel_drafts;
create trigger client_board_mirror_draft
  after update of post_body, title, image_urls, scheduled_at, published_at, status on public.carousel_drafts
  for each row when (new.client_id is not null)
  execute function public.client_board_mirror_draft();

-- A carousel's queue row keeps its deck; a date is never set in the past.
CREATE OR REPLACE FUNCTION public.tg_carousel_drafts_propagate_media()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only propagate when image_urls actually changed AND the draft is in a
  -- state where a scheduled_posts row likely exists (scheduled or published).
  -- Published rows are still patched so re-publishes / write-backs see the
  -- canonical URL.
  -- 2026-10-08: never for a carousel. Its queue row carries the deck PDF the Bridge set
  -- ([pdf_url]); copying the slide images over it would publish the carousel as one image.
  IF NEW.image_urls IS DISTINCT FROM OLD.image_urls
     AND NEW.status IN ('scheduled', 'published')
     AND coalesce(NEW.type, '') <> 'carousel' THEN
    UPDATE public.scheduled_posts
       SET media_urls = NEW.image_urls
     WHERE clickup_task_id = NEW.id::text
       AND status IN ('pending', 'queued_v2');
  END IF;

  -- THE COPY, same rule, added 2026-08-11. Deliberately NOT gated on status:
  -- the edit that matters most is the one Ivan makes on a row sitting in review
  -- with a queue slot already booked, and that edit has to reach the table that
  -- fires. An empty or whitespace-only body is never propagated, and a draft
  -- mid-regeneration is left alone.
  IF NEW.post_body IS DISTINCT FROM OLD.post_body
     AND NEW.post_body IS NOT NULL
     AND length(btrim(NEW.post_body)) > 0
     AND NEW.status <> 'generating' THEN
    UPDATE public.scheduled_posts
       SET post_text = NEW.post_body
     WHERE clickup_task_id = NEW.id::text
       AND status IN ('pending', 'queued_v2')
       AND post_text IS DISTINCT FROM NEW.post_body;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d carousel_drafts;
  v_at timestamptz;
  v_queued int := 0;
  v_sync bigint;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;
  select * into d from carousel_drafts where id = p_draft_id;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if d.status not in ('review', 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', d.status);
  end if;
  -- 2026-10-08: a date in the past publishes on the next tick (both publishers poll every
  -- 10 min). Clearing the date (null) is always allowed.
  if p_scheduled_at is not null and p_scheduled_at < now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'past_date');
  end if;
  update carousel_drafts set scheduled_at = p_scheduled_at
   where id = p_draft_id
   returning scheduled_at into v_at;
  if v_at is not null then
    update scheduled_posts set scheduled_at = v_at
     where clickup_task_id = p_draft_id::text
       and status = 'pending'
       and scheduled_at is distinct from v_at;
    get diagnostics v_queued = row_count;
  end if;
  -- Calendar 2026-10-01: the client board renders a cached queue; a date move on a row
  -- the client can see must rebuild it (same call operator_set_board_visible makes).
  if d.client_id is not null and d.board_visible is true then
    select net.http_post(
      url := 'https://n8n.ivanmanfredi.com/webhook/client-board-queue-sync?k=6098d6f092c50f5f1894fd61',
      body := jsonb_build_object('client_id', d.client_id),
      headers := '{"Content-Type":"application/json"}'::jsonb
    ) into v_sync;
  end if;
  return jsonb_build_object('ok', true, 'id', p_draft_id, 'scheduled_at', v_at,
    'requested_at', p_scheduled_at, 'queue_retimed', v_queued, 'status', d.status, 'sync_request_id', v_sync);
end; $function$;
