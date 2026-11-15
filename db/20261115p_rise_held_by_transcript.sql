BEGIN;

-- 20261115p_rise_held_by_transcript: record whether each past RISE booking was actually held, from Mattan's Fathom
-- recordings, in separate columns. meeting_outcome is never read for the verdict and never written.
--
-- Why (intel card 20fab8b0, live data 2026-11-15): 100 RISE bookings with a start between 08-01 and now; 73 still say
-- SCHEDULED because nobody marks HubSpot meetings, so the RISE show rate was unknown. Mattan's Fathom recorder lands
-- every call in transcripts (source fathom-risedtc, daily import ~15:00 UTC) with the calendar invitees and which
-- invitee spoke each line, so "the booker spoke on a recording of this slot" is a held call.
--
-- Dry run of this exact logic on live data (read-only, 2026-11-15 21:30 UTC), 100 bookings 08-01..11-15:
--   held 55 (46 email on the slot, 1 full name on the slot, 8 email + moved call), no-show 6, rebooked 1,
--   unknown 35 (32 on Matt's / Kirsten's calendar or a client's recurring invite, 3 on days with no recording at all),
--   internal 2 (Ivan's own bookings), rescheduled 1. All 21 COMPLETED calls on Mattan's calendar come back held.
--   Every held row and every no-show / unknown row on Mattan's calendar was checked by hand against the recordings.
--
-- Columns (all NULL until the job first runs; NULL = not judged or unknown, never a no-show):
--   held_by_transcript  true = held, false = no recording of the booker on a day the recorder ran, NULL = unknown
--   held_transcript_id  transcripts.id of the matched recording (no foreign key: the job re-derives it every run)
--   held_basis          why: email | name | domain | email_moved (true); no_transcript | rebooked (false);
--                       host_not_recorded | recorder_off | pending_ingest | internal_booker | rescheduled (NULL)
--   held_call_start     scheduled start of the matched recording (differs from meeting_start for email_moved)
--   held_checked_at     when the verdict on this row was last written or changed
--
-- Tenant scope: the job reads and writes only client_id = 'risedtc' rows and only fathom-risedtc recordings
-- recorded by mattan@risedtc.com. ARCH and Ivan rows are never touched (their columns stay NULL).
--
-- Readers checked (who-reads --no-indirect booking_attributions, 2026-11-15): 8 + 7 active readers and 4 writers
-- (n8n IBEhtM47QOlroNdo, X8woPv26UrC4Mnhz, siEM4bDSfevuVCII, wyJZ9TcGul7QvDEz) all name their columns or upsert
-- only the columns they send, so none reads, sends or clears the new columns. Database functions that copy whole
-- rows (select * into a row variable: booking_ingest_event, _bk_cancel_row, booking_rejoin_late_prospects,
-- ivan_outreach_truth_compute) are unaffected by extra columns. The 11 dependent views list their columns.
-- Triggers: trg_board_truth_dirty marks RISE board truth dirty on each changed row (the job only updates rows whose
-- verdict changed); trg_client_guard_booking fires only on booker_email / verdict / prospect_id, which stay as they are.
--
-- Public key: booking_attributions is service-role only since 20261115f, and new columns inherit that. The three new
-- functions get EXECUTE revoked from PUBLIC, anon and authenticated (the project's default privileges grant it).
-- Schedule: pg_cron daily 17:30 UTC, after the Fathom import (14:00-15:00 UTC); it re-judges every RISE row each run,
-- so a late-imported recording flips false -> true by itself (Aug/Sep imports ran up to 15 days late).
-- Rollback: 20261115p_rise_held_by_transcript_rollback.sql. Test: 20261115p_rise_held_by_transcript.test.sql.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.booking_attributions
  ADD COLUMN IF NOT EXISTS held_by_transcript boolean,
  ADD COLUMN IF NOT EXISTS held_transcript_id uuid,
  ADD COLUMN IF NOT EXISTS held_basis text,
  ADD COLUMN IF NOT EXISTS held_call_start timestamptz,
  ADD COLUMN IF NOT EXISTS held_checked_at timestamptz;

ALTER TABLE public.booking_attributions
  ADD CONSTRAINT booking_attributions_held_basis_chk CHECK (
    held_basis IS NULL OR held_basis IN ('email','name','domain','email_moved','no_transcript','rebooked',
                                         'host_not_recorded','recorder_off','pending_ingest','internal_booker','rescheduled')),
  ADD CONSTRAINT booking_attributions_held_consistent_chk CHECK (
    (held_by_transcript IS TRUE  AND held_basis IN ('email','name','domain','email_moved') AND held_transcript_id IS NOT NULL)
    OR (held_by_transcript IS FALSE AND held_basis IN ('no_transcript','rebooked') AND held_transcript_id IS NULL)
    OR (held_by_transcript IS NULL AND held_transcript_id IS NULL
        AND (held_basis IS NULL OR held_basis IN ('host_not_recorded','recorder_off','pending_ingest','internal_booker','rescheduled'))));

COMMENT ON COLUMN public.booking_attributions.held_by_transcript IS
  'RISE only. true = the booker spoke on a Fathom recording of this booking; false = no such recording on a day Mattan''s recorder ran; NULL = unknown. Written daily by rise_booking_held_apply(); independent of meeting_outcome.';
COMMENT ON COLUMN public.booking_attributions.held_transcript_id IS 'RISE only. transcripts.id of the recording that proves held_by_transcript = true.';
COMMENT ON COLUMN public.booking_attributions.held_basis IS
  'RISE only. Why held_by_transcript has its value: email | name | domain | email_moved | no_transcript | rebooked | host_not_recorded | recorder_off | pending_ingest | internal_booker | rescheduled.';
COMMENT ON COLUMN public.booking_attributions.held_call_start IS 'RISE only. Scheduled start of the matched recording (differs from meeting_start when the call was moved).';
COMMENT ON COLUMN public.booking_attributions.held_checked_at IS 'RISE only. When the held verdict on this row was last written or changed.';

-- Name key: lower case, accents folded, everything but letters to single spaces ("Gaêlle" -> "gaelle",
-- "Tony Lecy-Siewert" -> "tony lecy siewert", "Donald Tai | Greenlight" -> "donald tai greenlight").
CREATE OR REPLACE FUNCTION public._rise_held_norm(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $f$
  select trim(regexp_replace(regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÑñÇçÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcYyy')), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g'))
$f$;

-- The verdict for every RISE booking whose start is more than 3 h before p_now. Read-only; the dry run is
-- `select * from public.rise_booking_held_compute()`.
CREATE OR REPLACE FUNCTION public.rise_booking_held_compute(p_now timestamptz DEFAULT now())
RETURNS TABLE (meeting_id text, held_by_transcript boolean, held_transcript_id uuid, held_basis text, held_call_start timestamptz)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $f$
with
-- Mattan's Fathom recordings (the only recorder for RISE). The 2026-07-21 "Fixture proof call" row has no
-- recording_start_time and drops out here. July 2026 holds three copies of some recordings: keep the oldest copy of
-- each Fathom recording_id, so copies can never be claimed by different bookings.
tr as (
  select distinct on (coalesce(t.transcript_json->>'recording_id', t.id::text)) t.id,
         coalesce(t.transcript_json->>'scheduled_start_time', t.transcript_json->>'recording_start_time')::timestamptz as slot_start,
         (t.transcript_json->>'recording_start_time')::timestamptz as rec_start,
         regexp_replace(lower(trim(coalesce(t.title, ''))), '\s+', ' ', 'g') as title_key,
         t.transcript_json as j
  from public.transcripts t
  where t.source = 'fathom-risedtc'
    and lower(t.transcript_json->'recorded_by'->>'email') = 'mattan@risedtc.com'
    and t.transcript_json ? 'recording_start_time'
  order by coalesce(t.transcript_json->>'recording_id', t.id::text), t.created_at, t.id
),
-- RISE team names, learned from every recording: anyone carrying an @risedtc.com address as invitee or speaker.
team as (
  select distinct public._rise_held_norm(x->>'name') as nm
  from tr, jsonb_array_elements(coalesce(tr.j->'calendar_invitees', '[]'::jsonb)) x
  where lower(x->>'email') like '%@risedtc.com'
  union
  select distinct public._rise_held_norm(x->'speaker'->>'display_name')
  from tr, jsonb_array_elements(case when jsonb_typeof(tr.j->'transcript') = 'array' then tr.j->'transcript' else '[]'::jsonb end) x
  where lower(x->'speaker'->>'matched_calendar_invitee_email') like '%@risedtc.com'
),
-- Guests who actually SPOKE (calendar invitees are only invitations: a no-show still sits on the invite list).
spk as (
  select tr.id, lower(x->'speaker'->>'matched_calendar_invitee_email') as email,
         public._rise_held_norm(x->'speaker'->>'display_name') as nm, count(*) as lines
  from tr, jsonb_array_elements(case when jsonb_typeof(tr.j->'transcript') = 'array' then tr.j->'transcript' else '[]'::jsonb end) x
  group by 1, 2, 3
),
guest as (
  select s.* from spk s
  where coalesce(s.email, '') not like '%@risedtc.com'
    and s.nm not in (select nm from team where nm <> '')
),
spoke as (  -- recordings where at least one guest spoke 5+ lines
  select id from guest group by id having max(lines) >= 5
),
inv as (
  select tr.id, lower(x->>'email') as email, public._rise_held_norm(x->>'name') as nm
  from tr, jsonb_array_elements(coalesce(tr.j->'calendar_invitees', '[]'::jsonb)) x
  where coalesce((x->>'is_external')::boolean, true)
),
bk as (
  select b.meeting_id, b.meeting_start, b.booked_at, b.slug, b.meeting_title, b.meeting_outcome,
         nullif(lower(trim(b.booker_email)), '') as email,
         nullif(split_part(lower(trim(b.booker_email)), '@', 2), '') as dom,
         public._rise_held_norm(b.booker_name) as nm,
         regexp_replace(lower(trim(coalesce(b.meeting_title, ''))), '\s+', ' ', 'g') as title_key
  from public.booking_attributions b
  where b.client_id = 'risedtc'
    and b.meeting_start is not null
    and b.meeting_start < p_now - interval '3 hours'
),
-- Identity: who on the recording is the booker.
--   email  = booker email is on the invite or is a speaker's matched email
--   name   = booker's full name (first AND last word, 2+ letters each) is one guest speaker's or invitee's name;
--            a first name alone never matches (Michelle Kim vs Michelle Gunter, both RISE bookers)
--   domain = booker's company domain (not a free mailbox) is a guest speaker's or invitee's domain
-- Identity keys per recording: guest speakers plus external invitees (email, domain, name key).
idk as (
  select id, email, split_part(email, '@', 2) as dom, nm from inv
  union
  select id, email, split_part(email, '@', 2), nm from guest
),
bkn as (  -- bookers with a usable full name: first and last word, 2+ letters each
  select meeting_id, split_part(nm, ' ', 1) as first_w, reverse(split_part(reverse(nm), ' ', 1)) as last_w
  from bk
  where array_length(string_to_array(nm, ' '), 1) >= 2
    and length(split_part(nm, ' ', 1)) >= 2
    and length(reverse(split_part(reverse(nm), ' ', 1))) >= 2
),
idm as (
  select distinct b.meeting_id, k.id as tid, 1 as basis_rank, 'email' as basis
  from bk b join idk k on k.email = b.email
  where b.email is not null
  union all
  select distinct n.meeting_id, k.id, 2, 'name'
  from bkn n join idk k
    on (' ' || k.nm || ' ') like ('% ' || n.first_w || ' %')
   and (' ' || k.nm || ' ') like ('% ' || n.last_w || ' %')
  union all
  select distinct b.meeting_id, k.id, 3, 'domain'
  from bk b join idk k on k.dom = b.dom
  where b.dom is not null and b.dom <> ''
    and b.dom not in ('gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','me.com',
                      'aol.com','live.com','msn.com','proton.me','protonmail.com','gmx.com','mail.com')
),
-- Time: the recording's scheduled start within 3 h of the booked slot. For an email match only, a moved call also
-- counts (booking_attributions kept the old time): within 30 h, or within 8 days when the recording carries the
-- booking's own calendar title (the same event dragged to a new day). A later call under another title is a
-- different meeting (Blair Peterson: intro 07-07, audit review 07-13) and never stands in for the slot.
pairs as (
  select i.meeting_id, i.tid, tr.slot_start, i.basis_rank, b.meeting_start, tr.title_key,
         abs(extract(epoch from (tr.slot_start - b.meeting_start))) as gap_s,
         case when abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 3 * 3600 then 0 else 1 end as moved
  from idm i
  join bk b on b.meeting_id = i.meeting_id
  join spoke s on s.id = i.tid
  join tr on tr.id = i.tid
  where abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 3 * 3600
     or (i.basis = 'email'
         and (abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 30 * 3600
              or (abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 8 * 86400
                  and tr.title_key = b.title_key and b.title_key <> '')))
),
best_pair as (
  select distinct on (meeting_id, tid) * from pairs order by meeting_id, tid, moved, basis_rank, gap_s
),
-- One recording counts for one booking at most: the booking it fits best (same slot before moved, email before name
-- before domain, nearest start). Then each booking keeps its best remaining recording.
by_t as (
  select bp.*, row_number() over (partition by tid order by moved, basis_rank, gap_s, meeting_id) as rn
  from best_pair bp
),
matched as (
  select distinct on (meeting_id) meeting_id, tid, slot_start, basis_rank, moved
  from by_t where rn = 1
  order by meeting_id, moved, basis_rank, gap_s, tid
),
held as (
  select b.*, m.tid, m.slot_start as call_start,
         case when m.tid is null then null
              when m.moved = 1 then 'email_moved'
              else (array['email','name','domain'])[m.basis_rank] end as basis
  from bk b left join matched m on m.meeting_id = b.meeting_id
),
judged as (
  select h.meeting_id, h.tid, h.call_start,
    case
      when h.email like '%@risedtc.com' or h.email like '%@ivanmanfredi.com' then 'internal_booker'
      when upper(coalesce(h.meeting_outcome, '')) in ('RESCHEDULED','CANCELED','CANCELLED') then 'rescheduled'
      when h.basis is not null then h.basis
      -- another booking from the same email, made before this slot, landed a held call later: the slot was moved
      when h.email is not null and exists (
             select 1 from held o
             where o.email = h.email and o.meeting_id <> h.meeting_id and o.basis is not null
               and o.meeting_start > h.meeting_start and o.booked_at <= h.meeting_start + interval '1 day') then 'rebooked'
      -- the recorder is Mattan's: a slot on someone else's calendar (Matt, Kirsten) proves nothing when empty
      when not (coalesce(h.slug, '') like 'mattan5%' or (h.slug is null and h.meeting_title ilike '%mattan%')) then 'host_not_recorded'
      -- give the daily Fathom import (about 15:00 UTC, lag up to ~21 h) time to land the call
      when h.meeting_start > p_now - interval '48 hours'
           and not exists (select 1 from tr where tr.rec_start > h.meeting_start + interval '3 hours') then 'pending_ingest'
      -- no recording at all that day (New York date): the recorder was off, so unknown, not a no-show
      when not exists (select 1 from tr where (tr.rec_start at time zone 'America/New_York')::date
                                           = (h.meeting_start at time zone 'America/New_York')::date) then 'recorder_off'
      else 'no_transcript'
    end as basis
  from held h
)
select j.meeting_id,
       case when j.basis in ('email','name','domain','email_moved') then true
            when j.basis in ('no_transcript','rebooked') then false
            else null end as held_by_transcript,
       case when j.basis in ('email','name','domain','email_moved') then j.tid end as held_transcript_id,
       j.basis as held_basis,
       case when j.basis in ('email','name','domain','email_moved') then j.call_start end as held_call_start
from judged j
$f$;

-- Writes the verdicts. Only rows whose verdict changed are updated (so board truth is marked dirty only for real
-- changes); a RISE row that drops out of scope (its start moved back into the future) has its stamps cleared.
-- Never touches meeting_outcome, updated_at or any other column, and never a non-RISE row.
CREATE OR REPLACE FUNCTION public.rise_booking_held_apply(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $f$
declare
  v_changed int := 0;
  v_cleared int := 0;
  v_summary jsonb;
begin
  drop table if exists pg_temp._rise_held;
  create temp table _rise_held on commit drop as select * from public.rise_booking_held_compute(p_now);

  update public.booking_attributions b
     set held_by_transcript = c.held_by_transcript,
         held_transcript_id = c.held_transcript_id,
         held_basis         = c.held_basis,
         held_call_start    = c.held_call_start,
         held_checked_at    = p_now
    from _rise_held c
   where b.meeting_id = c.meeting_id
     and b.client_id = 'risedtc'
     and (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
         is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start);
  get diagnostics v_changed = row_count;

  update public.booking_attributions b
     set held_by_transcript = null, held_transcript_id = null, held_basis = null, held_call_start = null,
         held_checked_at = p_now
   where b.client_id = 'risedtc'
     and b.held_basis is not null
     and not exists (select 1 from _rise_held c where c.meeting_id = b.meeting_id);
  get diagnostics v_cleared = row_count;

  select jsonb_object_agg(coalesce(held_basis, 'null'), n) into v_summary
    from (select held_basis, count(*) n from _rise_held group by 1) s;

  return jsonb_build_object('judged', (select count(*) from _rise_held), 'changed', v_changed,
                            'cleared', v_cleared, 'by_basis', coalesce(v_summary, '{}'::jsonb));
end
$f$;

COMMENT ON FUNCTION public.rise_booking_held_compute(timestamptz) IS
  'Read-only held/no-show verdict for past RISE bookings from Mattan''s Fathom recordings. See db/20261115p.';
COMMENT ON FUNCTION public.rise_booking_held_apply(timestamptz) IS
  'Writes rise_booking_held_compute() into booking_attributions.held_* (RISE rows only, changed rows only). pg_cron daily 17:30 UTC.';

REVOKE ALL ON FUNCTION public._rise_held_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rise_booking_held_compute(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rise_booking_held_apply(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rise_held_norm(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rise_booking_held_compute(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rise_booking_held_apply(timestamptz) TO service_role;

select cron.schedule('rise-booking-held-daily', '30 17 * * *', $c$select public.rise_booking_held_apply()$c$);

COMMIT;
