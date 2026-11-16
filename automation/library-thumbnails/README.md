# Stored library previews

The library reads normal public WebP objects at
`_library-thumbnails/w480-h600-q75/<original-path>.webp` in the original bucket.
The generator applies EXIF orientation, fits within 480 x 600, and encodes at
quality 75. Photo selection still pins the original URL.

Install the Pillow dependency in the native Mac runtime. The generator uses the
approved local Supabase binding through `~/.claude/lib/supabase-storage-egress-watch.py`.
The scheduled runtime copy lives in Content System `tools/library-thumbnails/generate.py`.
Compare its hash to this source when installing a new version.

```sh
python3 -m pip install -r automation/library-thumbnails/requirements.txt
python3 automation/library-thumbnails/test_generate.py
python3 automation/library-thumbnails/generate.py --client-id ivan
python3 automation/library-thumbnails/generate.py --client-id ivan --apply
```

The default command reads pending object metadata only. Applying writes derived
objects in public `post-stills` and `client-photos` buckets. A source version and
ETag in preview metadata make repeated runs skip existing previews. A daily
04:20 launchd job builds new or changed previews while the Mac is available.
The existing picker fallback handles a photo whose preview has not been built.

The initial November 16 backfill planned 714 objects and 417 MB of original
downloads. Bad image versions are recorded locally and skipped until the source changes.
Authentication, service and network failures stop the batch. It accepts at most 1,000 objects and
warns above a rolling 512 MiB source threshold without pausing work. Large
backlogs keep processing up to the normal per-run batch size. Individual originals are capped
at 16 MB and decoded image dimensions are checked.

Supabase log queries consume Log Query scan allowance. The old 15-minute
Storage-download log poller is disabled; its default invocation makes no
network requests. The separate hourly database-host counter remains active.
Storage-download auto-alerting requires a future monitoring source with a
bounded cost. Keep the spend cap enabled unless the account owner changes it.

The credential owner is Ivan; the two public buckets include all library tenants.
Scratch and one-post path segments are excluded. Preview cleanup after original
deletion is a separate maintenance task.

## Recurrence protections (November 16)

Ivan's availability preference: usage thresholds alert without disabling
application features or pausing preview generation. Source downloads are
accounted against a 512 MiB rolling 24-hour warning threshold, including failed
attempts and restarted runs. Crossing it sets `budget_warning` and continues.
An unreadable ledger sets `budget_unverified`, preserves the original file and
continues. The earlier backfill remains in that ledger. The preview input read
is bounded by its source size (or 16 MiB when the size is unknown).

Every uploaded batch gets a keyed metadata read-back. Missing or mismatched
source metadata sets `freshness_warning` and continues through later batches
and future runs. There is no latched usage stop. Old `blocked` state migrates to
`previous_block_reason` without resetting usage reservations. `last-run.json`
records completion, processing errors and warning flags. Invalid images and
real service failures retain their normal handling. Missing previews fall back
to original images; selection and publishing continue to use originals.

`guard.py --client-id ivan --notify` runs hourly via
`com.ivan.supabase-quota-guard`. Healthy checks use local files and launchd only,
without credentials or API calls. It checks the last completed preview run,
launchd exit status, usage/freshness/accounting warnings, disabled log polling and
installed file hashes. Problems notify Ivan's existing inbox route; identical
problems are limited to one successful notification per 24 hours. Diagnostics
without `--notify` do not send. No real alert is sent as a deployment test.
The installer first runs the new generator and requires a successful timestamped
completion before enabling the guard. A calendar job that has not run since a
reboot relies on the persisted freshness heartbeat instead of raising a failure.

The guard is a check of these protections, not a billing counter or a Storage
traffic meter. It runs while the Mac is available. The existing remote hourly
database-host meter remains active. Exact organization billing usage is still
unavailable through the approved PAT; public Storage traffic remains outside
that host meter. Supabase's separate spend cap was not changed. It can restrict
provider services at quota; allowing overages requires the account owner's
explicit billing decision.

Deployment parses application source with TypeScript to reject paid render
constructors, including multiline SDK options and concatenated route literals.
Original object URLs and the legacy URL normalizer remain allowed. Run:

```sh
node --test tools/check-storage-costs.test.mjs
node tools/check-storage-costs.mjs
python3 -B automation/library-thumbnails/test_generate.py
python3 -B automation/library-thumbnails/test_guard.py
```
