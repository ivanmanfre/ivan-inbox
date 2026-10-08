-- A reply draft retires itself once the thread is answered.
--
-- Ivan 2026-10-08 (Zahira Odimayo, Rise): "idk why this appears ... its a 2nd draft after i already
-- replied so only should see that draft if its follow up time". Two reply drafters answered her 17:22
-- message a minute apart (rise_reply_draft_v1 and inbox_on_demand_reply); the first was approved and
-- sent at 17:36, the second stayed pending and kept the thread in Needs you as "you already replied".
-- 🔴 Hiding it was not enough: Outreach - Stalled Conversation Bump holds any prospect with a pending
-- outbound draft (reason pending_draft), so a stale reply draft left in place silently blocks the
-- follow-up. Retired here as a normal inbox discard (send_blocked_reason discarded_in_inbox, so no
-- drafter redrafts it; it shows under Discarded for 3 days and can be brought back), marked
-- discard_mode = 'answered_by_send'.
--
-- Fires when an outbound send lands (inserted sent, or sent_at set) and that send is newer than the
-- prospect's newest inbound. Retires only drafts that:
--   · are pending (not sent, not approved, not blocked), dm / email / inmail
--   · were written before the send, in answer to an inbound (one exists before the draft)
--   · ride the same channel family as the send, so the email leg of a LinkedIn + email pair stays
--   · come from a reply drafter (model names reply/answer), never a follow-up, bump, scan or lead
--     magnet delivery, or anything typed or edited by hand
create or replace function public.retire_answered_reply_drafts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fam text := case when coalesce(new.channel, '') = 'email' or new.message_type = 'email' then 'email' else 'linkedin' end;
begin
  if new.direction <> 'outbound' or new.sent_at is null or coalesce(new.is_reaction, false)
     or new.message_type not in ('dm', 'email', 'inmail', 'manual_reply') then
    return new;
  end if;
  -- Only a send that answers the newest inbound.
  if exists (select 1 from public.outreach_messages i
              where i.prospect_id = new.prospect_id and i.direction = 'inbound'
                and coalesce(i.sent_at, i.created_at) > new.sent_at) then
    return new;
  end if;
  update public.outreach_messages d
     set send_blocked_reason = 'discarded_in_inbox', send_blocked_at = now(), discard_mode = 'answered_by_send'
   where d.prospect_id = new.prospect_id
     and d.id <> new.id
     and d.direction = 'outbound'
     and d.sent_at is null and d.approved_at is null and d.send_blocked_at is null
     and d.message_type in ('dm', 'email', 'inmail')
     and d.created_at <= new.sent_at
     and (case when coalesce(d.channel, '') = 'email' or d.message_type = 'email' then 'email' else 'linkedin' end) = fam
     and coalesce(d.ai_model, '') ~* '(reply|answer)'
     and coalesce(d.ai_model, '') !~* '(manual|follow|bump|delivery|scan|lm_gate|_edit_)'
     and exists (select 1 from public.outreach_messages i
                  where i.prospect_id = new.prospect_id and i.direction = 'inbound'
                    and coalesce(i.sent_at, i.created_at) <= d.created_at);
  return new;
end $$;
revoke execute on function public.retire_answered_reply_drafts() from public, anon, authenticated;

drop trigger if exists retire_answered_reply_drafts_ins on public.outreach_messages;
create trigger retire_answered_reply_drafts_ins
  after insert on public.outreach_messages
  for each row when (new.direction = 'outbound' and new.sent_at is not null)
  execute function public.retire_answered_reply_drafts();

drop trigger if exists retire_answered_reply_drafts_upd on public.outreach_messages;
create trigger retire_answered_reply_drafts_upd
  after update of sent_at on public.outreach_messages
  for each row when (old.sent_at is null and new.sent_at is not null and new.direction = 'outbound')
  execute function public.retire_answered_reply_drafts();
