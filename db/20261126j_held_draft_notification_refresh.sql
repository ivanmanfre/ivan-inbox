-- 2026-11-26: editing a held reply draft left its bell notification showing the old text, so the
-- inbox said one thing and the thread another. The drafter's ping (family reply_draft_pending, media.prospect_id)
-- carries the draft text verbatim; when an UNSENT outbound draft's text changes, the same text inside the open
-- notification for that prospect is swapped for the new text. Read state is left alone. Nothing is sent.
create or replace function public.inbox_refresh_held_draft_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'outbound' and new.sent_at is null and old.sent_at is null
     and length(coalesce(old.message_text, '')) >= 8 and new.message_text is distinct from old.message_text then
    -- Sol r3: only the draft-text section (a whole "\n\n<text>\n\n" block, or the trailing block), and only when exactly
    -- one open notification for this prospect carries it; an ambiguous match is left alone
    with m as (
      select n.id from inbox_notifications n
       where n.family = 'reply_draft_pending'
         and n.media->>'prospect_id' = new.prospect_id::text
         and n.dismissed_at is null
         and n.created_at between new.created_at - interval '2 minutes' and new.created_at + interval '15 minutes'
         and (strpos(n.body, E'\n\n' || old.message_text || E'\n\n') > 0 or right(n.body, length(old.message_text) + 2) = E'\n\n' || old.message_text)
    )
    update inbox_notifications n
       set body = left(case when strpos(n.body, E'\n\n' || old.message_text || E'\n\n') > 0
                            then replace(n.body, E'\n\n' || old.message_text || E'\n\n', E'\n\n' || coalesce(new.message_text, '') || E'\n\n')
                            else left(n.body, length(n.body) - length(old.message_text)) || coalesce(new.message_text, '') end, 4000)
     where n.id = (select id from m) and (select count(*) from m) = 1;
  end if;
  return null;
end $$;

drop trigger if exists inbox_refresh_held_draft_notification on public.outreach_messages;
create trigger inbox_refresh_held_draft_notification
  after update of message_text on public.outreach_messages
  for each row execute function public.inbox_refresh_held_draft_notification();
