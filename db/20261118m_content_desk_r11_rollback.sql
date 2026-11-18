-- Rollback for 20261118m_content_desk_r11.sql (new function; only content-desk calls it).
drop function if exists public.desk_live_drafts(boolean);
