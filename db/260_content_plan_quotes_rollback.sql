-- Rollback for db/260. The quote_en columns belong to db/259 and stay; cached values stay (inert without the job).
select cron.unschedule('content-plan-quotes') where exists (select 1 from cron.job where jobname = 'content-plan-quotes');
drop function if exists public.content_plan_quote_save(uuid, text, text);
drop function if exists public.content_plan_quotes_due(int);
