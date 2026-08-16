-- 034: Grade the evidence behind an attributed booking (2026-08-10)
--
-- WHY. 08-10 booking 114570291777 (David Sanborn, Kiid Coffee) came back
-- engine_sourced on a rule that only asks "did any touch of ours precede the
-- booking". The only touch was a connection request sent 07-28 that he has
-- never accepted (LinkedIn still reads SENT/PENDING 13 days later), no reply,
-- no DM, and he booked on mattan5/rise-dtc-intro-call - a slug our engine has
-- never sent in a single message (0 hits across outreach_messages.message_text;
-- every link we send is rise-intro-call--li). The verdict is defensible on base
-- rates (686 invites in 22 days vs ~2.7 organic bookings/month on that slug),
-- and it is NOT provable.
--
-- The verdict keeps counting for the client. This column records how much
-- evidence is under it, because these rows also drive OUR decisions: cost per
-- booking, which anchors earn Apify spend, whether a campaign converts at all.
-- A booking we inferred must not teach the optimizer the same lesson as one we
-- can trace end to end.
--
--   proven   = a channel actually opened: they replied, or we reached them on a
--              channel that requires acceptance/delivery (dm, inmail), or they
--              booked on a slug only our engine distributes.
--   inferred = our touch was an impression they never visibly acted on, and the
--              booking arrived by a route we cannot see.
--
-- Same rule lives in the tracker (Outreach - RISE Booking Attribution Tracker,
-- node "Attribute Bookings"). Change both or neither.

alter table public.booking_attributions
  add column if not exists evidence_strength text;

comment on column public.booking_attributions.evidence_strength is
  'proven | inferred | null (unattributed). How traceable the verdict is. Never widens or narrows the verdict itself.';

-- Backfill by the same rule the tracker now applies, so the column means one
-- thing across replayed and live rows.
update public.booking_attributions b
set evidence_strength = case
  when b.verdict = 'unattributed' then null
  when b.slug like '%rise-intro-call--li' then 'proven'
  when exists (
    select 1 from public.outreach_messages m
    where m.prospect_id = b.prospect_id
      and coalesce(m.sent_at, m.created_at) < b.booked_at
      and (m.direction = 'inbound' or m.message_type in ('dm', 'inmail'))
  ) then 'proven'
  else 'inferred'
end
where b.evidence_strength is null;

-- Same shape as booking_attr_evidence_shape: an unattributed row carries no
-- grade, and an attributed row cannot exist without one.
alter table public.booking_attributions
  drop constraint if exists booking_attr_strength_shape;

alter table public.booking_attributions
  add constraint booking_attr_strength_shape check (
    (verdict = 'unattributed' and evidence_strength is null)
    or (verdict in ('engine_sourced', 'inbound_engaged') and evidence_strength in ('proven', 'inferred'))
  );
