-- inbox_true_waiting: the threads that are really waiting on us (needs-reply precision, 2026-11-11).
-- Read-only. Feeds the daily "waiting on a reply" Ops card of the Stalled Conversation Bump workflow
-- (block NEEDS_REPLY_DIGEST_V1). It never changes needs_manual_reply on any row.
--
-- Why: the card listed every flagged thread with no waiting draft and 48h of silence. On 2026-11-10 that was
-- 68 Ivan / 31 ARCH / 57 RISE lines, and almost all of them were threads where Ivan had already looked at the
-- reply, been handed a draft, and discarded it. Ivan cleared the card by hand every day.
--
-- Seat = coalesce(outreach_campaigns.client_id, 'ivan'), joined to outreach_seats, so the seat list comes from data.
-- Common filters (the stall-bump node query): blacklisted false (NULL is excluded, as PostgREST blacklisted=eq.false does),
-- call_booked_at null, skip_state null, skip_reason null, stage not archived or skipped (NULL stage excluded, as the node
-- not.in filter does), next_touch_after null or past. Only the next_touch_after test is new: the node never applied it.
--
-- One row per prospect. Kinds, in precedence order (a thread is returned under the first that fits):
--   held_draft_48h    a waiting draft (same test as inbox_prospect_has_waiting_draft) created over 48h ago, on a thread whose
--                     last inbound is also over 48h old and has had no real send since it. since = the draft created_at.
--   reply_myself_48h  the newest draft written after the last inbound was discarded with discard_mode reply_myself over 48h
--                     ago ("I will answer this myself") and nothing has been sent since. since = the last inbound.
--   no_reply_48h      needs_manual_reply is true, last inbound over 48h old, no real send since it, no waiting draft, the
--                     last inbound is not reply_intent negative, and the newest draft written after the inbound has not been
--                     decided: not discard_mode stop / answered_by_send / reply_myself, not a discarded_* reason (a discard
--                     without a mode is still a decision Ivan took on that draft, EXCEPT when the last inbound asks us something:
--                     reply_intent info_ask / booking / price_ask keeps the thread listed, note 'draft discarded <date>'
--                     [orchestrator ruling 2026-11-10: the prospect asked a question or said yes to a call or price talk,
--                     and a discarded draft is not an answer]. Round-1 review extensions to the same exception: R-A the last inbound
--                     is an email reply with no reply_intent (email replies are never classified); R-B ANY inbound since our last
--                     real send asked (info_ask / booking / price_ask), not only the newest), not a superseded* reason. since = last inbound.
-- All three kinds are suppressed while the thread is handled in the inbox: an approved-and-unsent reply or a reply scheduled in
-- the inbox that is newer than the last inbound (S2), or a snoozed draft (S3). held_draft_48h clock (S1) = the OLDEST waiting
-- draft written after the last inbound (a thread whose waiting drafts all predate the inbound falls back to its oldest one).
-- Last inbound time = coalesce(sent_at, created_at). A real send is an outbound row with sent_at set that is not a
-- connection_note. said = last inbound text, whitespace collapsed, 90 characters; for a reaction 'reacted <emoji>'.
-- Rollback: db/20261111_inbox_true_waiting_rollback.sql

create or replace function public.inbox_true_waiting(p_seat text default null)
returns table(seat text, prospect_id uuid, name text, company text, kind text, since timestamptz, said text, note text)
language sql stable security definer set search_path = public
as $fn$
  with cand as (
    select p.id, p.name, p.company, p.needs_manual_reply as flagged, s.seat
      from public.outreach_prospects p
      left join public.outreach_campaigns c on c.id = p.campaign_id
      join public.outreach_seats s on s.seat = coalesce(c.client_id, 'ivan')
     where p.blacklisted = false
       and p.call_booked_at is null
       and p.skip_state is null
       and p.skip_reason is null
       and p.stage not in ('archived', 'skipped')
       and (p.next_touch_after is null or p.next_touch_after <= now())
       and (p_seat is null or s.seat = p_seat)
       and (p.needs_manual_reply
            or exists (select 1 from public.outreach_messages d
                        where d.prospect_id = p.id and d.direction = 'outbound'
                          and d.sent_at is null and d.approved_at is null))
  ),
  thr as (
    select cd.*,
           li.at as in_at, li.message_text as in_text, li.is_reaction as in_reaction, li.reply_intent as in_intent,
           (li.message_type = 'email_reply' or li.channel = 'email') as in_email,
           (select max(o.sent_at) from public.outreach_messages o
             where o.prospect_id = cd.id and o.direction = 'outbound' and o.sent_at is not null
               and o.message_type is distinct from 'connection_note') as out_at,
           -- S2: an approved-and-unsent reply (approved_at, no block) or a reply scheduled in the inbox answers the thread
           -- once it is newer than the last inbound (src/lib/inbox.ts unansweredSince, lastSent filter, line 1256)
           (select max(case when o.approved_at is not null and o.send_blocked_at is null then o.approved_at
                            when o.send_blocked_reason = 'scheduled_in_inbox' and o.send_blocked_at is not null and o.approved_at is null then o.send_blocked_at end)
              from public.outreach_messages o
             where o.prospect_id = cd.id and o.direction = 'outbound' and o.sent_at is null) as hand_at,
           -- S3: an actively snoozed draft parks the thread, void once a newer inbound lands after snoozed_at
           -- (src/lib/inbox.ts snoozeActive, lines 728-733; unansweredSince returns null while snoozed, line 1219)
           exists (select 1 from public.outreach_messages o
                    where o.prospect_id = cd.id and o.direction = 'outbound' and o.sent_at is null
                      and o.snoozed_until > now()
                      and not (o.snoozed_at is not null and li.at > o.snoozed_at)) as snoozed,
           -- R-B: any inbound since our last real send that asks something
           exists (select 1 from public.outreach_messages a
                    where a.prospect_id = cd.id and a.direction = 'inbound' and a.reply_intent in ('info_ask', 'booking', 'price_ask')
                      and coalesce(a.sent_at, a.created_at) > coalesce((select max(o2.sent_at) from public.outreach_messages o2
                            where o2.prospect_id = cd.id and o2.direction = 'outbound' and o2.sent_at is not null
                              and o2.message_type is distinct from 'connection_note'), '-infinity'::timestamptz)) as ask_burst,
           nd.created_at as nd_created, nd.discard_mode as nd_mode, nd.send_blocked_reason as nd_reason,
           coalesce(nd.send_blocked_at, nd.created_at) as nd_at,
           w.created_at as w_created, w.send_blocked_reason as w_reason
      from cand cd
     cross join lateral (
        select m.message_text, m.is_reaction, m.reply_intent, m.message_type, m.channel, coalesce(m.sent_at, m.created_at) as at
          from public.outreach_messages m
         where m.prospect_id = cd.id and m.direction = 'inbound'
         order by coalesce(m.sent_at, m.created_at) desc, m.created_at desc
         limit 1) li
      left join lateral (
        select d.created_at, d.discard_mode, d.send_blocked_reason, d.send_blocked_at
          from public.outreach_messages d
         where d.prospect_id = cd.id and d.direction = 'outbound' and d.sent_at is null and d.created_at >= li.at
         order by d.created_at desc, d.id desc
         limit 1) nd on true
      left join lateral (
        select d.created_at, d.send_blocked_reason
          from public.outreach_messages d
         where d.prospect_id = cd.id and d.direction = 'outbound' and d.sent_at is null and d.approved_at is null
           and (d.send_blocked_at is null
                or d.send_blocked_reason in ('awaiting_client_review', 'owner_confirmation', 'reply_retry_pending')
                or d.send_blocked_reason like 'post_approval_race:%'
                or d.send_blocked_reason like 'lint\_%')
         order by (d.created_at >= li.at) desc, d.created_at asc, d.id asc
         limit 1) w on true
  ),
  hits as (
    select t.seat, t.id, t.name, t.company, 1 as rank, 'held_draft_48h'::text as kind, t.w_created as since,
           coalesce(t.w_reason, 'unapproved') || ' · draft ' || to_char(t.w_created at time zone 'UTC', 'YYYY-MM-DD') as note, t
      from thr t
     where t.w_created is not null
       and t.w_created < now() - interval '48 hours'
       and t.in_at < now() - interval '48 hours'
       and (t.out_at is null or t.out_at < t.in_at)
       and (t.hand_at is null or t.hand_at <= t.in_at) and not t.snoozed
    union all
    select t.seat, t.id, t.name, t.company, 2, 'reply_myself_48h', t.in_at,
           'you said you''d reply ' || to_char(t.nd_at at time zone 'UTC', 'YYYY-MM-DD'), t
      from thr t
     where t.nd_mode = 'reply_myself'
       and t.nd_at < now() - interval '48 hours'
       and t.w_created is null
       and (t.out_at is null or t.out_at < t.in_at)
       and (t.hand_at is null or t.hand_at <= t.in_at) and not t.snoozed
    union all
    select t.seat, t.id, t.name, t.company, 3, 'no_reply_48h', t.in_at,
           case when t.nd_created is null then 'no draft made'
                when t.nd_reason ~ '^discarded' then 'draft discarded ' || to_char(t.nd_at at time zone 'UTC', 'YYYY-MM-DD')
                else 'draft held ' || to_char(t.nd_at at time zone 'UTC', 'YYYY-MM-DD') end, t
      from thr t
     where t.flagged
       and t.in_at < now() - interval '48 hours'
       and (t.out_at is null or t.out_at < t.in_at)
       and t.w_created is null
       and (t.hand_at is null or t.hand_at <= t.in_at) and not t.snoozed
       and t.in_intent is distinct from 'negative'
       and not (t.nd_created is not null
                and (coalesce(t.nd_mode, '') in ('stop', 'answered_by_send', 'reply_myself')
                     or coalesce(t.nd_reason, '') ~ '^superseded'
                     or (coalesce(t.nd_reason, '') ~ '^discarded'
                         and not (t.nd_mode is null
                                  and (coalesce(t.in_intent, '') in ('info_ask', 'booking', 'price_ask')
                                       or (t.in_email and t.in_intent is null)
                                       or t.ask_burst)))))
  )
  select distinct on (h.id)
         h.seat, h.id as prospect_id, h.name, h.company, h.kind, h.since,
         case when (h.t).in_reaction
                then 'reacted ' || btrim(regexp_replace(coalesce((h.t).in_text, ''), '^.*reacted\s*', '', 'i'))
              else left(btrim(regexp_replace(coalesce((h.t).in_text, ''), '\s+', ' ', 'g')), 90) end as said,
         h.note
    from hits h
   order by h.id, h.rank
$fn$;

revoke all on function public.inbox_true_waiting(text) from public, anon, authenticated;
grant execute on function public.inbox_true_waiting(text) to service_role;
