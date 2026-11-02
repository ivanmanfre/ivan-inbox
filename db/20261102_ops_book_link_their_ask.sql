-- Booking cards carry what the prospect asked for (2026-11-02, Gene Kakaulin / Curex).
-- Gene sent his Calendly link with three things to prepare for the call (fee structure, creator examples,
-- recent creative). The Ops "Book X's calendar link" card only said "book it", so the asks lived in the DM
-- thread and nowhere on the card Davorin's prep starts from.
--
-- Every seat's drafter (ARCH, RISE, Ivan warm, SwishDM) writes the same card shape: ops_drafts kind='task',
-- context.action='book_link', context.prospect_id, and for send-invite cards dedupe_key 'book_invite:<id>'.
-- One trigger here covers all of them with no workflow edits: it stamps context.their_ask with the prospect's
-- own words (the inbound message the card answers, else their latest inbound text). Verbatim on purpose:
-- no model summary, nothing narrowed. The app shows it on the card (BookedKey).
--
-- Fail-open: any error leaves the row exactly as the drafter wrote it. A card is never blocked by this.
create or replace function public.ops_book_link_their_ask() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_mid text;
  v_id uuid;
  v_text text;
  v_at timestamptz;
begin
  if new.kind is distinct from 'task'
     or coalesce(new.context->>'action', '') <> 'book_link'
     or coalesce(new.context->>'their_ask', '') <> '' then
    return new;
  end if;
  begin
    v_pid := nullif(new.context->>'prospect_id', '')::uuid;
    v_mid := substring(coalesce(new.context->>'dedupe_key', '') from '^book_invite:(.+)$');

    -- The exact inbound the card answers, when the dedupe key names it (outreach id or provider id).
    if v_mid is not null then
      select om.id, om.message_text, coalesce(om.sent_at, om.created_at) into v_id, v_text, v_at
        from outreach_messages om
       where om.direction = 'inbound'
         and (om.id::text = v_mid or om.unipile_message_id = v_mid)
         and nullif(btrim(om.message_text), '') is not null
       limit 1;
    end if;

    -- Otherwise their latest real text (reactions carry no ask).
    if v_id is null and v_pid is not null then
      select om.id, om.message_text, coalesce(om.sent_at, om.created_at) into v_id, v_text, v_at
        from outreach_messages om
       where om.prospect_id = v_pid
         and om.direction = 'inbound'
         and coalesce(om.is_reaction, false) = false
         and nullif(btrim(om.message_text), '') is not null
       order by coalesce(om.sent_at, om.created_at) desc
       limit 1;
    end if;

    if v_id is not null then
      new.context := new.context || jsonb_build_object(
        'their_ask', left(btrim(v_text), 1500),
        'their_ask_message_id', v_id,
        'their_ask_at', v_at);
    end if;
  exception when others then
    return new;
  end;
  return new;
end $$;

drop trigger if exists ops_book_link_their_ask on public.ops_drafts;
create trigger ops_book_link_their_ask
  before insert or update of context on public.ops_drafts
  for each row execute function public.ops_book_link_their_ask();

-- Backfill: open booking cards only (closed ones are history).
update public.ops_drafts set context = context
 where kind = 'task' and context->>'action' = 'book_link'
   and sent_at is null and send_blocked_reason is null
   and coalesce(context->>'their_ask', '') = '';
