-- 025 — the regen-clobber guard (inbox-usability-and-voice-live-2026-08-03).
--
-- The inbox lets Ivan edit carousel_drafts.post_body; the save stamps
-- taxonomy.human_edited = true. A full sweep of all 268 n8n workflows
-- (goal-runs/inbox-usability-and-voice-live-2026-08-03-out/
-- phase1-regen-clobber-investigation.md) found FOUR active engines that
-- overwrite post_body unconditionally, plus Proxy Health Recovery which
-- auto-regenerates status='error' rows every 10 minutes with no human in the
-- loop. None of them know the flag exists.
--
-- One trigger at the table beats six edits on live engines: every current AND
-- future service-role writer is covered in one reversible place.
--
-- Semantics:
--   * Only UPDATEs by service_role (n8n, engines, edge fns) are intercepted;
--     the authenticated operator's own writes pass untouched.
--   * Only rows whose OLD.taxonomy->>'human_edited' = 'true' are protected.
--     ABSENCE of the flag in NEW still protects — engines rewrite the whole
--     taxonomy object, which would otherwise launder the flag off (advisor
--     catch, 2026-08-03). The deliberate-regen escape hatch is EXPLICIT:
--     write taxonomy->>'human_edited' = 'false'. While protecting, the flag
--     is merged back into NEW so the next write is guarded too.
--   * post_body is preserved. image_urls is preserved only when the old row
--     HAD images (an engine wipe is blocked; the guarded photo-assigners can
--     still fill an empty slot).
--   * status and every other column flow through — the pipeline keeps its
--     bookkeeping, it just cannot silently clobber human words.
--
-- Rollback:
--   drop trigger if exists trg_protect_human_edited on public.carousel_drafts;
--   drop function if exists public.protect_human_edited_draft();

create or replace function public.protect_human_edited_draft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  begin
    jwt_role := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  exception when others then
    jwt_role := '';
  end;

  if jwt_role = 'service_role'
     and coalesce(old.taxonomy ->> 'human_edited', '') = 'true'
     and coalesce(new.taxonomy ->> 'human_edited', '') <> 'false' then
    new.post_body := old.post_body;

    -- Re-assert the flag: an engine's wholesale taxonomy rewrite must not be
    -- able to launder it off for the NEXT write. A non-object NEW.taxonomy
    -- (legacy bare-string shape) cannot be merged into — keep OLD's object,
    -- which is known to be an object because ->> found the flag in it.
    if jsonb_typeof(coalesce(new.taxonomy, '{}'::jsonb)) = 'object' then
      new.taxonomy := coalesce(new.taxonomy, '{}'::jsonb)
        || jsonb_build_object(
             'human_edited', true,
             'human_edited_at', coalesce(old.taxonomy ->> 'human_edited_at', now()::text));
    else
      new.taxonomy := old.taxonomy;
    end if;

    -- Preserve images only when the old row HAD any (an engine wipe is
    -- blocked; the guarded photo-assigners can still fill an empty slot).
    -- jsonb_array_length RAISES on non-array jsonb — type-check first.
    if old.image_urls is not null then
      if jsonb_typeof(to_jsonb(old.image_urls)) <> 'array'
         or jsonb_array_length(to_jsonb(old.image_urls)) > 0 then
        new.image_urls := old.image_urls;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_human_edited on public.carousel_drafts;
create trigger trg_protect_human_edited
  before update on public.carousel_drafts
  for each row
  when (old.taxonomy is not null)
  execute function public.protect_human_edited_draft();
