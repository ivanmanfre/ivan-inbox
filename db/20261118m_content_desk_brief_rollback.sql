-- Rollback for 20261118m_content_desk_brief.sql (new functions; nothing else reads them).
drop function if exists public.desk_brief_ivan(boolean);
drop function if exists public.desk_first_line(text);
drop function if exists public.desk_brief_stamp();
