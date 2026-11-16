BEGIN;

-- 20261116b_arch_held_by_transcript: the held-by-transcript stamp of 20261115p, for ARCH (client Davorin), from
-- Davorin's Fireflies recordings. Same five held_* columns on booking_attributions, written by two NEW functions and
-- a NEW cron job. Nothing of the RISE path changes: rise_booking_held_compute / rise_booking_held_apply /
-- _rise_held_norm and job 360 are not replaced, and the ARCH functions read and write only client_id = 'arch' rows.
-- meeting_outcome is never read for the verdict and never written.
--
-- Why (live data 2026-11-16): 10 of 11 past engine-sourced ARCH bookings still say SCHEDULED (nobody marks the
-- HubSpot meeting); Davorin's Fireflies bot lands his calls in transcripts (source fireflies-arch, daily import
-- ~06:30-07:35 UTC) with each line labelled by speaker name.
--
-- How Fireflies differs from Mattan's Fathom (and why the rules below are not a copy):
--   * no speaker emails: a line is "Name: text"; `participants` is the calendar invite list (emails), never proof of
--     attendance. So the only proof of the booker is their full name on 5+ lines, on a recording whose speaker labels
--     the ingestor marked reliable (diarization.labels_reliable), with the booker's email on that recording's invite
--     when the booking has an email. A first name or nickname ("Liza") alone never makes a call held.
--   * Fireflies is a bot that joins calendar meetings: it records empty sessions (09-21 Matija, 09-24 Reachers, 11-12
--     Mia Dige: 11-12 minutes, no line at all) and records nothing when it was not in the meeting. So a missing
--     recording is not a no-show (unknown: recorder_off / host_not_recorded), and an empty recording is not either
--     (unknown: unverified_speaker). A no-show needs the slot's own recording, with the booker on its invite, where
--     only Davorin spoke.
--
-- Rules (conservative; the stamp feeds a client report, so a wrong held or a wrong no-show costs more than unknown):
--   held     the BOOKER spoke 5+ lines on a Davorin recording that starts within 15 min of the slot (name basis
--            above; a recording further off may be another meeting with the same person). A label carrying Davorin's
--            first name ("Davorin Smit (ARCH)", "Davor") is never booker speech, and a booker whose own name carries it
--            stays unknown. If the speaking name also fits another booker invited to that recording under a different
--            email, nobody is held. One recording counts for one booking (nearest start), then each booking keeps its
--            best recording.
--   no-show  past a 96 h import grace (live lag reached 2 d 21 h since 09-15), the slot's own recording (start within
--            15 min, booker email on the invite) exists, has lines, its labels are marked reliable, and every line is
--            the exact "Davorin Smit" label; the booker said nothing on any recording within 14 days and was not
--            invited to another recording within 14 days. (The ingestor marks labels reliable only with 2+ speakers
--            of 5+ lines, so today no real recording can prove a no-show; the rule exists for a corrected ingestor.)
--   unknown  (NULL) everything else; a call that moved shows as met_other_time (no event id links a HubSpot meeting
--            to a Fireflies recording, so a moved call is never assumed held).
--   staff    a booker email (trimmed, lower case) at @arch.agency or @ivanmanfredi.com is internal_booker (never judged).
--
-- Replay of this exact migration on live data (one rolled-back transaction, p_now 2026-11-16 12:00 UTC), 36 ARCH
-- rows: held 4 (Legends 09-23, Pixel Federation 09-28, DoktorABC 10-05, Funcell 11-10 08:00), no-show 0, unknown 32
-- (host_not_recorded 20 = Marko Jovic's interview calendar, recorder_off 5, met_other_time 5, unverified_speaker 1,
-- rescheduled 1). Engine-sourced: 11 past rows, held 4, unknown 7. RISE compute 147 rows byte-identical.
--
-- held_basis values used here (the existing CHECKs of 20261115p allow all of them, so no table change):
--   name (true); no_transcript (false); met_other_time | unverified_speaker | host_not_recorded | pending_ingest |
--   recorder_off | internal_booker | rescheduled (NULL).
--
-- Readers: nothing outside the RISE functions reads held_* (git grep ivan-inbox / claude-code-railway, pg_proc,
-- pg_views, 2026-11-16). Triggers on the ARCH updates: trg_board_truth_dirty marks ARCH board truth dirty per changed
-- row (only rows whose verdict changed are updated); trg_client_guard_booking fires only on booker_email / verdict /
-- prospect_id, which stay as they are.
-- Public key: booking_attributions is service-role only since 20261115f; the three new functions get EXECUTE revoked
-- from PUBLIC, anon and authenticated.
-- Schedule: pg_cron 08:45 and 20:45 UTC (after the ~07:30 UTC Fireflies import); each run re-judges every ARCH row.
-- Rollback: 20261116b_arch_held_by_transcript_rollback.sql (ARCH objects and ARCH stamps only; RISE untouched).
-- Tests: 20261116b_arch_held_by_transcript.test.sql (one transaction that always rolls back; no table DDL) and
--        20261116b_arch_held_by_transcript.postdeploy.sql (read-only checks after apply).

SET LOCAL lock_timeout = '5s';

COMMENT ON COLUMN public.booking_attributions.held_by_transcript IS
  'RISE and ARCH only. true = the booker spoke on a recording of this booking (RISE Fathom, ARCH Fireflies); false = no-show under strict coverage rules; NULL = unknown. Written by rise_booking_held_apply() / arch_booking_held_apply(); independent of meeting_outcome. See db/20261115p, db/20261116b.';
COMMENT ON COLUMN public.booking_attributions.held_transcript_id IS 'RISE and ARCH only. transcripts.id of the recording that proves held_by_transcript = true.';
COMMENT ON COLUMN public.booking_attributions.held_basis IS
  'RISE and ARCH only. Why held_by_transcript has its value: email | name | no_transcript | met_other_time | unverified_speaker | host_not_recorded | pending_ingest | recorder_off | internal_booker | rescheduled.';
COMMENT ON COLUMN public.booking_attributions.held_call_start IS 'RISE and ARCH only. Scheduled start of the matched recording.';
COMMENT ON COLUMN public.booking_attributions.held_checked_at IS 'RISE and ARCH only. When the held verdict on this row was last written or changed.';

-- Name key, same as _rise_held_norm (own copy so the RISE rollback can never break the ARCH job and vice versa):
-- lower case, accents folded, everything but letters to single spaces ("Vjeran Belošević" -> "vjeran belosevic").
CREATE OR REPLACE FUNCTION public._arch_held_norm(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $f$
  select trim(regexp_replace(regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÑñÇçÝýÿŠšŽžČčĆćĐđ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcYyySsZzCcCcDd')), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g'))
$f$;

-- The verdict for every ARCH booking whose start is more than 3 h before p_now. Read-only; the dry run is
-- `select * from public.arch_booking_held_compute()`. input_fp fingerprints the booking inputs the verdict used
-- (same expression as RISE), so the writer can refuse to stamp a row that changed after it was judged.
CREATE OR REPLACE FUNCTION public.arch_booking_held_compute(p_now timestamptz DEFAULT now())
RETURNS TABLE (meeting_id text, held_by_transcript boolean, held_transcript_id uuid, held_basis text,
               held_call_start timestamptz, input_fp text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $f$
with
-- Davorin's Fireflies recordings (his bot is on every fireflies-arch row). transcripts.date is the meeting start.
-- One row per Fireflies recording_id (oldest copy), so copies can never be claimed by different bookings.
tr as (
  select distinct on (coalesce(t.transcript_json->>'recording_id', t.id::text)) t.id,
         t.date as slot_start,
         array(select lower(btrim(p, E' \t\r\n')) from unnest(coalesce(t.participants, '{}'::text[])) p) as parts,
         coalesce((t.diarization->>'labels_reliable')::boolean, false) as reliable,
         t.transcript_text as txt
  from public.transcripts t
  where t.source = 'fireflies-arch'
    and t.date is not null
    and 'davorinsmit@arch.agency' = any(array(select lower(btrim(p, E' \t\r\n')) from unnest(coalesce(t.participants, '{}'::text[])) p))
  order by coalesce(t.transcript_json->>'recording_id', t.id::text), t.created_at, t.id
),
-- Who spoke, per recording: the "Name:" label of each line, normalized, and how many lines it has. host_like marks
-- any label carrying Davorin's first name as a word ("davorin smit", "davor", "davorin smit arch"): such a label is
-- never booker speech (Sol r1 #2).
spk0 as (
  select tr.id, public._arch_held_norm(substring(x from '^([^:\n]{1,80}):\s')) as nm, count(*) as lines
  from tr, regexp_split_to_table(coalesce(tr.txt, ''), E'\n') x
  where substring(x from '^([^:\n]{1,80}):\s') is not null
  group by 1, 2
),
spk as (
  select spk0.*, spk0.nm ~ '(^| )davor(in)?( |$)' as host_like from spk0
),
-- Per recording: any line at all, and any line by someone other than Davorin (an empty or non-Latin label counts as
-- someone else). Staff speakers count as "someone else" too: that can only make a no-show less likely.
rec as (
  select tr.id, tr.slot_start, tr.parts, tr.reliable,
         exists (select 1 from spk s where s.id = tr.id) as has_lines,
         exists (select 1 from spk s where s.id = tr.id and s.nm <> 'davorin smit') as other_spoke
  from tr
),
bk0 as (
  select b.meeting_id, b.meeting_start, b.slug, b.meeting_title, b.meeting_outcome,
         nullif(lower(btrim(b.booker_email, E' \t\r\n')), '') as email,
         public._arch_held_norm(b.booker_name) as nm,
         md5(jsonb_build_array(b.meeting_start, b.booker_email, b.booker_name, b.meeting_outcome, b.slug, b.meeting_title)::text) as fp,
         upper(coalesce(b.meeting_outcome, '')) in ('RESCHEDULED','CANCELED','CANCELLED') as dead
  from public.booking_attributions b
  where b.client_id = 'arch'
    and b.meeting_start is not null
    and b.meeting_start < p_now - interval '3 hours'
),
-- internal from the same trimmed, lower-cased email the invite match uses (Sol r1 #6); host_collision = the booker
-- carries Davorin's first name as a word, so their speech cannot be told from his (Sol r1 #2): always unknown.
bk as (
  select bk0.*,
         (coalesce(bk0.email, '') like '%@arch.agency' or coalesce(bk0.email, '') like '%@ivanmanfredi.com') as internal,
         bk0.nm ~ '(^| )davor(in)?( |$)' as host_collision
  from bk0
),
bkn as (  -- bookers with a usable full name: first and last word, 2+ letters each. Host-name collisions stay in, so
          -- they still count as a competing same-name booker in the veto below (Sol r2); pairs and judged keep them unknown.
  select meeting_id, email, split_part(nm, ' ', 1) as first_w, reverse(split_part(reverse(nm), ' ', 1)) as last_w
  from bk
  where array_length(string_to_array(nm, ' '), 1) >= 2
    and length(split_part(nm, ' ', 1)) >= 2
    and length(reverse(split_part(reverse(nm), ' ', 1))) >= 2
),
-- Any speech under the booker's full name (first AND last word in the label), never Davorin's own label. Used to
-- keep a slot unknown (unverified / met another time); it proves nothing by itself.
booker_speech_all as (
  select n.meeting_id, s.id as tid, sum(s.lines) as lines
  from bkn n
  join spk s on not s.host_like
            and (' ' || s.nm || ' ') like ('% ' || n.first_w || ' %')
            and (' ' || s.nm || ' ') like ('% ' || n.last_w || ' %')
  group by 1, 2
),
-- Enough to prove the booker attended: 5+ lines, labels marked reliable by the ingestor, (when the booking has an
-- email) the booker's email on that recording's invite, and the speaking name fits no OTHER booker invited to that
-- recording under a different email (two people with one name: nobody is held, Sol r1 #3).
booker_speech as (
  select s.meeting_id, s.tid
  from booker_speech_all s
  join bkn n on n.meeting_id = s.meeting_id
  join rec r on r.id = s.tid
  where s.lines >= 5 and r.reliable and (n.email is null or n.email = any(r.parts))
    and not exists (select 1 from spk s2 join bkn n2 on n2.meeting_id <> n.meeting_id
                    where s2.id = s.tid and not s2.host_like
                      and (' ' || s2.nm || ' ') like ('% ' || n.first_w || ' %')
                      and (' ' || s2.nm || ' ') like ('% ' || n.last_w || ' %')
                      and (' ' || s2.nm || ' ') like ('% ' || n2.first_w || ' %')
                      and (' ' || s2.nm || ' ') like ('% ' || n2.last_w || ' %')
                      and n2.email is not null and n2.email is distinct from n.email
                      and n2.email = any(r.parts))
),
-- A held recording starts within 15 min of the booked slot (no event id links a booking to a recording, so a
-- recording further off may be another meeting with the same person: unknown, Sol r1 #4). Cancelled/rescheduled,
-- internal and host-name bookings never take part.
-- One recording counts for one booking (nearest start), then each booking keeps its best recording.
pairs as (
  select s.meeting_id, s.tid, r.slot_start,
         abs(extract(epoch from (r.slot_start - b.meeting_start))) as gap_s
  from booker_speech s
  join bk b on b.meeting_id = s.meeting_id and not b.internal and not b.dead and not b.host_collision
  join rec r on r.id = s.tid
  where abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 15 * 60
),
by_t as (
  select p.*, row_number() over (partition by tid order by gap_s, meeting_id) as rn from pairs p
),
matched as (
  select distinct on (meeting_id) meeting_id, tid, slot_start
  from by_t where rn = 1
  order by meeting_id, gap_s, tid
),
judged as (
  select b.meeting_id, b.fp, m.tid, m.slot_start as call_start,
    case
      when b.internal then 'internal_booker'
      when b.dead then 'rescheduled'
      when b.host_collision then 'unverified_speaker'
      when m.tid is not null then 'name'
      -- the booker spoke within 3 h of the slot but not enough to prove it (too little, unreliable labels, no invite,
      -- a same-name second booker, more than 15 min off, or the recording went to another booking): unknown
      when exists (select 1 from booker_speech_all s join rec r on r.id = s.tid
                   where s.meeting_id = b.meeting_id
                     and abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 3 * 3600) then 'unverified_speaker'
      -- the booker spoke on a recording at another time (moved call, rebooking, or a separate meeting): unknown
      when exists (select 1 from booker_speech_all s join rec r on r.id = s.tid
                   where s.meeting_id = b.meeting_id
                     and abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 14 * 86400) then 'met_other_time'
      -- the slot's own recording (within 15 min), or a recording near the slot the booker was invited to, is empty,
      -- has labels the ingestor marked unreliable (Sol r1 #1), or has anyone but the exact "Davorin Smit" label on
      -- it: unknown, never a no-show
      when exists (select 1 from rec r
                   where (not r.has_lines or r.other_spoke or not r.reliable)
                     and (abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 15 * 60
                          or (abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 3 * 3600
                              and b.email = any(r.parts)))) then 'unverified_speaker'
      -- the booker was on the invite of a recording at another time within 14 days: the call may have moved
      when b.email is not null
           and exists (select 1 from rec r
                       where b.email = any(r.parts)
                         and abs(extract(epoch from (r.slot_start - b.meeting_start))) > 15 * 60
                         and abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 14 * 86400) then 'met_other_time'
      -- only Davorin's calendar is recorded: his booking page, or a calendar event that names him
      when ((b.slug like 'davorin-smit/%')
            or (b.slug is null and b.meeting_title ilike '%davorin%')) is not true then 'host_not_recorded'
      -- full grace for the daily Fireflies import
      when b.meeting_start > p_now - interval '96 hours' then 'pending_ingest'
      -- the slot's own recording, booker invited, labels reliable, only Davorin spoke: he waited, the booker never came
      when b.email is not null
           and exists (select 1 from rec r
                       where abs(extract(epoch from (r.slot_start - b.meeting_start))) <= 15 * 60
                         and b.email = any(r.parts) and r.has_lines and not r.other_spoke and r.reliable) then 'no_transcript'
      -- no recording of this slot: the bot was not in the meeting, so nothing is known
      else 'recorder_off'
    end as basis
  from bk b left join matched m on m.meeting_id = b.meeting_id
)
select j.meeting_id,
       case when j.basis = 'name' then true
            when j.basis = 'no_transcript' then false
            else null end as held_by_transcript,
       case when j.basis = 'name' then j.tid end as held_transcript_id,
       j.basis as held_basis,
       case when j.basis = 'name' then j.call_start end as held_call_start,
       j.fp as input_fp
from judged j
$f$;

-- Writes the verdicts. Same writer as rise_booking_held_apply, scoped to client_id = 'arch': a row is stamped only
-- if it is still ARCH, still past start + 3 h, and its booking inputs still match the fingerprint; only rows whose
-- verdict changed are updated. An ARCH row whose start is now unknown or less than 3 h ago has its stamps cleared.
-- Never touches meeting_outcome, updated_at or any other column, and never a non-ARCH row.
CREATE OR REPLACE FUNCTION public.arch_booking_held_apply(p_now timestamptz DEFAULT now())
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

  drop table if exists pg_temp._arch_held;
  create temp table _arch_held on commit drop as select * from public.arch_booking_held_compute(p_now);

  update public.booking_attributions b
     set held_by_transcript = c.held_by_transcript,
         held_transcript_id = c.held_transcript_id,
         held_basis         = c.held_basis,
         held_call_start    = c.held_call_start,
         held_checked_at    = p_now
    from _arch_held c
   where b.meeting_id = c.meeting_id
     and b.client_id = 'arch'
     and b.meeting_start < p_now - interval '3 hours'
     and md5(jsonb_build_array(b.meeting_start, b.booker_email, b.booker_name, b.meeting_outcome, b.slug, b.meeting_title)::text) = c.input_fp
     and (b.held_by_transcript, b.held_transcript_id, b.held_basis, b.held_call_start)
         is distinct from (c.held_by_transcript, c.held_transcript_id, c.held_basis, c.held_call_start);
  get diagnostics v_changed = row_count;

  update public.booking_attributions b
     set held_by_transcript = null, held_transcript_id = null, held_basis = null, held_call_start = null,
         held_checked_at = p_now
   where b.client_id = 'arch'
     and (b.held_basis is not null or b.held_by_transcript is not null)
     and (b.meeting_start is null or b.meeting_start >= p_now - interval '3 hours');
  get diagnostics v_cleared = row_count;

  select jsonb_object_agg(coalesce(held_basis, 'null'), n) into v_summary
    from (select held_basis, count(*) n from _arch_held group by 1) s;

  return jsonb_build_object('judged', (select count(*) from _arch_held), 'changed', v_changed,
                            'cleared', v_cleared, 'by_basis', coalesce(v_summary, '{}'::jsonb));
end
$f$;

COMMENT ON FUNCTION public.arch_booking_held_compute(timestamptz) IS
  'Read-only held/no-show verdict for past ARCH bookings from Davorin''s Fireflies recordings. See db/20261116b.';
COMMENT ON FUNCTION public.arch_booking_held_apply(timestamptz) IS
  'Writes arch_booking_held_compute() into booking_attributions.held_* (ARCH rows only, changed rows only). pg_cron 08:45 and 20:45 UTC.';

REVOKE ALL ON FUNCTION public._arch_held_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arch_booking_held_compute(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arch_booking_held_apply(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._arch_held_norm(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.arch_booking_held_compute(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.arch_booking_held_apply(timestamptz) TO service_role;

select cron.schedule('arch-booking-held-daily', '45 8,20 * * *',
  $c$set statement_timeout = '120s'; set lock_timeout = '2s'; select public.arch_booking_held_apply()$c$);

COMMIT;
