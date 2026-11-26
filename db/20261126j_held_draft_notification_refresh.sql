-- 2026-11-26: editing a held reply draft left its bell notification showing the old text, so the
-- inbox said one thing and the thread another. The drafter's ping (family reply_draft_pending, media.prospect_id)
-- carries the draft text verbatim; when an UNSENT outbound draft's text changes, the same text inside the open
-- notification for that prospect is swapped for the new text. Read state is left alone. Nothing is sent.
create or replace function public.inbox_refresh_held_draft_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'outbound' and new.sent_at is null and old.sent_at is null
     and length(coalesce(old.message_text, '')) >= 8 and new.message_text is distinct from old.message_text then
    update inbox_notifications n
       set body = left(replace(n.body, old.message_text, coalesce(new.message_text, '')), 4000)
     where n.family = 'reply_draft_pending'
       and n.media->>'prospect_id' = new.prospect_id::text
       and n.dismissed_at is null
       and n.created_at between new.created_at - interval '2 minutes' and new.created_at + interval '15 minutes'
       and strpos(n.body, old.message_text) > 0;
  end if;
  return null;
end $$;

drop trigger if exists inbox_refresh_held_draft_notification on public.outreach_messages;
create trigger inbox_refresh_held_draft_notification
  after update of message_text on public.outreach_messages
  for each row execute function public.inbox_refresh_held_draft_notification();
