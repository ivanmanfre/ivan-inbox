-- Tests for db/20261111_inbox_true_waiting.sql. Ruling 2026-11-10: a plain discard keeps the thread listed when the last inbound is info_ask / booking / price_ask. House style: one transaction, pg_temp.assert_true, rollback at the end
-- so the database is unchanged. These run AFTER the migration is applied and assert on REAL rows (read-only, nothing is
-- inserted). The named threads were true on 2026-11-10; when one has been answered since, re-point the name to a current
-- thread of the same kind (the staged proof script check_true_waiting.py prints a REPLACED: line when that happens).

begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'assertion failed: %', p_message; end if;
end $$;

set local request.jwt.claim.role = 'service_role';

do $$
begin
  -- shape and permissions
  perform pg_temp.assert_true(exists (select 1 from pg_proc where proname = 'inbox_true_waiting' and prosecdef and provolatile = 's'),
    'inbox_true_waiting exists, security definer, stable');
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.inbox_true_waiting(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.inbox_true_waiting(text)', 'execute')
    and has_function_privilege('service_role', 'public.inbox_true_waiting(text)', 'execute'),
    'execute is granted to service_role only');

  -- 1. Michelle Sartorio (risedtc): nothing sent since her 2026-11-04 reply, no draft
  perform pg_temp.assert_true(exists (select 1 from inbox_true_waiting() w
      where w.name = 'Michelle Sartorio' and w.seat = 'risedtc' and w.kind = 'no_reply_48h' and w.since::date = date '2026-11-04'),
    'Michelle Sartorio (risedtc) is no_reply_48h since 2026-11-04');
  -- 2. held drafts
  -- Dan T. (arch) and Kinsen Siu (risedtc) were named as held_draft_48h by the plan, but Ivan had already snoozed both drafts
  -- (10-28 until 11-24, 10-27 until 2027-01-11); the data did not change, the predicate did: they are actively snoozed
  -- (round-1 fix S3), so they are suppressed. Re-pointed: the held kind is asserted on Prakhar Vohra (ivan), and the snooze on the other two.
  perform pg_temp.assert_true(exists (select 1 from inbox_true_waiting() w where w.name = 'Prakhar Vohra' and w.seat = 'ivan' and w.kind = 'held_draft_48h'),
    'Prakhar Vohra (ivan) is held_draft_48h (replaces Dan T. / Kinsen Siu, now snoozed)');
  perform pg_temp.assert_true((select note from inbox_true_waiting() w where w.name = 'Prakhar Vohra' and w.seat = 'ivan') like '%draft 20%',
    'held_draft_48h note carries the draft date');
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting() w where w.name in ('Dan T.', 'Kinsen Siu', 'Emma Farrow'))
    and (select count(distinct p.id) from outreach_prospects p join outreach_messages m on m.prospect_id = p.id
          where p.name in ('Dan T.', 'Kinsen Siu', 'Emma Farrow') and p.needs_manual_reply and m.direction = 'outbound' and m.sent_at is null and m.snoozed_until > now()) >= 3,
    'S3: Dan T., Kinsen Siu, Emma Farrow have an actively snoozed draft and are not returned');
  -- 3. blacklisted / operator-deleted thread with a stale scan_owed stamp
  perform pg_temp.assert_true(exists (select 1 from outreach_prospects where name = 'Cameo Hanlon')
    and not exists (select 1 from inbox_true_waiting() w where w.name = 'Cameo Hanlon'),
    'Cameo Hanlon (blacklisted, thread deleted by operator) is not returned');
  -- 4. Ivan seat: scan draft discarded by Ivan
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting('ivan') w
      where w.name in ('Elisey Kolev', 'Lukas Adamek', 'John Javier', 'Julia Ventskovska')),
    'Elisey Kolev, Lukas Adamek, John Javier, Julia Ventskovska are not returned for ivan');
  perform pg_temp.assert_true((select count(*) from outreach_prospects p left join outreach_campaigns c on c.id = p.campaign_id
      where p.name in ('Elisey Kolev', 'Lukas Adamek', 'John Javier', 'Julia Ventskovska') and coalesce(c.client_id, 'ivan') = 'ivan') >= 4,
    'the four named Ivan threads exist (the absence check above is not vacuous)');

  -- 5. no_reply_48h per seat equals an independent count (flagged, 48h silence, nothing sent since, no draft written after the
  --    last inbound, no waiting draft, not negative), formulated without the function's CTEs
  perform pg_temp.assert_true(
      (select coalesce(jsonb_object_agg(seat, c), '{}'::jsonb) from (
         select s.seat, count(*) c
           from outreach_prospects p
           left join outreach_campaigns k on k.id = p.campaign_id
           join outreach_seats s on s.seat = coalesce(k.client_id, 'ivan')
          where p.needs_manual_reply and p.blacklisted = false and p.call_booked_at is null and p.skip_state is null and p.skip_reason is null
            and p.stage not in ('archived', 'skipped') and (p.next_touch_after is null or p.next_touch_after <= now())
            and not inbox_prospect_has_waiting_draft(p.id)
            and exists (select 1 from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound')
            and (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound') < now() - interval '48 hours'
            and not exists (select 1 from outreach_messages o where o.prospect_id = p.id and o.direction = 'outbound' and o.sent_at is not null
                              and o.message_type is distinct from 'connection_note'
                              and o.sent_at >= (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound'))
            and (select i.reply_intent from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound'
                  order by coalesce(i.sent_at, i.created_at) desc, i.created_at desc limit 1) is distinct from 'negative'
            and not exists (select 1 from (
                  select d.* from outreach_messages d where d.prospect_id = p.id and d.direction = 'outbound' and d.sent_at is null
                     and d.created_at >= (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound')
                   order by d.created_at desc, d.id desc limit 1) nd
                 where nd.discard_mode is not null or nd.send_blocked_reason ~ '^superseded'
                    or (nd.send_blocked_reason ~ '^discarded' and not (
                         coalesce((select i.reply_intent from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound' order by coalesce(i.sent_at, i.created_at) desc, i.created_at desc limit 1), '') in ('info_ask','booking','price_ask')
                         or exists (select 1 from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound' and i.message_type = 'email_reply' and i.reply_intent is null
                                      and coalesce(i.sent_at, i.created_at) = (select max(coalesce(i2.sent_at, i2.created_at)) from outreach_messages i2 where i2.prospect_id = p.id and i2.direction = 'inbound'))
                         or exists (select 1 from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound' and i.reply_intent in ('info_ask','booking','price_ask')
                                      and coalesce(i.sent_at, i.created_at) > coalesce((select max(o2.sent_at) from outreach_messages o2 where o2.prospect_id = p.id and o2.direction = 'outbound' and o2.sent_at is not null and o2.message_type is distinct from 'connection_note'), '-infinity'::timestamptz)))))
            and not exists (select 1 from outreach_messages o where o.prospect_id = p.id and o.direction = 'outbound' and o.sent_at is null
                              and ((o.approved_at is not null and o.send_blocked_at is null) or (o.send_blocked_reason = 'scheduled_in_inbox' and o.send_blocked_at is not null and o.approved_at is null))
                              and coalesce(o.approved_at, o.send_blocked_at) > (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound'))
            and not exists (select 1 from outreach_messages o where o.prospect_id = p.id and o.direction = 'outbound' and o.sent_at is null and o.snoozed_until > now()
                              and not (o.snoozed_at is not null and (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = p.id and i.direction = 'inbound') > o.snoozed_at))
          group by s.seat) q)
      = (select coalesce(jsonb_object_agg(seat, c), '{}'::jsonb) from (
           select seat, count(*) c from inbox_true_waiting() where kind = 'no_reply_48h' group by seat) q2),
      'no_reply_48h per seat equals the independent count');

  -- 5b. plain discards on asking inbounds stay listed (orchestrator ruling 2026-11-10)
  perform pg_temp.assert_true((select count(*) = 4 from inbox_true_waiting() w where w.kind = 'no_reply_48h' and w.note like 'draft discarded%'
      and w.prospect_id in ('9c0ad359-e9c2-4fb5-8c84-51bf5d48daaf', 'a7c65ec6-74b0-4a7d-a32a-de834450c2e3', '8cf7890a-fea4-49ec-832b-d795235d9793', 'd9f27950-6331-4a78-86cc-6f5e65b87196')),
    'Saif Hassan, Kirilo Sztarcsak, Sapho Dlangamandla (ivan) and Heidi Vogel Brockmann (arch) are no_reply_48h, draft discarded');

  -- R-A / R-B (round-1 review): an email reply with no intent, and an earlier ask in the same burst, keep a plain-discarded thread listed
  perform pg_temp.assert_true(exists (select 1 from inbox_true_waiting() w where w.prospect_id = '47ac0603-4b69-5f22-b53f-501b43e858af' and w.kind = 'no_reply_48h' and w.note like 'draft discarded%'),
    'R-A: Mark Woodcock (ivan, email reply, both drafts plain-discarded) is no_reply_48h');
  perform pg_temp.assert_true(exists (select 1 from inbox_true_waiting() w where w.prospect_id = '7e9270f7-933b-434b-92dc-3ec40751bc48' and w.kind = 'no_reply_48h'),
    'R-B: Creative Agency (ivan, "Tell me more" then a reaction) is no_reply_48h');
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting() w where w.name = 'Stefan Davy'), 'negatives stay out: Stefan Davy is not returned');

  -- S1 (synthetic, no live thread has an old and a new waiting draft together): the production ordering of the held-draft clock
  -- picks the OLDEST draft written after the last inbound, so a 72h draft is not hidden by a 12h one
  perform pg_temp.assert_true((select created_at = now() - interval '72 hours' from (
      values (now() - interval '12 hours', now() - interval '100 hours'), (now() - interval '72 hours', now() - interval '100 hours')) d(created_at, in_at)
      order by (d.created_at >= d.in_at) desc, d.created_at asc limit 1),
    'S1: the held clock uses the oldest eligible waiting draft');

  -- S2 (approved / scheduled sends answer the thread) has no live flagged thread to exercise it; the production
  -- check_true_waiting.py compares the function with an independent Python implementation and the independent count above carries the rule.

  -- 6. no thread whose newest draft after its last inbound is a stop / answered_by_send discard is returned; no blacklisted thread
  perform pg_temp.assert_true(not exists (
      select 1 from inbox_true_waiting() w
       where (select d.discard_mode from outreach_messages d
               where d.prospect_id = w.prospect_id and d.direction = 'outbound' and d.sent_at is null
                 and d.created_at >= (select max(coalesce(i.sent_at, i.created_at)) from outreach_messages i where i.prospect_id = w.prospect_id and i.direction = 'inbound')
               order by d.created_at desc, d.id desc limit 1) in ('stop', 'answered_by_send')),
    'no returned thread has a stop / answered_by_send discard as its newest draft after the last inbound');
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting() w join outreach_prospects p on p.id = w.prospect_id where p.blacklisted is distinct from false),
    'no blacklisted thread is returned');

  -- 7. SwishDM: threads flagged after our own send are not returned as no_reply_48h
  perform pg_temp.assert_true(not exists (
      select 1 from inbox_true_waiting('swishdm') w
       where w.kind = 'no_reply_48h'
         and exists (select 1 from outreach_messages o where o.prospect_id = w.prospect_id and o.direction = 'outbound' and o.sent_at is not null
                       and o.message_type is distinct from 'connection_note' and o.sent_at >= w.since)),
    'no swishdm no_reply_48h row has a real send after its last inbound');

  -- 8. integrity: one row per prospect, kinds, seats from outreach_seats
  perform pg_temp.assert_true((select count(*) = count(distinct prospect_id) from inbox_true_waiting()), 'one row per prospect');
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting() w where w.kind not in ('no_reply_48h', 'reply_myself_48h', 'held_draft_48h')), 'only the three kinds');
  perform pg_temp.assert_true(not exists (select 1 from inbox_true_waiting() w where not exists (select 1 from outreach_seats s where s.seat = w.seat)), 'every row seat is an outreach_seats seat');
  perform pg_temp.assert_true((select count(*) from inbox_true_waiting('arch') w where w.seat <> 'arch') = 0, 'a seat argument returns only that seat');
end $$;

rollback;
select 1 as inbox_true_waiting_tests_passed;
