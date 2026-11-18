-- Rollback for 20261118m_content_desk_core.sql. The desk owns these tables;
-- nothing else reads them. The soft rollback is a flag:
--   update public.desk_config set value='false' where key='desk_enabled';
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'desk_messages') then
    execute 'alter publication supabase_realtime drop table public.desk_messages';
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'desk_t3_jobs') then
    execute 'alter publication supabase_realtime drop table public.desk_t3_jobs';
  end if;
end $$;
drop table if exists public.desk_triggers;
drop table if exists public.desk_t3_jobs;
drop table if exists public.desk_actions;
drop table if exists public.desk_messages;
drop table if exists public.desk_config;
