# REPORT - agentops-inbox-content-hub-2026-07-31

Run complete. End-state per LOCK 2: a staged ballot. Nothing armed, nothing published, dashboard untouched.

## What shipped (live now)
- Shared data layer in ivan-inbox: `src/lib/{content,styles,agent}.ts` + hooks + 159 green tests. All reads authed PostgREST; writes limited to chat send (RPC only), alert/reminder acks (two hard-coded fields), and Ivan-lane approve/skip status writes. No publish or schedule affordance anywhere (D6).
- Two finalist shells deployed INERT behind a load-time hash: `#exp/a` (Content tab) and `#exp/b` (Studio hub). Default app verified untouched: original 6 tabs, logged-out shows only the login screen, every served asset md5-matches the local build.
- Candidate C built, judged, eliminated; its two best ideas grafted into A.
- `BALLOT.html` in this folder: live links, real crops, judge scores, one-line apply step per finalist.

## The pick (yours, under 2 minutes)
Open on your phone: `…/#exp/a` and `…/#exp/b` (links in BALLOT.html). A = fastest daily loop, cleanest craft. B = broadest coverage and room to grow. Judges: A 23, B 19. Apply = one line in App.tsx (exact line in the ballot); I arm nothing.

## Verified-by-run (instruments, full population)
- Access matrix probed live for every table/RPC; RLS closure gives authed full read on all needed tables; zero migrations needed.
- 17/17 live styles render on the deployed gallery (exact-title match probe); previews joined family-aware via taxonomy; image styles carry real render supply (Concept Visual x50 etc).
- Resources: 44 published LM URLs probed, 40 resolve. 4 dead: `r1a/r1b/r2-smoke-*` (test rows) + `inboundonsteroids.com/scan/grade` (retired path). DB hygiene, your call: archive those rows or fix the URL.
- Rise lane raw authed read works (rendered Rise queue verified live) - the RPC fallback was not needed.
- Logged-out probe: zero rows, zero client data.
- Grep gates: no `n8nclaw-whatsapp` literal anywhere in inbox src (the dashboard's spoofed-WhatsApp fallback is NOT ported); `dashboard_action` wrapper physically limited to the two ack fields.
- PARITY-LEDGER.md: 53/53 capability rows mapped - 17 ported, 3 unchanged-elsewhere, 33 deferred with named reasons (Agent-Ready pipeline retired, LM mutations blocked by unverifiable watcher, client-board actions stay gated on the board, publish/schedule excluded by design).
- Build, tests, typecheck green; deploy bundle hash matches served bytes.

## Watch-first (only a human or a live cycle can catch these)
1. First day living in a candidate on your phone: note anything that still forces you back to the dashboard - that list scopes the dashboard-retirement follow-up.
2. Installed-PWA update on YOUR device: confirm the new bundle arrives after one close-reopen (Workbox autoUpdate should handle it).
3. First real Approve tap on an Ivan draft: confirm it lands as status change only, nothing schedules or publishes.
4. Push notification deep links still land on the right tab while an `#exp/` flag is active.
5. The four dead resource links above, if you open Resources before cleaning them.

## Deviations and notes
- Fork locks were set by the authoring session (non-interactive); Ivan saw them before launch.
- Data layer was built before the tournament (fork-independent; all candidates consume it).
- Session-limit halt mid-Phase-2: fix specs were persisted to disk and executed by fresh agents after reset. Judges 2/3 read three pre-fix crops; their verdicts were re-verified against current code before use.
- Concurrent commits absorbed: `10234d8` + `db85dc0` (ops comment drafter) landed on main mid-run from another session; merged tree passes all tests.
- Known-minor, in the losing-lens finalist: cand-b resource rows have one format-badge wrap bug; cand-a summaries omit topic chips that cand-b renders. Both are post-pick polish items, listed so the winner's cleanup covers them.
- Dead code shipped intentionally in the shared layer: `fetchChatBefore` (chat pagination) and `fetchScheduledQueue` (publish-queue read) are typed, tested, and unwired - ready for the winner's follow-up without re-auditing.

## Follow-ups (not this run)
1. Apply the ballot winner (one line), fold its dir into `screens/`, extend `route.ts` Tab enum, delete the losing candidate + exp gate.
2. Dashboard-side retirement of the `agent` section AFTER adoption (LOCK 3): remove nav entry, keep deeplink remap per the dashboard's nothing-disappears rule.
3. Archive the 3 smoke LM rows; fix or archive the scan-grade URL.
4. Optional: wire chat pagination + scheduled-queue view in the winner; add calendar as the next surface (B absorbs it as a section; A needs a segment).
