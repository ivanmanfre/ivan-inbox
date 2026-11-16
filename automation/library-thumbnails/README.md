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
refuses an estimated source total above 512 MB. Individual originals are capped
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

Source downloads share a persistent 512 MiB rolling 24-hour budget, including
failed attempts and restarted runs. Reservations are saved before each batch's
GETs. A corrupt budget refuses downloads. The November 16 install seeds this
ledger with the initial backfill. The preview input read is bounded by its
reserved source size (or 16 MiB when the size is unknown).

Every uploaded batch gets a keyed metadata read-back. Missing or mismatched
source metadata opens a persistent circuit in `budget.json` and stops further
source downloads. An operator must repair and verify the metadata handling
before clearing that circuit. Do not delete the budget to retry an unhealthy
batch. `last-run.json` records completion, errors, budget stops and circuit state.

`guard.py --client-id ivan --notify` runs hourly via
`com.ivan.supabase-quota-guard`. Healthy checks use local files and launchd only,
without credentials or API calls. It checks the last completed preview run,
launchd exit status, open circuits, budget stops, disabled log polling and
installed file hashes. Problems notify Ivan's existing inbox route; identical
problems are limited to one successful notification per 24 hours. Diagnostics
without `--notify` do not send. No real alert is sent as a deployment test.

The guard is a check of these protections, not a billing counter or a Storage
traffic meter. It runs while the Mac is available. The existing remote hourly
database-host meter remains active. Exact organization billing usage is still
unavailable through the approved PAT; public Storage traffic remains outside
that host meter. Keep the spend cap enabled.

Deployment parses application source with TypeScript to reject paid render
constructors, including multiline SDK options and concatenated route literals.
Original object URLs and the legacy URL normalizer remain allowed. Run:

```sh
node --test tools/check-storage-costs.test.mjs
node tools/check-storage-costs.mjs
python3 -B automation/library-thumbnails/test_generate.py
python3 -B automation/library-thumbnails/test_guard.py
```
