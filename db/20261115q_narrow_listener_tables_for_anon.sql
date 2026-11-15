BEGIN;

-- 20261115q_narrow_listener_tables_for_anon Batch 2 of 3: the four tables the Ivan Listener menu-bar app reads with
-- the public (anon) key. The public key keeps SELECT on exactly the columns Listener asks for and loses everything
-- else. Not a full lock: the row policy stays, because Listener has no other credential for these reads.
--
-- Why not a full lock: Listener (~/Desktop/ivan-listener/menubar, CalendarFetcher.swift and SalesScript.swift) carries
-- the public key as a literal in the app binary and has no signed-in session. Any path it can reach, a stranger with the
-- same key can reach. Closing these tables to anon needs a new app build that Ivan installs (see the PR text). This
-- batch is the part that needs no build.
-- What it closes today: transcript text, summaries, action items, follow-up drafts, briefs, speaker maps, embeddings
-- (transcripts); the audit numbers and named examples (audience_audits); description, location, referrer email, UTM
-- and referral token (calendar_events); content_md and notes (sales_scripts). match_transcripts(vector, double
-- precision, integer) is invoker-rights and executable by anon: through the open policy it returned transcript_text
-- and summary to the public key for any embedding passed in. With this batch it fails for anon with "permission
-- denied" (it needs transcript_text, summary, topics and embedding). No one calls it without a service key (0 in 7
-- days). _resolve_transcripts() and refresh_last_activity() (also invoker-rights) read only id, title, date and
-- participants from transcripts, columns anon keeps: nothing changes for them here.
-- What stays readable with the public key (all rows): transcripts id, title, date, duration_minutes, participants,
-- meeting_type; audience_audits prospect_name, onepager_url, audited_at; calendar_events id, title, start_time,
-- end_time, attendees, meeting_type, platform, meeting_url, is_all_day; sales_scripts id, name, meeting_type, version,
-- is_active, phases.
--
-- Listener's real requests, from 7 days of API gateway logs (2026-11-08 to 2026-11-15, user agent "Ivan Listener",
-- 71,117 reads, every one with one of these five shapes):
--   calendar_events?select=id,title,start_time,end_time,attendees,meeting_type,platform,meeting_url,is_all_day
--     &start_time=gte.<ts>&order=start_time.asc&limit=6   (and the same with limit=8)
--   audience_audits?select=prospect_name,onepager_url&onepager_url=not.is.null&order=audited_at.desc&limit=50
--   transcripts?select=id,title,date,duration_minutes,participants,meeting_type&order=date.desc&limit=6
--   sales_scripts?meeting_type=eq.<type>&is_active=eq.true&select=id,name,meeting_type,version,is_active,phases&limit=1
-- Every column in a select list, filter or order is granted below (audited_at is only an order column).
-- Other callers: n8n, edge functions, the Railway runner and local scripts use service keys; the inbox app and the
-- dashboard read calendar_events and transcripts as the signed-in user (policy authenticated_all, table grant kept).
-- One known change: the inbox app sent 4 calendar_events reads in 7 days with the public key as bearer (iPhone, a
-- signed-out or refreshing session) asking for is_test, source, referral_token and booking_source_path. Those now get
-- "permission denied" until the session is back, like every other read of the app in that state since 20261115l.
-- Rollback: 20261115q_narrow_listener_tables_for_anon_rollback.sql

SET LOCAL lock_timeout = '5s';

REVOKE ALL ON TABLE public.transcripts FROM anon;
GRANT SELECT (id, title, date, duration_minutes, participants, meeting_type) ON TABLE public.transcripts TO anon;

REVOKE ALL ON TABLE public.audience_audits FROM anon;
GRANT SELECT (prospect_name, onepager_url, audited_at) ON TABLE public.audience_audits TO anon;

REVOKE ALL ON TABLE public.calendar_events FROM anon;
GRANT SELECT (id, title, start_time, end_time, attendees, meeting_type, platform, meeting_url, is_all_day)
  ON TABLE public.calendar_events TO anon;

REVOKE ALL ON TABLE public.sales_scripts FROM anon;
GRANT SELECT (id, name, meeting_type, version, is_active, phases) ON TABLE public.sales_scripts TO anon;

COMMIT;
