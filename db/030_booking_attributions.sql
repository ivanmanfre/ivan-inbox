-- 030: Booking attribution verdicts across ALL of Mattan's booking links (2026-08-07)
--
-- One row per HubSpot MEETINGS_PUBLIC meeting. Written by the new tracker workflow
-- (Outreach - RISE Booking Attribution Tracker) and by its 90-day replay backfill.
-- The DoD of the goal-run is checkable ONLY against a per-meeting store:
-- outreach_prospects.call_booked_at is one timestamp per prospect and cannot carry a
-- verdict per meeting (Lia's no-show/rebook is two meetings on one prospect).
--
-- Verdicts (Ivan 08-06 + 08-07):
--   engine_sourced  = we spoke first, evidence-joined to a RISE prospect
--   inbound_engaged = they opened the thread / came inbound during our engagement
--                     period, evidence-joined, with our outbound before the booking
--   unattributed    = no evidence join, or no touch preceding the booking
--
-- evidence_type is the ONLY admissible join that created the verdict:
--   email_exact | stated_email_exact | email_domain | website_domain |
--   linkedin_profile_id | null (unattributed)
-- A name is NEVER an evidence_type. The check constraint makes a name-join
-- unrepresentable, which is the point of the whole run.

create table if not exists public.booking_attributions (
  meeting_id       text primary key,
  client_id        text not null default 'risedtc',
  slug             text,
  meeting_title    text,
  booked_at        timestamptz,          -- hs_createdate (when the booking was made)
  meeting_start    timestamptz,
  meeting_outcome  text,
  booker_email     text,
  booker_name      text,                 -- display only, never evidence
  booker_website   text,
  verdict          text not null check (verdict in ('engine_sourced','inbound_engaged','unattributed')),
  evidence_type    text check (evidence_type is null or evidence_type in
                     ('email_exact','stated_email_exact','email_domain',
                      'website_domain','linkedin_profile_id')),
  evidence_value   text,
  prospect_id      uuid,
  campaign_id      uuid,
  opened_by        text check (opened_by is null or opened_by in ('us','them')),
  rationale        text,
  replayed         boolean not null default false,  -- true = 90-day backfill row
  prospect_stamped boolean not null default false,  -- call_booked_at written on the prospect
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- an attributed verdict without evidence, or evidence without a prospect, is a bug:
  constraint booking_attr_evidence_shape check (
    (verdict = 'unattributed' and evidence_type is null and prospect_id is null)
    or (verdict in ('engine_sourced','inbound_engaged')
        and evidence_type is not null and prospect_id is not null)
  )
);

create index if not exists booking_attributions_client_verdict_idx
  on public.booking_attributions (client_id, verdict, booked_at);
