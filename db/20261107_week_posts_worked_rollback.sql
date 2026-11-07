-- rollback for 20261107_week_posts_worked.sql (read-only; nothing else depends on it but the Sunday review's posts_section)
drop function if exists public.ivan_week_posts_worked(timestamptz, timestamptz);
