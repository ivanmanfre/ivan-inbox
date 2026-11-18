-- Rollback for 20261118m_content_desk_r3.sql (new functions; only content-desk calls them).
drop function if exists public.desk_undo_schedule(uuid, timestamptz, timestamptz);
drop function if exists public.desk_undo_photos(uuid, text[], text[]);
drop function if exists public.desk_patch_action_echo(uuid, text, jsonb);
drop function if exists public.desk_fire_trigger(text, text, jsonb, integer, uuid, text, jsonb);
