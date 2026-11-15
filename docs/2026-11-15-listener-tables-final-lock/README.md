# Ivan Listener tables: the last step of the public-key lock

Prepared 2026-11-15. **Applied the same day:** the patch is in ivan-listener (branch
`security/listener-service-key-2026-11-15`, commit 489572c, deployed 21:59 UTC) and the final lock went live at
22:21 UTC as `db/20261115t_lock_listener_tables_final.sql` (same statements). The rest of this page is the plan as it
was written; the "where things stand" table describes the state before the lock.

## Where things stand

After `db/20261115q` the public (anon) key still reads these columns, on every row:

| Table | Columns the public key can still read |
| --- | --- |
| `calendar_events` | id, title, start_time, end_time, attendees, meeting_type, platform, meeting_url, is_all_day |
| `transcripts` | id, title, date, duration_minutes, participants, meeting_type |
| `audience_audits` | prospect_name, onepager_url, audited_at |
| `sales_scripts` | id, name, meeting_type, version, is_active, phases |

Transcript text, summaries, call reports and everything else are closed already.

The reason these stay: the Ivan Listener menu-bar app (`~/Desktop/ivan-listener/menubar`) reads them with the public
key, written as a literal in `CalendarFetcher.swift` and `SalesScript.swift`. It has no signed-in session. About
71,000 reads a week. Whatever that key can read, anyone holding the key can read. Closing the rest needs a new
Listener build.

## What the new build changes

`listener_patch.py` changes three lines in `menubar/Sources`:

- `SupabaseClient.swift`: the key constant the app already uses for `listener_state` loses `private`.
- `CalendarFetcher.swift` and `SalesScript.swift`: the public-key literal becomes a reference to that constant.

No new key goes into the app. The patched sources type-check (`swiftc -typecheck`, all 42 files, 0 errors, run on a
copy on 2026-11-15). The Listener repo itself was not touched.

## Steps

1. Pick a moment with no call running: the deploy restarts the menu-bar app.
2. In `~/Desktop/ivan-listener`: `python3 <this folder>/listener_patch.py --check`, then the same without `--check`.
3. `bash menubar/deploy.sh` (the only deploy path for this app).
4. Open the Listener panel. The Today view must list the upcoming calls and the recent transcripts, and a call card
   with an audit must show its one-pager link.
5. Check the API gateway logs for user agent `Ivan Listener`: the reads of the four tables must now carry the service
   key, with status 200, and no read with the public key after the deploy time.
6. Apply `final_lock.sql` through the Supabase Management API. Rollback: `final_lock_rollback.sql`.
7. Move both SQL files into `db/` under the next free migration name, and in
   `db/20261115s_public_key_surface_check.sql` take the four Listener policies out of the allowed list and set the
   expected policy count to 5. Run that check: every row must be ok.

If step 4 or 5 fails, the old binary is in `~/Library/Application Support/IvanListener/bak/`; the tables are still in
the `20261115q` state, so the old build keeps working.
