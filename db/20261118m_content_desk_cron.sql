-- Content Desk trigger tick, every 15 minutes. The function answers
-- {skipped:'triggers_off'} until desk_config.triggers_enabled is true, so this
-- job is inert until armed. The live secret replaces the placeholder at apply time
-- (same pattern as db/061_bot_tick_cron.sql); it never lives in the repo.
select cron.schedule(
  'content-desk-tick',
  '*/15 * * * *',
  $$select net.http_post(
      url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-desk',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-desk-secret','<DESK_TICK_SECRET>'),
      body := '{"op":"tick"}'::jsonb)$$
);
