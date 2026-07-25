-- Morning brief push: pg_cron 09:30 UTC (= 06:30 Buenos Aires, permanent UTC-3)
-- calls the inbox-morning-push edge function via pg_net. BORN-DEAD: the function
-- no-ops until integration_config.morning_push_enabled = 'true' (the arming gate).
--
-- NOTE: the x-inbox-secret value below is a PLACEHOLDER. The live cron command in
-- the database holds the real INBOX_PUSH_SECRET value (set out-of-band, never
-- committed — same convention as 002_push_trigger.sql). Applied via SQL directly.

insert into integration_config (key, value, is_secret)
values ('morning_push_enabled', 'false', false)
on conflict (key) do nothing;  -- never overwrite an armed switch

select cron.schedule(
  'inbox-morning-push',
  '30 9 * * *',
  $$select net.http_post(
      url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-morning-push',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-inbox-secret','<INBOX_PUSH_SECRET>'),
      body := '{}'::jsonb)$$
);
