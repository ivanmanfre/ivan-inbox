-- 2026-11-26: editing a held reply draft left its bell notification showing the old text, so the
-- inbox said one thing and the thread another. The drafter's ping (family reply_draft_pending, media.prospect_id)
-- carries the draft text verbatim; when an UNSENT outbound draft's text changes, the same text inside the open
-- notification for that prospect is swapped for the new text. Read state is left alone. Nothing is sent.
create or replace function public.inbox_refresh_held_draft_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int; v_id uuid;
begin
  if new.direction = 'outbound' and new.sent_at is null and old.sent_at is null
     and length(coalesce(old.message_text, '')) >= 8 and new.message_text is distinct from old.message_text then
    -- Sol r3+r4: only when the WHOLE draft section equals the old text: the body is "<header>\n\n<draft>" or
    -- "<header>\n\n<draft>\n\nWhy: ...", the draft starting right after the first blank line; and only when exactly one
    -- open notification for this prospect matches. A paragraph of a longer draft, or an ambiguous match, is left alone.
    select count(*), min(x.id::text)::uuid into v_n, v_id
      from inbox_notifications x
     where x.family = 'reply_draft_pending'
       and x.media->>'prospect_id' = new.prospect_id::text
       and x.dismissed_at is null
       and x.created_at between new.created_at - interval '2 minutes' and new.created_at + interval '15 minutes'
       and strpos(x.body, E'\n\n') > 0
       and substr(x.body, strpos(x.body, E'\n\n') + 2, length(old.message_text)) = old.message_text
       and (length(x.body) = strpos(x.body, E'\n\n') + 1 + length(old.message_text)
            or substr(x.body, strpos(x.body, E'\n\n') + 2 + length(old.message_text), 7) = E'\n\nWhy: ');
    if v_n = 1 then
      update inbox_notifications n
         set body = left(substr(n.body, 1, strpos(n.body, E'\n\n') + 1) || coalesce(new.message_text, '') || substr(n.body, strpos(n.body, E'\n\n') + 2 + length(old.message_text)), 4000)
       where n.id = v_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists inbox_refresh_held_draft_notification on public.outreach_messages;
create trigger inbox_refresh_held_draft_notification
  after update of message_text on public.outreach_messages
  for each row execute function public.inbox_refresh_held_draft_notification();
