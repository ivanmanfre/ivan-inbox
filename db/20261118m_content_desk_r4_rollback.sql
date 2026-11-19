-- Rollback for 20261118m_content_desk_r4.sql (new functions; only content-desk calls them).
drop function if exists public.desk_undo_schedule_v2(uuid, timestamptz, text, timestamptz, timestamptz);
drop function if exists public.desk_undo_photos_v2(uuid, text[], text, timestamptz, text[]);
