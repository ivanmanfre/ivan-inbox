-- db/061 - the bot tick's clock: pg_cron every 30 minutes calls inbox-bot-tick
-- via pg_net. Goal run claude-bot-thread-2026-09-11, wave W2.
--
-- BORN-DEAD twice over: the schedule fires, but the function no-ops until
-- integration_config.bot_tick_enabled = 'true' (db/060 inserts it as 'false'),
-- so registering the cron costs one log line per half hour and nothing else.
-- W4 flips the flag after the message-quality and no-write gates are green.
--
-- NOTE: the x-inbox-secret value below is a PLACEHOLDER. The live cron command
-- in the database holds the real INBOX_PUSH_SECRET value (set out-of-band,
-- never committed) - same convention as db/016_morning_push.sql and
-- db/002_push_trigger.sql. Applied via the Management API by the orchestrator,
-- which holds the secret.
--
-- Deploy note: inbox-bot-tick is deployed WITH --no-verify-jwt, because the
-- caller is pg_net with a header secret and no bearer, exactly like
-- inbox-morning-push and inbox-notify.

select cron.schedule(
  'inbox-bot-tick',
  '*/30 * * * *',
  $$select net.http_post(
      url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-bot-tick',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-inbox-secret','<INBOX_PUSH_SECRET>'),
      body := '{}'::jsonb)$$
);

-- To take the clock away without touching the function:
--   select cron.unschedule('inbox-bot-tick');
