-- Rollback of 20261112_content_daily_card.sql: the cron job first (so no run starts mid-rollback), then the functions,
-- then the table. Notifications already written to inbox_notifications (family content_card) stay as history.
select cron.unschedule('content-daily-card') where exists (select 1 from cron.job where jobname = 'content-daily-card');

drop function if exists public.content_card_post(date, uuid, text, timestamptz, boolean, int);
drop function if exists public.content_card_rebase(date, uuid, text);
drop function if exists public.content_card_set(date, uuid, text);
drop function if exists public.content_card_today();
drop function if exists public.content_card_pick(timestamptz);
drop function if exists public.content_card_payload(date, uuid, text);
drop function if exists public.content_card_week_poland(timestamptz);
drop function if exists public.content_card_candidates(timestamptz);
drop function if exists public.content_card_poland(uuid);
drop function if exists public.content_card_sha(text);
drop function if exists public.content_card_tax(jsonb);
drop table if exists public.content_daily_cards;
