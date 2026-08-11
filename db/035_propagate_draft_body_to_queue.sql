-- 035 — the copy the calendar shows and the copy the publisher fires stop drifting.
--
-- Ivan, 2026-08-11: "whatever appears on calendar is not what truly gets posted".
--
-- MEASURED, live, the day of the report: 8 of the 16 pending queue rows held a
-- DIFFERENT POST from the carousel_drafts row they were bridged from — not a
-- typo apart, a different hook and a different opener (2026-08-18 draft opens
-- "Niching down dropped my pipeline before it lifted it", its queue row opens
-- "A few months back I cut what I do down to one thing"). Every one of the 8
-- drafts was updated AFTER its queue row was created.
--
-- WHY: `Bridge: carousel_drafts → scheduled_posts` (yzXqLDIpuNzuhUQq) copies
-- post_body into scheduled_posts.post_text ONCE, at insert, and from then on
-- re-syncs `scheduled_at` and NOTHING ELSE. Edit or regenerate the draft after
-- it was bridged and the queue keeps the pre-edit copy forever. The board and
-- the calendar read carousel_drafts; the publisher fires scheduled_posts.
--
-- The publisher does re-read the draft at SEND time (Dedup Guard, 2026-08-09),
-- but that repair is fail-soft and needs the draft to still exist: 8 of the same
-- 16 pending rows point at drafts that are gone from every table in the database,
-- and those publish their stale snapshot with nothing to compare against.
-- Syncing at EDIT time is the fix that does not depend on any of that.
--
-- The precedent is already in this schema: tg_carousel_drafts_propagate_media
-- pushes image_urls draft → queue on every update. Media was propagated and copy
-- was not. This extends that same trigger to the body, and leaves the media
-- clause byte-identical.
--
-- ⚠ 'generating' is excluded: a regeneration in flight can leave post_body empty
-- or half-written, and pushing that into the publish queue is the 2026-08-09
-- incident with extra steps. The publisher's own publishability gate still
-- refuses to fire a draft that is mid-regeneration.
-- ⚠ Only `pending` / `queued_v2` rows are touched. A posted, cancelled or failed
-- row is history and is never rewritten.

CREATE OR REPLACE FUNCTION public.tg_carousel_drafts_propagate_media()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only propagate when image_urls actually changed AND the draft is in a
  -- state where a scheduled_posts row likely exists (scheduled or published).
  -- Published rows are still patched so re-publishes / write-backs see the
  -- canonical URL.
  IF NEW.image_urls IS DISTINCT FROM OLD.image_urls
     AND NEW.status IN ('scheduled', 'published') THEN
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

-- 🔴 THE FUNCTION BODY IS NOT ENOUGH, AND A LIVE PROBE IS THE ONLY THING THAT
-- SAYS SO. The trigger was declared `AFTER UPDATE OF image_urls`, so a
-- post_body-only edit never enters the function at all — the first version of
-- this migration replaced the body, changed nothing, and a marker written into
-- a draft never reached its queue row. `UPDATE OF a, b` fires when the column
-- is in the statement's SET list (value need not change), which is why every
-- clause above keeps its own IS DISTINCT FROM guard.
DROP TRIGGER IF EXISTS carousel_drafts_propagate_media ON public.carousel_drafts;
CREATE TRIGGER carousel_drafts_propagate_media
  AFTER UPDATE OF image_urls, post_body ON public.carousel_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_carousel_drafts_propagate_media();

-- Reverse: re-apply the pre-2026-08-11 body of this function (the media clause
-- alone) and re-create the trigger as `AFTER UPDATE OF image_urls`. Nothing
-- else in this file creates or drops an object.
