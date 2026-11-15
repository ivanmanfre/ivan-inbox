BEGIN;

-- 20261115p_rise_held_by_transcript: record whether each past RISE booking was actually held, from Mattan's Fathom
-- recordings, in separate columns. meeting_outcome is never read for the verdict and never written.
--
-- Why (intel card 20fab8b0, live data 2026-11-15): 100 RISE bookings with a start between 08-01 and now; 73 still say
-- SCHEDULED because nobody marks HubSpot meetings, so the RISE show rate was unknown. Mattan's Fathom recorder lands
-- his calls in transcripts (source fathom-risedtc, daily import ~15:00 UTC) with which invitee spoke each line.
--
-- Conservative by design (Sol round 1, 2026-11-15; the stamp feeds a client report, so a wrong held or a wrong
-- no-show costs more than an unknown):
--   held     only when the BOOKER spoke 5+ lines on a recording within 3 h of the slot, the booker proven by email
--            (Fathom matched the speaker to the booker's email, or linked the booker's invite to that speaker, or the
--            display name is the booker email) or by full first+last name with no contradicting known email.
--            A colleague, an invitee who never spoke, a domain, or a first name alone never makes a call held.
--   no-show  only on Mattan's own booking page (slug mattan5*), past the 48 h import grace, when his recorder made
--            another recording in the same session (same New York day, within 4 h), no recording of the booker
--            exists within 14 days, and no unidentified guest spoke on the slot's own recording.
--   unknown  (NULL) everything else; a call that moved shows as met_other_time (no event id links a HubSpot meeting
--            to a Fathom recording, so a moved call is never assumed).
--
-- Dry run of this exact logic on live data (read-only, p_now 2026-11-15 21:30 UTC), 100 bookings 08-01..11-15:
--   held 40 (37 email, 3 name), no-show 4, unknown 56, internal 2 + rescheduled 1 inside the unknown.
--
-- Columns (all NULL until the job first runs; NULL = not judged or unknown, never a no-show):
--   held_by_transcript  true = held, false = no-show (rules above), NULL = unknown
--   held_transcript_id  transcripts.id of the matched recording (no foreign key: the job re-derives it every run)
--   held_basis          email | name (true); no_transcript (false); met_other_time | unverified_speaker |
--                       host_not_recorded | pending_ingest | recorder_off | internal_booker | rescheduled (NULL)
--   held_call_start     scheduled start of the matched recording
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
-- Schedule: pg_cron 17:30 and 23:30 UTC (after the ~15:00 UTC Fathom import); each run re-judges every RISE row, so
-- a late-imported recording corrects the stamp by itself. Each run: lock_timeout 2 s, statement_timeout 120 s; a run
-- that cannot get a lock aborts and the next run retries. The matcher reads first (~3 s) and only then updates.
-- Rollback: 20261115p_rise_held_by_transcript_rollback.sql.
-- Tests: 20261115p_rise_held_by_transcript.test.sql (ISOLATED DATABASE ONLY, never live) and
--        20261115p_rise_held_by_transcript.postdeploy.sql (read-only checks for live after apply).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.booking_attributions
  ADD COLUMN IF NOT EXISTS held_by_transcript boolean,
  ADD COLUMN IF NOT EXISTS held_transcript_id uuid,
  ADD COLUMN IF NOT EXISTS held_basis text,
  ADD COLUMN IF NOT EXISTS held_call_start timestamptz,
  ADD COLUMN IF NOT EXISTS held_checked_at timestamptz;

ALTER TABLE public.booking_attributions
  ADD CONSTRAINT booking_attributions_held_basis_chk CHECK ((
    held_basis IS NULL OR held_basis IN ('email','name','no_transcript','met_other_time','unverified_speaker',
                                         'host_not_recorded','pending_ingest','recorder_off','internal_booker','rescheduled')) IS TRUE),
  ADD CONSTRAINT booking_attributions_held_consistent_chk CHECK ((
    (held_by_transcript IS TRUE  AND held_basis IN ('email','name') AND held_transcript_id IS NOT NULL AND held_call_start IS NOT NULL)
    OR (held_by_transcript IS FALSE AND held_basis = 'no_transcript' AND held_transcript_id IS NULL AND held_call_start IS NULL)
    OR (held_by_transcript IS NULL AND held_transcript_id IS NULL AND held_call_start IS NULL
        AND (held_basis IS NULL OR held_basis IN ('met_other_time','unverified_speaker','host_not_recorded',
                                                  'pending_ingest','recorder_off','internal_booker','rescheduled')))) IS TRUE);

COMMENT ON COLUMN public.booking_attributions.held_by_transcript IS
  'RISE only. true = the booker spoke on a Fathom recording of this booking; false = no-show under strict coverage rules; NULL = unknown. Written by rise_booking_held_apply(); independent of meeting_outcome. See db/20261115p.';
COMMENT ON COLUMN public.booking_attributions.held_transcript_id IS 'RISE only. transcripts.id of the recording that proves held_by_transcript = true.';
COMMENT ON COLUMN public.booking_attributions.held_basis IS
  'RISE only. Why held_by_transcript has its value: email | name | no_transcript | met_other_time | unverified_speaker | host_not_recorded | pending_ingest | recorder_off | internal_booker | rescheduled.';
COMMENT ON COLUMN public.booking_attributions.held_call_start IS 'RISE only. Scheduled start of the matched recording.';
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
-- `select * from public.rise_booking_held_compute()`. input_fp fingerprints the booking inputs the verdict used, so
-- the writer can refuse to stamp a row that changed after it was judged.
CREATE OR REPLACE FUNCTION public.rise_booking_held_compute(p_now timestamptz DEFAULT now())
RETURNS TABLE (meeting_id text, held_by_transcript boolean, held_transcript_id uuid, held_basis text,
               held_call_start timestamptz, input_fp text)
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
         t.transcript_json as j
  from public.transcripts t
  where t.source = 'fathom-risedtc'
    and lower(t.transcript_json->'recorded_by'->>'email') = 'mattan@risedtc.com'
    and t.transcript_json ? 'recording_start_time'
  order by coalesce(t.transcript_json->>'recording_id', t.id::text), t.created_at, t.id
),
-- Who spoke, per recording: Fathom's matched invitee email (if any), the display name, lines spoken.
spk as (
  select tr.id, lower(nullif(x->'speaker'->>'matched_calendar_invitee_email', '')) as email,
         lower(trim(coalesce(x->'speaker'->>'display_name', ''))) as dn,
         public._rise_held_norm(x->'speaker'->>'display_name') as nm, count(*) as lines
  from tr, jsonb_array_elements(case when jsonb_typeof(tr.j->'transcript') = 'array' then tr.j->'transcript' else '[]'::jsonb end) x
  group by 1, 2, 3, 4
),
-- Calendar invitees (invitations only, never proof of attendance) with Fathom's own invitee -> speaker link.
inv as (
  select tr.id, lower(nullif(x->>'email', '')) as email, public._rise_held_norm(x->>'name') as nm,
         lower(trim(coalesce(x->>'matched_speaker_display_name', ''))) as matched_dn,
         coalesce((x->>'is_external')::boolean, true) as is_external
  from tr, jsonb_array_elements(coalesce(tr.j->'calendar_invitees', '[]'::jsonb)) x
),
-- RISE team names, learned from @risedtc.com invitees/speakers; used ONLY for speakers that carry no email.
team as (
  select nm from inv where email like '%@risedtc.com' and nm <> ''
  union
  select nm from spk where email like '%@risedtc.com' and nm <> ''
),
-- Guests: a speaker with a non-RISE email, or with no email and a name that is not a RISE team name.
guest as (
  select s.* from spk s
  where (s.email is not null and s.email not like '%@risedtc.com')
     or (s.email is null and s.nm <> '' and s.nm not in (select nm from team))
),
bk as (
  select b.meeting_id, b.meeting_start, b.slug, b.meeting_outcome,
         nullif(lower(trim(b.booker_email)), '') as email,
         public._rise_held_norm(b.booker_name) as nm,
         md5(concat_ws('|', b.meeting_start, b.booker_email, b.booker_name, b.meeting_outcome, b.slug, b.meeting_title)) as fp,
         (lower(coalesce(b.booker_email, '')) like '%@risedtc.com' or lower(coalesce(b.booker_email, '')) like '%@ivanmanfredi.com') as internal,
         upper(coalesce(b.meeting_outcome, '')) in ('RESCHEDULED','CANCELED','CANCELLED') as dead
  from public.booking_attributions b
  where b.client_id = 'risedtc'
    and b.meeting_start is not null
    and b.meeting_start < p_now - interval '3 hours'
),
bkn as (  -- bookers with a usable full name: first and last word, 2+ letters each
  select meeting_id, email, split_part(nm, ' ', 1) as first_w, reverse(split_part(reverse(nm), ' ', 1)) as last_w
  from bk
  where array_length(string_to_array(nm, ' '), 1) >= 2
    and length(split_part(nm, ' ', 1)) >= 2
    and length(reverse(split_part(reverse(nm), ' ', 1))) >= 2
),
-- The BOOKER spoke (never a colleague, never "someone on the invite"):
--   email: the speaker's Fathom-matched email is the booker email, or the display name IS the booker email, or
--          Fathom linked the booker's invite entry to this speaker;
--   name:  the speaker has no matched email, carries the booker's first AND last word, and nobody on that recording
--          (invitee or speaker) with the same first+last words holds a different known email.
booker_speech as (
  select meeting_id, tid, min(basis_rank) as basis_rank, sum(lines) as lines
  from (
    select distinct b.meeting_id, s.id as tid, 1 as basis_rank, s.dn, s.email as s_email, s.lines
    from bk b join spk s on s.email = b.email or s.dn = b.email
    where b.email is not null
    union
    select distinct b.meeting_id, s.id, 1, s.dn, s.email, s.lines
    from bk b
    join inv i on i.email = b.email and i.matched_dn <> ''
    join spk s on s.id = i.id and s.dn = i.matched_dn and (s.email is null or s.email = b.email)
    where b.email is not null
    union
    select distinct n.meeting_id, s.id, 2, s.dn, s.email, s.lines
    from bkn n
    join spk s on s.email is null
              and (' ' || s.nm || ' ') like ('% ' || n.first_w || ' %')
              and (' ' || s.nm || ' ') like ('% ' || n.last_w || ' %')
    where not exists (
            select 1 from (select i.email, i.nm from inv i where i.id = s.id
                           union all select s2.email, s2.nm from spk s2 where s2.id = s.id) o
            where o.email is not null
              and o.email is distinct from n.email
              and (' ' || o.nm || ' ') like ('% ' || n.first_w || ' %')
              and (' ' || o.nm || ' ') like ('% ' || n.last_w || ' %'))
  ) z
  group by meeting_id, tid
  having sum(lines) >= 5
),
-- A held recording sits within 3 h of the booked slot. Cancelled/rescheduled and internal bookings never take part,
-- so they cannot claim a recording away from the live booking. One recording counts for one booking (nearest start,
-- then email before name), then each booking keeps its best recording.
pairs as (
  select s.meeting_id, s.tid, tr.slot_start, s.basis_rank,
         abs(extract(epoch from (tr.slot_start - b.meeting_start))) as gap_s
  from booker_speech s
  join bk b on b.meeting_id = s.meeting_id and not b.internal and not b.dead
  join tr on tr.id = s.tid
  where abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 3 * 3600
),
by_t as (
  select p.*, row_number() over (partition by tid order by gap_s, basis_rank, meeting_id) as rn from pairs p
),
matched as (
  select distinct on (meeting_id) meeting_id, tid, slot_start, basis_rank
  from by_t where rn = 1
  order by meeting_id, gap_s, basis_rank, tid
),
judged as (
  select b.meeting_id, b.fp, m.tid, m.slot_start as call_start,
    case
      when b.internal then 'internal_booker'
      when b.dead then 'rescheduled'
      when m.tid is not null then (array['email','name'])[m.basis_rank]
      -- the booker spoke on a recording at another time (moved call, rebooking, or a separate meeting): no event id
      -- links a HubSpot meeting to a Fathom recording, so the slot itself is unknown, never held and never a no-show
      when exists (select 1 from booker_speech s join tr on tr.id = s.tid
                   where s.meeting_id = b.meeting_id
                     and abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 14 * 86400) then 'met_other_time'
      -- someone external spoke on this slot's own recording (or on a recording the booker was invited to near the
      -- slot) but it cannot be proven to be the booker: unknown
      when exists (select 1 from tr join guest g on g.id = tr.id and g.lines >= 5
                   where abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 15 * 60
                      or (abs(extract(epoch from (tr.slot_start - b.meeting_start))) <= 3 * 3600
                          and exists (select 1 from inv i where i.id = tr.id and i.email = b.email))) then 'unverified_speaker'
      -- the recorder is Mattan's: only his own booking page proves the slot was his (NULL slug -> unknown)
      when (b.slug like 'mattan5%') is not true then 'host_not_recorded'
      -- full grace for the daily Fathom import (lag up to ~21 h; Aug/Sep backfills ran days late, re-judged nightly)
      when b.meeting_start > p_now - interval '48 hours' then 'pending_ingest'
      -- coverage: Mattan's recorder must have produced a recording in the same session (same New York day, started
      -- within 4 h of the slot); otherwise the recorder may have been off, so unknown, not a no-show
      when not exists (select 1 from tr where (tr.rec_start at time zone 'America/New_York')::date
                                           = (b.meeting_start at time zone 'America/New_York')::date
                                      and abs(extract(epoch from (tr.rec_start - b.meeting_start))) <= 4 * 3600) then 'recorder_off'
      else 'no_transcript'
    end as basis
  from bk b left join matched m on m.meeting_id = b.meeting_id
)
select j.meeting_id,
       case when j.basis in ('email','name') then true
            when j.basis = 'no_transcript' then false
            else null end as held_by_transcript,
       case when j.basis in ('email','name') then j.tid end as held_transcript_id,
       j.basis as held_basis,
       case when j.basis in ('email','name') then j.call_start end as held_call_start,
       j.fp as input_fp
from judged j
$f$;

-- Writes the verdicts. A row is stamped only if it is still RISE, still past start + 3 h, and its booking inputs
-- still match the fingerprint the verdict was computed from (a concurrent edit is skipped and picked up next run);
-- only rows whose verdict changed are updated, so board truth is marked dirty only for real changes. A RISE row
-- whose start is now unknown or less than 3 h ago has its stamps cleared, judged on the row as it is at write time.
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
  -- never queue behind booking writers for long: abort, the next run retries
  perform set_config('lock_timeout', '2s', true);

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
     and b.meeting_start < p_now - interval '3 hours'
     and md5(concat_ws('|', b.meeting_start, b.booker_email, b.booker_name, b.meeting_outcome, b.slug, b.meeting_title)) = c.input_fp
     and (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
         is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start);
  get diagnostics v_changed = row_count;

  update public.booking_attributions b
     set held_by_transcript = null, held_transcript_id = null, held_basis = null, held_call_start = null,
         held_checked_at = p_now
   where b.client_id = 'risedtc'
     and (b.held_basis is not null or b.held_by_transcript is not null)
     and (b.meeting_start is null or b.meeting_start >= p_now - interval '3 hours');
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
  'Writes rise_booking_held_compute() into booking_attributions.held_* (RISE rows only, changed rows only). pg_cron 17:30 and 23:30 UTC.';

REVOKE ALL ON FUNCTION public._rise_held_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rise_booking_held_compute(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rise_booking_held_apply(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rise_held_norm(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rise_booking_held_compute(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rise_booking_held_apply(timestamptz) TO service_role;

select cron.schedule('rise-booking-held-daily', '30 17,23 * * *',
  $c$set statement_timeout = '120s'; set lock_timeout = '2s'; select public.rise_booking_held_apply()$c$);

COMMIT;
