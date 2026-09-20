# Weekly topic shortlist writer

`writer.js` is the exact deployable n8n Code-node body, derived from the pulled Run 06 writer. It preserves the credential resolver, Railway endpoint/model, per-call timeout, run budget, measurement restrictions and conservative copy checks. The verified Railway transport folds the rubric into the user message before `WEEKLY EVIDENCE (untrusted data):` and omits the proxy-hostile system field, following tools/client-research/proxy.mjs. The parent deployment must inject it into the freshly pulled canonical workflow and update the existing `audn-recommendation-writer` prompt with `prompt.md`; this directory does not deploy anything.

Run behavior tests with `node --test automation/weekly-topics/writer.test.mjs` from the workspace root. They execute the complete Code body with a fixed clock and fake external HTTP boundaries, preserving all writer orchestration and validation.

A manual input is `{ "preview": true, "client_id": "ivan", "week_start": "2026-09-21" }`. Only literal boolean true enables preview. Omit client_id for all active enabled registry clients. Default week is UTC current Monday on weekdays and upcoming Monday on weekends; only current or next Monday is accepted. A committed week returns `already_committed` without a model call, including previews. Preview results are `summary.clients[].rows` and `.coverage`, with cited evidence and limitations retained in each row. Preview performs context reads and one model call per uncommitted client, with no commit or source mutations.

Live mode calls only the existing `audn_recommendation_commit` RPC with its existing signature. The weekly SQL branch must be deployed first. Same-week cap includes every saved status; old backlog does not consume a new week. Recent recommendations across all statuses are supplied for dedup: 90 days, at most 120 rows, with explicit history coverage/truncation; the latest 120 recommendation-derived ideas supplement that history. Rejections saved in `context.weekly_decision` are merged into previous decisions and results.

Evidence uses typed IDs (`competitor:…`, `own_post:…`, `founder:…`, `buyer_question:…`, `news:…`, `trend:…`), exact nullable source dates, locations, retained excerpts and limitations. Only competitor citations need roster roles. Competitor posts remain tenant/roster restricted and retain actual post_type plus matching gate/offer/CTA metadata. Canonical URL/source groups remove duplicate public evidence and prevent reusing the same news/trend story under a new label. Public discovery is allowlisted to stored breaking_news, novelty, hacker_news, reddit_se, x_search and youtube_watch evidence with both a retained excerpt/quote and public URL. All private/mixed call/session sources are excluded. Client idea evidence requires an exact tenant and explicit public origin in meta; missing provenance stays unavailable. No harvest is triggered.

Research insights and themes use the latest run separately per table/client; capture timestamps are not event dates and older captures are historical. Approved founder sources are consent checked; permission-only source IDs are excluded. Null dates remain null, including RISE's currently approved excerpt. Existing measurements and feedback remain the only basis for performance statements. No future performance is proven by a shortlist.

History bounding follow-up: every status remains eligible for dedup/feedback, within 90 days and at most 120 recommendations. Coverage reports included count, minimum omitted count when capped and older-history exclusion. Recent idea history is also bounded to 120 rows. Ranking is qualitative editorial prioritization among up to the registry cap, not a validated scoring formula or a separately scored broad candidate pool.

Input sizing: complete client voice/buyer/veto prompts remain intact. Own material uses up to30 posts (18 recent, supported matched-age standing extremes, then recent fill), with measurement rows scoped to those posts and whole-account coverage counts retained. Competitor excerpts use roster round-robin selection up to80 posts/72,000 characters; raw45-day rows still determine baselines. Public discovery uses up to24 distinct evidence items balanced across eligible feed types, from at most100 existing leads. Research uses at most12 rows from each latest run. Duplicate excerpts are not sent under multiple top-level pack keys. The full512,000-character guard remains fail-closed. Selection/omission counts and input field sizes appear in coverage and saved source_coverage. Valid model[] commits an empty immutable weekly cycle; invalid/refused model output remains retryable.

Final model view: source collection and the local full evidence lookup stay intact, but the model receives up to12 roster competitors,6 own posts (recent plus supported measured extremes),6 recent public sources, and every approved founder/buyer excerpt. Non-founder model excerpts are1000 characters; saved source rows retain their fuller source excerpt and provenance. Repeated limitation text is deduplicated into a code dictionary. Measurement preserves definitions/floors and monthly cohort aggregates while selecting one latest target-age observation per selected-own post/metric; raw coverage records become explicit per-post status counts. Feedback retains up to12 decision/result records and40 brief dedup entries, with omissions stated. Research is summarized to3 rows per latest run. Full versioned client prompt bodies are preserved with a manifest, and the weekly task explicitly forbids executing embedded QA/rewrite/scoring/web-search procedures. The final ceiling is200,000 characters including the weekly rubric and serialization headroom. Source IDs excluded from the model view cannot pass citation validation. The private recorded live trace is optional test input and is not committed or copied into fixtures.

Editorial package quality: hooks must express a buyer-relevant topic and point, not just a CTA. Unsupplied personal practices/absence claims cannot be borrowed from competitor evidence, and a selected sample cannot establish an author never used a tactic. Publication dates do not date embedded news events. The prompt requires exact timing, attribution, finished prose without self-corrections and170–210-word targets; the writer enforces a250-word total prose ceiling per choice. Semantic provenance and topic usefulness remain review requirements rather than broad keyword bans.

## Evidence path (preview-only until Phase 3's rollout cutover)

`writer.js` carries a generated region between `// <selector-pack:begin sha256=...>` and
`// <selector-pack:end>` markers, copied verbatim from `automation/content-evidence/selector-pack.mjs`
by `automation/weekly-topics/sync-selector.mjs` (a Code node cannot `import`). Run
`node automation/weekly-topics/sync-selector.mjs` after any change to `selector-pack.mjs`, and
`node automation/weekly-topics/sync-selector.mjs --check` to verify the region is not stale
(exit 1 if it is). `writer.test.mjs` asserts the sha256 in the marker matches the live module on
every run, so a forgotten sync fails the suite instead of silently drifting.

The evidence path runs for a client only when (a) the request is a preview carrying literal
`evidence: true`, or (b) the client is named in the rollout switch: one row in the existing
`public.integration_config` table, key `weekly_evidence_selector_clients`, value a JSON array of
client ids. Row absent, unreadable, or a non-array value all mean `[]` -- every client stays on
the legacy path. A read error on that row fails closed to `[]` for the run and is recorded on
`summary.evidence_rollout.read_error`; it never enables anything. When the evidence path is
active for a client, the writer calls `content_evidence_pack(p_client_id, p_week_start)`
(service role, db/103), builds candidates with `buildEvidencePack`, and offers them to the model
as `evidence_candidates` (see prompt.md). A model choice may cite at most one candidate by its
exact `draft_key`, via the new `evidence_candidate_key` field; every number that ends up on a
committed row's `context.evidence_package` is copied from the server-built candidate, never from
anything the model echoes, so a model cannot introduce a number the pack did not produce.
`commitGuard` (also generated from `selector-pack.mjs`) refuses any commit that would carry
`evidence_package` unless the rollout switch names the client and the run is not a preview --
this is checked immediately before the existing `audn_recommendation_commit` call, as defense in
depth on top of the structural preview/rollout gate above it.

With the rollout switch empty, the run is NOT byte-identical to the pre-evidence writer: it makes
one extra read (`GET /integration_config`, wrapped and fail-closed), and the returned summary
carries a new `evidence_rollout` key plus `evidence_path: false` on each client record. What IS
unchanged: every model pack sent to the proxy (`evidence_candidates` is spread onto the pack only
when non-empty) and every committed row's shape and content -- every existing writer test still
passes unmodified, and a `context.evidence_package` key never appears on any row.

Offline preview (no DB, no model call): `automation/content-evidence/preview-selector.mjs`
builds the same `buildEvidencePack` output from a frozen study JSON file plus
`WINNER-DIGEST.json`, for one client at a time. Client facts, own-result history and
previous-test history are unavailable offline, so every offline candidate is expected to show
`needs_material` -- that is the correct offline answer, not a defect.

## Deployed integration

The companion database migration is `db/20260919_weekly_topic_shortlists.sql`. This source snapshot is the deployed five-node Audience Review writer (`UGKZGBBM9332apHo`), prompt v5. Monday scheduling and the existing human approval path remain active. The manual webhook requires a dedicated header credential stored only in n8n and the operator’s private credential directory; no credential is included here.

Generated recommendations require editorial review: the live release preview demonstrated unsupported source paraphrases and overstated freshness that structural validation alone cannot catch. First-week recommendations were reviewed against retained full excerpts before saving, with corrections recorded in their context. Excessively long or otherwise invalid model output stays retryable rather than marking an empty week complete.
