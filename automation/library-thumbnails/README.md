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
