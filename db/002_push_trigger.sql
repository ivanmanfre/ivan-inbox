-- Inbound-message push trigger for the unified DM inbox.
-- On every inbound outreach_messages row, fire a pg_net POST to the inbox-push
-- edge function, which sends web-push notifications to 'ivan-inbox' subscribers.
--
-- NOTE: the x-inbox-secret value below is a PLACEHOLDER. The live trigger in the
-- database holds the real INBOX_PUSH_SECRET value (set out-of-band, never
-- committed). Applied via the Supabase Management API, not from this file.
create extension if not exists pg_net;
create or replace function notify_inbox_push() returns trigger
language plpgsql security definer as $$
begin
  if new.direction = 'inbound' then
    perform net.http_post(
      url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-push',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-inbox-secret','<INBOX_PUSH_SECRET>'),
      body := jsonb_build_object('message_id', new.id)
    );
  end if;
  return new;
end $$;
drop trigger if exists trg_inbox_push on outreach_messages;
create trigger trg_inbox_push after insert on outreach_messages
  for each row execute function notify_inbox_push();
