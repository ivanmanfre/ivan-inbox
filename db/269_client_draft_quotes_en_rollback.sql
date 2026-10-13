-- Rollback db/269. Saved quote_en / quote_en_src keys on drafts and boards stay (additive, harmless).
select cron.schedule('content-plan-quotes', '*/30 * * * *', $cron$
select net.http_post(
  url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-plan-quotes',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-inbox-secret', (select value from public.integration_config where key = 'inbox_push_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000)
where exists (select 1 from public.content_plan_quotes_due(1))
$cron$);
drop function if exists public.content_plan_draft_quote_save(uuid, text, text);
drop function if exists public.content_plan_draft_quotes_due(int);
