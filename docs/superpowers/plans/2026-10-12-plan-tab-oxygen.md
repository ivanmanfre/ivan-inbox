# Content > Plan tab (Oxygen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Content > Plan in the Oxygen design with the content brain data (why chain, brain guess, check story, brain strip charts) in plain words, and add the new-plan alert plus the small fixes outside Plan.

**Architecture:** Phase 1 enriches the existing read `content_plan_week(account)` server-side (db/259+, additive, rollback per file) and starts recording data that is stored nowhere today. Phase 2 replaces the Plan tab UI behind a new skin section `content.plan` (on by default once verified; Off keeps today's `Plan.tsx`). All label-to-plain-words mapping for the UI lives in one pure, unit-tested module `src/d/content/plan/planBrain.ts`; SQL-side plain words (alert, Monday card, warnings) come from the same R4 table and the new `brain_rule_plain` table. Phase 3 adds the `plan_ready` alert through the single notify path, plain Monday-card / brain-line wording, and the client-panel clean-ups.

**Tech Stack:** Postgres (Supabase bjbvqvzbzczjbatgmccb, plpgsql, pg_cron, pg_net), React 19 + TypeScript + Vite, vitest (+ @testing-library/react, jsdom), Deno edge functions (`supabase functions deploy`), n8n via n8nac, Playwright for live checks.

**Spec:** `docs/superpowers/specs/2026-10-12-plan-tab-oxygen-design.md` (precedence R4 > R3 > R2 > base). Visual + wording reference: `~/.local/state/offfix/mock2/plan-oxygen-v3.html` and its logic `~/.local/state/offfix/mock2/v3-body.html`. Chart prototypes: `~/.local/state/offfix/final-review/viz/` (`src/build.py`, `0N-*.html`, `0N-*.png`). Audit SQL and outputs: `~/.local/state/offfix/brain-audit/` (`def_*.sql` are live function bodies, `q*.txt` data), enrichment queries `~/.local/state/offfix/enrich.sql`, `enrich2.sql`.

## Global Constraints

- Repo worktree: `/Users/ivanmanfredi/.local/state/offfix/inbox-wt`, branch `plan-oxygen-2026-10-12`. Never touch `~/Desktop/ivan-inbox` (other sessions' uncommitted work). Never `git add -f goal-runs`. Never force-push. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Deploy is done by the controller only: `git pull --rebase origin main` then `git push origin HEAD:main` (GitHub Pages builds). Implementers commit, never push.
- SQL runs only through `python3 ~/.local/state/offfix/q.py 2000 < file.sql` (Management API, prints rows). Keep every SQL file under `~/.local/state/offfix/build/sql/` or `db/`; never under `/tmp` (wiped). A hook blocks DELETE/DROP/ALTER typed in bash command text: put DDL in files passed on stdin.
- Every migration is additive, numbered next free `db/NNN_name.sql` (next free is 259) with `db/NNN_name_rollback.sql` written before apply. Rollback for a replaced function = the exact live body captured before the change (`pg_get_functiondef`). Prove behaviour with rolled-back DO blocks that `RAISE EXCEPTION '%', result` (the raise is the receipt and the rollback).
- Never delete content-system data. Leave the `zz-selftest-*` brain rule in place; filter `rule_id like 'zz-%'` in every read.
- `content_plan_week` must stay under 300 ms per account (`explain (analyze, timing off) select public.content_plan_week('<acct>')`, Execution Time). Baseline measured 2026-10-12: ivan 61 ms, risedtc 57 ms, arch 47 ms. No regression > 150 ms. `agent_log` is summarized server-side and never shipped to the browser.
- Accounts: `ivan` (client_id IS NULL on carousel_drafts), `risedtc` (Rise, Mattan), `arch` (Arch, Davorin). Display names Ivan / Rise / Arch. Time zones: Rise `America/Los_Angeles` label `PT`; Ivan and Arch `Europe/Warsaw` label `Warsaw`.
- LLM calls: Railway proxy only, `https://claude-code-railway-production.up.railway.app/v1/messages`, key = `integration_config.railway_proxy_key`. Instructions go in the user turn. NEVER send a `system` field. Never api.anthropic.com. Read only `type==="text"` content blocks, never `content[0].text`. A refused or empty answer writes nothing.
- n8n: before any n8n work read the complete file `/Users/ivanmanfredi/Desktop/Ivan - Content System/docs/agent-runtime/n8n-workflow-protocol.md`. Use `~/.npm/_npx/cce0a226de71e5c3/node_modules/.bin/n8nac` from `/Users/ivanmanfredi/Desktop/Ivan - Content System` (workflowDir `workflows/n8n_ivanmanfredi_ivan_m/personal`). Pull before edit; copy the pulled file to a NEW file under `/Users/ivanmanfredi/Desktop/Ivan - Content System/research/plan-section-2026-10-11/` (no git there: never overwrite an existing file; check existence first); `push <path> --verify`; then `workflow deactivate <id>` + `workflow activate <id>` for schedule triggers. The Ivan writer `ULWz3DbYF0oSv2G8` is not edited in this plan (see Task 3 ruling).
- Notifications: single write path `supabase/functions/_shared/notify.ts` via the `inbox-notify` edge function. Family `content_plan`, kind `plan_ready` (in `media.kind`), dedupe `plan-ready:<account>:<week>`, push only for `plan_ready`, the 12 h same-alert rule (`rangRecently`, commit 42f75b23) must be in the deployed code. Never fire on "nothing to plan".
- Never send any message to a client (Mattan/RISE, Davorin/ARCH), never post anything. Client panels may only lose internal text / stale blocks and gain day + title of upcoming posts, with no scores.
- No secrets printed in logs, reports, commits or files in the repo. Read secrets from `integration_config` inside SQL or from the keychain inside scripts.
- Copy: plain words per spec R4 everywhere Ivan reads (UI, alert, Monday card, feed). Short sentences, one idea each, everyday words; numbers only with a plain comparison next to them; no model/study/pipeline terms (banned in UI copy: outlier, usual, primer, pillar, cadence, Review draft, niche winner, pattern, breakout, ICP, QA, holdout, recipe, cb33, slot). No em dashes (U+2014) in UI copy. Ivan is not a native English speaker.
- R4 wording table (verbatim targets): Good sign / Bad sign / Neutral (threshold 15 %, `|x-1| < .15` = Neutral, no scale); "go viral 1.5x more often in Rise's niche"; "go viral a bit less often" (x >= .6) / "about half as often" (x < .6); detail line "6.8% of these posts went viral, vs 4.5% of all posts. Based on 398 posts. Proven on recent posts."; reliability words "Proven on recent posts" / "Proven on recent posts, but few examples" / "Not proven yet"; "Brain guesses"; "Passed: 63/80 (needs 59). It was rewritten once."; "Low score: 57/80, even after a rewrite. Approved anyway."; flag "Low score"; "All 8 facts match the call." / "2 of 8 facts not found in the call."; "Written as a teardown. Opens with proof."; openers pattern_interrupt / claim / data_led / specific_receipt / story_opener / question = "Opens with a surprise" / "Opens with a bold claim" / "Opens with a number" / "Opens with proof" / "Starts in the middle of a story" / "Opens with a question"; check dims VOICE, SUBSTANCE, SPECIFICITY, OPINION, ECONOMY, HOOK, VERIFIED, AI_TELLS = Voice, Depth, Details, Opinion, Short, Hook, Facts, Sounds human; "Rules we follow" / "Testing, not used yet"; effects as the gain from following the rule ("No links in the post · 13% more views"); range crossing zero = "your rule, not clear in the data"; "A question gets more comments · 8% more comments"; "Last 90 days: 253 views on a normal post · viral = 3x that"; "27 views. A normal post gets 166."; "Out of ideas for sales posts (3 used in 8 weeks) · Add ideas"; "Out of ideas for posts that bring new followers"; "based on top posts"; "A written draft based on a post that got 4.5x its author's normal views"; real names, never URL slugs; "No day yet. It gets the first free weekday of its week when you approve it."; "A weekday: weekend posts get 19% fewer views for Rise creators (still testing)."; "How it is written" / "Will it do well"; "Failed twice. The planner is picking a new topic for this slot."
- "Will it do well" shows only the brain guess; the helps/hurts list is never shown. "Why this week" never repeats "Why this post".
- Oxygen: tokens from `src/ds/tokens.css` §10 only (no new tokens); ink is the accent, red only via `--ds-signal`; severity pairs for status (attention `#865d19` on `#fcf1e2`); Geist, mono for times; radii chip 5, button 7, card 10, pane 14 (phone 18); motion curves/durations from tokens, stagger 30 ms capped at 400 ms, `useMotionLevel()`; reduced motion = 0 ms; no infinite animation. Phone floors: no text under 12 px, every tap target at least 44 px. Desktop other tabs unchanged.
- React: never put a hook after an early return (this blanked the app once). Every hook in a component runs unconditionally, before any `return`.
- Baseline unit suite (2026-10-12, with `.env.local`): 12 failing files / 18 failing tests, listed in `~/.local/state/offfix/build/baseline-vitest.log`. "Tests pass" means no NEW failing test beyond that list. `npx tsc -b` must exit 0.

## Review Focus

- An account with nothing planned or no brain data at all (Arch has no live rules, Ivan's reads are all unproven, a week with zero posts): every section must render its empty words ("None proven yet", "No brain guess yet for this draft.", "Free" wells), never crash or show NaN/undefined. Test: `planBrain.test.ts` "empty account" cases + a `PlanV2.test.tsx` render with an all-empty read.
- A post on Saturday/Sunday: the weekend column must appear for that week only, with the "Weekend" flag when a weekday rule exists. Test: `planBrain.test.ts` `weekDays()` and `flagsFor()` weekend cases.
- Non-English call quotes (Arch, Croatian) and planner notes: never shown as quotes; show nothing (or the English cache). Test: `planBrain.test.ts` `quoteFor()` cases; SQL DO check that no Arch item ships a non-English `quote`.
- Switching seat while a read is loading, and the hover card while the panel opens: the stale account's data must never paint under the new seat, and the hover card must close when the panel opens. Test: `PlanV2.test.tsx` seat-switch race with deferred promises.
- The new-plan alert firing twice for the same account-week (planner re-run, sweep + apply both firing) or on a "nothing to plan" run. Test: rolled-back DO block calling the ready function twice and on a run with picked = 0; ledger shows one row.

---

## Phase 1: data and recording (ships alone, old UI unchanged)

### Task 1: db/259 brain data in `content_plan_week`

**Files:**
- Create: `db/259_content_plan_brain.sql`, `db/259_content_plan_brain_rollback.sql`
- Create (evidence, not in repo): `~/.local/state/offfix/build/sql/259_checks.sql`, `~/.local/state/offfix/build/phase1/259-timing.txt`, `~/.local/state/offfix/build/phase1/259-shape-<acct>.json`
- Modify: `src/lib/contentPlan.ts` (types only, optional fields; no UI change)
- Test: `src/lib/contentPlan.test.ts` (parse accepts the enriched read and still rejects partial reads)

**Model:** `opus`

**Interfaces:**
- Consumes: live `content_plan_week(p_account text, p_now timestamptz)` body (save with `pg_get_functiondef` as the rollback first; the 2026-10-12 copy is `~/.local/state/offfix/build/sql/live_content_plan_week.sql`), `content_plan_post_evidence(uuid)`, `cb33_early_reads`, `cb33_idea_read(p_client text, p_idea_id text)`, `brain_rules`, `brain_rule_tests`, `brain_rule_proposals`, `brain_retest_runs`, `rise_call_fact_checks`, `client_post_metrics`, `cb37_draft_post_links_v`, `cb37_post_results_v`, `ivan_post_outcome_spine`, `post_day7`, `client_post_engager_stats_v`, `content_plan_replans`, `x_calendar(p_from, p_to)`, `scheduled_posts`, `client_ideas`.
- Produces (JSON contract every later task relies on; field names exact):
  - New table `public.brain_rule_plain(rule_id text primary key, name text not null, follow_sign smallint not null check (follow_sign in (-1,1)), metric text not null default 'views' check (metric in ('views','comments')), enforcer text)`; seeded below. `follow_sign`: gain from following the rule = `effect_pct * follow_sign` (same for `ci_lo_pct`/`ci_hi_pct`, swapped when the sign is -1).
  - New columns on `client_ideas` (nullable, filled by Task 2): `quote_en text`, `quote_en_at timestamptz`, `quote_en_src text` (the exact source text that was translated).
  - New function `public.content_plan_brain_items(p_account text, p_drafts uuid[], p_now timestamptz default now()) returns table(draft_id uuid, brain jsonb)` STABLE SECURITY DEFINER, `search_path public, pg_temp`, revoked from public/anon, granted to authenticated + service_role.
  - New function `public.content_plan_brain_strip(p_account text, p_items jsonb, p_now timestamptz default now()) returns jsonb` (same security). `p_items` = the array of enriched items of the next two weeks (to build the reads chart without re-reading).
  - `content_plan_week` keeps every existing key and adds: per item in `weeks[].posts[]`, `weeks[].planned[]`, `supply[]` a key `brain` (object below, or for a planned slot with no draft: `{draft_id:null, read:<from cb33_idea_read or null>, quote, quote_pending, flags:{...all false}, ...nulls}`); `done[]` items gain `draft_id, impressions, reactions, comments`; top-level `done_median`, `tz:{name,label}`, `x_days:[ISO date]`, `brain_strip:{...}`. Warnings keep `{code,text}`; their `text` becomes R4 plain words; new codes `over_rule` and `weekend_post`.
  - `brain` object:
    ```json
    {"draft_id":"uuid|null","words":123,"edited":false,"thumb":"https://...|null","body_head":"first 260 chars|null","first_line":"text|null","has_link":false,
     "flags":{"lm":false,"boosted":false,"founder":false,"carousel":false,"weekend":false,"failed":false,"low_score":false,"fact_fail":false},
     "qa":{"outcome":"passed|recovered|low|failed|hand|null","first":60,"final":63,"max":80,"pass_line":59,"rewrites":1,"approved_anyway":false,"dims":{"VOICE":7,"SUBSTANCE":8},"weakest":"ECONOMY"},
     "facts":{"pass":true,"failed":0,"total":8},
     "angle":{"structure":"TEARDOWN","opener":"specific_receipt"},
     "trait":"named example proof, a reputation at risk",
     "read":{"dim":"proof_type","val":"named_example","rate":0.068,"base":0.045,"n":398,"lo":0.05,"hi":0.092,"proven":true,"small":false},
     "brief":{"author":"Monika Grycz","ratio":4.5,"url":"https://...","why":"text"},
     "quote":"English call quote|null","quote_pending":false,
     "photo":{"has":true,"reason":"text|null","rotation":false},
     "replaced":{"title":"Friends and family","on":"2026-10-12"},
     "result":{"views":27,"reactions":3,"comments":1,"viral":false,"young":false,"url":"https://linkedin...","engaged":{"brand":3,"total":12,"usual_pct":9}},
     "time_set_by":"hand|planner|null"}
    ```
  - `brain_strip` object:
    ```json
    {"rules":[{"rule_id":"R06-link-ivan","name":"No links in the post","metric":"views","gain":13.0,"lo":3.3,"hi":21.7,"status":"live","unclear":false,"held_latest":true,"your_rule":false,"enforcer":"writer","creators":69}],
     "next_check":{"date":"2026-11-02","watch":["Weekdays only","More than 50 words"],"proposals":[{"id":1,"rule_id":"R01-image-risedtc","name":"Add a picture","to_status":"live","reason":"text"}],"recent":[]},
     "reads":{"items":[{"title":"...","x":1.51,"lo":1.1,"hi":2.04,"proven":true,"small":false}],"total":15},
     "predictions":{"measured":17,"need":20,"validated":false},
     "views":{"median":166,"breakouts":2,"measured":30,"posts":[{"d":"2026-09-01","v":512,"young":false}]},
     "idea_stock":[{"topic":"teardown","stock":30,"used":7}],
     "collection":{"posts":10629,"creators":140},
     "note":"Tested, not used yet: fewer posts a week (24% more views) and a picture (54% more views). Rise posts 5 a week, mostly text."}
    ```

- [ ] **Step 1: Capture the rollback body and the baseline.** Write `~/.local/state/offfix/build/sql/def_now.sql` with `select pg_get_functiondef('public.content_plan_week(text,timestamptz)'::regprocedure);` and save its output as the body of `db/259_content_plan_brain_rollback.sql` (followed by the reverse of every other object this migration creates: `drop function if exists public.content_plan_brain_items(text,uuid[],timestamptz); drop function if exists public.content_plan_brain_strip(text,jsonb,timestamptz); drop table if exists public.brain_rule_plain;` and `alter table public.client_ideas drop column if exists quote_en, drop column if exists quote_en_at, drop column if exists quote_en_src;`). Record baseline timing for the three accounts in `~/.local/state/offfix/build/phase1/259-timing.txt`:

```bash
for a in ivan risedtc arch; do for k in 1 2 3; do echo "explain (analyze, timing off) select public.content_plan_week('$a');" | python3 ~/.local/state/offfix/q.py 200 | grep "Execution Time" | sed "s/^/before $a /"; done; done >> ~/.local/state/offfix/build/phase1/259-timing.txt
```

- [ ] **Step 2: Explore the data before writing SQL.** Read `~/.local/state/offfix/enrich.sql`, `enrich2.sql`, `regen.txt`, `rules.txt`, `brain-audit/q04_agent_log_steps.txt`, `q05_agent_log_samples.txt`, `q06_early_reads.txt`, `q12_brief_members_forecasts.txt`, `q14_account_level.txt`, `q15_monday_metrics_photo.txt`, `final-review/brain-window-2026-10-05-12-notes.md`, and `final-review/viz/src/build.py` (chart data shapes). Confirm with SELECTs (write each to `~/.local/state/offfix/build/sql/`):
  1. The QA story per draft from `agent_log` (array of `{agent, body, ts}`): first `QA Agent` JSON body score (total of 80, keys `total_80`/`score`, dims object keys VOICE…AI_TELLS), the count of regenerations, the last score, the "REGEN LOOP EXHAUSTED … (57/80)" give-up line (`agent='QA Give-Up'` or body like `VERDICT: QA_BLOCKED%`), and the pass line the lane used (look for a floor/threshold number in the regen log lines, e.g. "needs 59" / `floor`). Map to `qa.outcome`: `passed` (first check passed), `recovered` (failed then passed after rewrite), `low` (exhausted or final score under the pass line and the draft still went to review/scheduled/published), `failed` (draft status `error`), `hand` (verdict EDITORIAL / reviewed by hand, no score), `null` (nothing recorded). `approved_anyway` = outcome `low` and status in (`approved`,`scheduled`,`published`).
  2. Whether `qa->'claim_check'` is the QA agent's own claim check or a copy of `cb45_claim_checks`. Spec R3.3: cb45 is never shown. If it is cb45 data, `facts` comes only from `rise_call_fact_checks` (Rise, latest row per draft: `pass`, `failures` count) and is `null` elsewhere. Write the finding in the report.
  3. Author real names for `taxonomy->'brain_brief'->>'source_author'` slugs (e.g. `grycz-monika`, `aidan-collins-8a146530a`): find the creator table that maps a slug/handle to a display name (search `information_schema.columns` for tables with `author`/`creator` + `name`). `brief.author` must be the real name or `null`, never the slug.
  4. The niche trait text: the evidence item `type='brain_rule'` label "Shares traits with top niche posts: …" from `content_plan_post_evidence`; store the part after the colon as `trait` (raw, the UI rewrites words).
  5. Applied rule changes with an undo token (db/256 objects: `brain_rule_apply`, `brain_rule_rollback`, `brain_rule_undo(p_token uuid)`): find the event table holding tokens; `next_check.recent` lists changes from the last 14 days with `undo_token`, else `[]`.
  6. The next brain check date: the brain re-test loop runs monthly by pg_cron on days 1-7 (first run 2026-11-02, a Monday). Read the cron schedule from `cron.job` (jobname like `%brain%retest%`) and compute the next run date; fall back to the first Monday of next month.
  7. Who moved a post / set a time: if no source exists yet, `time_set_by` stays `null` until Task 3's log exists (Task 3 adds it; read it with `to_regclass('public.content_plan_moves')` guard so this task does not depend on Task 3).
  8. Idea stock per topic (clients only): `client_ideas` status `staged` and eligible, grouped by `pillar`, vs published drafts per pillar in 56 days. Topic words are mapped in the UI.
  9. Collection size: count posts and distinct creators in the niche post table the brain studies (the guide says 10,629 posts from 140 creators; find the table and count live).
  10. Prediction progress: `post_day7` measured own posts per client (`kind` own) vs 20; `validated` from the latest `editorial_forecasts` row status reason (`no_validated_evaluation` = false).
  11. Arch audience gap (spec R3.5: "No posts for teams not yet using creators."): find the field that tags an Arch idea/draft with its audience stage (client_ideas `funnel_stage`/`taxonomy`/`idea` keys). If found, add warning code `audience_gap` with that exact text when no Arch post or planned slot in the next two weeks targets that audience. If no such field exists, skip it and say so in the report.

- [ ] **Step 3: Write `db/259_content_plan_brain.sql`.** Structure (complete the bodies from Step 2's findings; keep each per-draft computation inside ONE set-based query over `unnest(p_drafts)` with lateral joins, never a per-draft function call in a loop):

```sql
-- 259: content_plan_week carries the content brain data for the Plan tab (spec 2026-10-12 R2-R4).
-- Additive: one table, three nullable columns, two new functions, content_plan_week replaced (rollback = 259_..._rollback.sql).
create table if not exists public.brain_rule_plain(
  rule_id text primary key, name text not null,
  follow_sign smallint not null check (follow_sign in (-1,1)),
  metric text not null default 'views' check (metric in ('views','comments')),
  enforcer text);
insert into public.brain_rule_plain(rule_id,name,follow_sign,metric,enforcer) values
 ('R06-link-ivan','No links in the post',-1,'views','writer'),
 ('R08-frequency-ivan','2 to 4 posts a week',-1,'views','scheduler'),
 ('R11-weekend-ivan','Weekdays only',-1,'views','scheduler'),
 ('R04-short50-ivan','More than 50 words',1,'views','writer'),
 ('H01-author-voice-ivan','Open with something you did or saw',1,'views','writer'),
 ('R16-image-fitting-photo-ivan','A photo only if it fits',1,'views','photo picker'),
 ('R10-hashtag-risedtc','No hashtags',-1,'views','writer'),
 ('R07-question-comments','A question gets more comments',1,'comments','writer'),
 ('R01-image-ivan','Add a picture',1,'views','photo picker'),
 ('R01-image-risedtc','Add a picture',1,'views','photo picker'),
 ('R01-image-arch','Add a picture',1,'views','photo picker'),
 ('R02-doc-ivan','Carousels',1,'views','writer'),
 ('R02-doc-arch','Carousels',1,'views','writer'),
 ('R08-frequency-risedtc','Fewer posts a week',-1,'views','scheduler'),
 ('R08-frequency-arch','Fewer posts a week',-1,'views','scheduler'),
 ('R11-weekend-risedtc','No weekend posts',-1,'views','scheduler'),
 ('H02-story-ivan','Tell a story',1,'views','writer'),
 ('H01-author-voice-arch','Open with something you did or saw',1,'views','writer')
on conflict (rule_id) do nothing;
-- Rules not in the table: name = first clause of brain_rules.statement (split on . ; ( ), follow_sign = coalesce(claimed_sign,1).
alter table public.client_ideas add column if not exists quote_en text, add column if not exists quote_en_at timestamptz, add column if not exists quote_en_src text;
-- content_plan_brain_items(...) returns table(draft_id uuid, brain jsonb): one pass over unnest(p_drafts) with laterals
--   d (carousel_drafts), qa story (one lateral over jsonb_array_elements(agent_log) aggregating first/last/ count/give-up/pass line),
--   r (latest cb33_early_reads.rendered_read), f (latest rise_call_fact_checks), ci (client_ideas via d.client_idea_id),
--   ev trait (content_plan_post_evidence brain_rule label), brief name, metrics (cb37_post_results_v / client_post_metrics latest capture),
--   engaged (client_post_engager_stats_v, Rise only), replans (content_plan_replans + slot status_note), photo reason (taxonomy photo_reason / no_photo_reason; Rise = rotation).
-- content_plan_brain_strip(p_account, p_items, p_now) returns jsonb: rules (+ latest brain_rule_tests verdict per rule => held_latest),
--   next_check, reads (from p_items' brain.read of the next two weeks), predictions, views (90-day median + 12-week posts, breakout = views >= 3 x median,
--   young = published < 7 days ago, is_winner NOT used), idea_stock, collection, note.
-- content_plan_week: the 258 body unchanged up to the final return; then
--   collect every draft_id from weeks[].posts, weeks[].planned (draft_id), supply, done; call content_plan_brain_items ONCE;
--   merge brain into each item with jsonb_set over the arrays; planned slots with no draft get the idea read via cb33_idea_read(p_account, idea_ref)
--   (client_ideas only) and the idea quote; rewrite warnings text to R4 words; add over_rule (weekly posts above the live R08 range for Ivan:
--   'Week of 12 Oct has 5 posts. Your rule is 2 to 4. Each extra post costs 9% of views.') and weekend_post warnings
--   ('Sat 17 Oct: a post on a weekend. Your rule is weekdays only.'); add done_median, tz, x_days (x_calendar over the 3 weeks), brain_strip.
```

Quote rule (spec R2.5, R4): `brain.quote` = `ci.quote_en` when `ci.quote_en_src` equals the current source quote; else the source quote itself only when it is English (`quote_en_src` equal and `quote_en` equal to it means "already English"); else `null` with `quote_pending = true`. The source quote = the call evidence quote (`content_plan_idea_evidence` call `quote`, `ci.idea->>'verbatim_quote'`, `ci.idea->>'anchor_quote'`, `ci.meta->'source_detail'->>'quote'`), never `score_breakdown->>'why'` text that starts with `Extracts|Fits|Adds` (planner/scorer notes) and never the planner's `why_now`. Before Task 2 has run, every quote without a cached English check is `quote_pending`; Ivan's ideas (lm_idea_candidates) carry English text and may show their quote directly.

Warnings R4 text (exact):
- empty topic area: `'Out of ideas for ' || <topic words> || ' (' || n || ' used in 8 weeks)'` with topic words `demand` = `sales posts`, `reach` = `posts that bring new followers`, `case_study` = `case studies`, `teardown` = `teardowns`, `personal` = `founder stories`, `how_to` = `how-to posts`, `opinion` = `opinion posts`, `trust` = `trust posts`, `authority` = `expert posts`, else `replace(pillar,'_',' ') || ' posts'`.
- not enough ideas: `'Not enough ideas to fill the week of ' || to_char(week,'FMDD Mon')`.
- no_day: `n || ' planned post(s) in the week of 26 Oct have no free weekday'` (keep).
- draft_failed: `n || ' planned draft(s) failed the check twice. The planner is picking a new topic.'`
- no_fresh_proof: Ivan `'No new ideas from calls or your own work in 3 weeks'`, clients `'No new ideas from a client call in 3 weeks'`.
- no_photos: `'Only ' || n || ' fitting photo(s) left in your library'`.
- lm_due: `'No lead magnet in the week of ' || to_char(week,'FMDD Mon')` (the UI appends the ready-LM line and link).
- founder_cap: `n || ' founder stories next week. Your limit is ' || max`.

- [ ] **Step 4: Write `~/.local/state/offfix/build/sql/259_checks.sql`: rolled-back DO checks.** Apply the migration first inside a transaction that ends in a raise (dry run), then for real. The check block:

```sql
do $$ declare a text; j jsonb; bad text := ''; n int; begin
foreach a in array array['ivan','risedtc','arch'] loop
  j := public.content_plan_week(a);
  if jsonb_typeof(j->'brain_strip') <> 'object' then bad := bad || a || ':no strip; '; end if;
  select count(*) into n from jsonb_array_elements(j->'weeks') w, jsonb_array_elements(w->'posts') p where p->'brain' is null;
  if n > 0 then bad := bad || a || ':' || n || ' posts without brain; '; end if;
  select count(*) into n from jsonb_array_elements(j->'brain_strip'->'rules') r where r->>'rule_id' like 'zz-%';
  if n > 0 then bad := bad || a || ': zz rule shipped; '; end if;
  select count(*) into n from jsonb_array_elements(j->'weeks') w, jsonb_array_elements(w->'posts') p where (p->'brain'->>'quote') ~* '\m(je|nije|što|mislim|koji|ali|kad)\M';
  if n > 0 then bad := bad || a || ': non-English quote; '; end if;
  if (j::text) ~ '"agent_log"' then bad := bad || a || ': agent_log shipped; '; end if;
  if (j::text) ~* 'grycz-monika|aidan-collins-8a146530a' then bad := bad || a || ': author slug shipped; '; end if;
end loop;
raise exception 'CHECK RESULT: %', coalesce(nullif(bad,''),'all ok');
end $$;
```
Expected: `ERROR: CHECK RESULT: all ok`. Also dump one read per account to `~/.local/state/offfix/build/phase1/259-shape-<acct>.json` (`select public.content_plan_week('<acct>')::text`) and spot-check against the spec numbers: Ivan rules show 6 live (R06 13 %, R08 9 %, R11 unclear "your rule, not clear in the data", R04/H01/R16 no effect = `your_rule:true`), Rise live R10 25 %, Arch 4 shadow, Rise median about 253, Ivan median from client_post_metrics about 159-166, Rise "Elemental Air" and "What does storage cost you per order?" `qa.outcome='low'`.

- [ ] **Step 5: Time it.** Same command as Step 1, prefixed `after`; append to `259-timing.txt`. Each account under 300 ms and no more than 150 ms over its baseline. If over, cut per-draft work (index, narrower laterals, `materialized` CTEs) before continuing.

- [ ] **Step 6: Types in `src/lib/contentPlan.ts`.** Add the optional fields so later tasks compile against them (no UI change, no runtime behaviour change):

```ts
export type PlanFlags = { lm: boolean; boosted: boolean; founder: boolean; carousel: boolean; weekend: boolean; failed: boolean; low_score: boolean; fact_fail: boolean }
export type PlanQa = { outcome: 'passed' | 'recovered' | 'low' | 'failed' | 'hand' | null; first: number | null; final: number | null; max: number; pass_line: number | null; rewrites: number; approved_anyway: boolean; dims: Record<string, number> | null; weakest: string | null }
export type PlanBrainRead = { dim: string; val: string; rate: number; base: number; n: number; lo: number | null; hi: number | null; proven: boolean; small: boolean }
export type PlanBrain = {
  draft_id: string | null; words: number | null; edited: boolean; thumb: string | null; body_head: string | null; first_line: string | null; has_link: boolean
  flags: PlanFlags; qa: PlanQa | null; facts: { pass: boolean; failed: number | null; total: number | null } | null
  angle: { structure: string | null; opener: string | null } | null; trait: string | null; read: PlanBrainRead | null
  brief: { author: string | null; ratio: number | null; url: string | null; why: string | null } | null
  quote: string | null; quote_pending: boolean
  photo: { has: boolean; reason: string | null; rotation: boolean } | null
  replaced: { title: string; on: string } | null
  result: { views: number | null; reactions: number | null; comments: number | null; viral: boolean; young: boolean; url: string | null; engaged: { brand: number; total: number; usual_pct: number } | null } | null
  time_set_by: 'hand' | 'planner' | null
}
export type StripRule = { rule_id: string; name: string; metric: 'views' | 'comments'; gain: number | null; lo: number | null; hi: number | null; status: 'live' | 'shadow'; unclear: boolean; held_latest: boolean | null; your_rule: boolean; enforcer: string | null; creators: number | null }
export type BrainStrip = {
  rules: StripRule[]
  next_check: { date: string | null; watch: string[]; proposals: { id: number; rule_id: string; name: string; to_status: string; reason: string | null }[]; recent: { rule_id: string; name: string; to_status: string; at: string; undo_token: string | null }[] }
  reads: { items: { title: string; x: number; lo: number | null; hi: number | null; proven: boolean; small: boolean }[]; total: number }
  predictions: { measured: number; need: number; validated: boolean }
  views: { median: number | null; breakouts: number; measured: number; posts: { d: string; v: number; young: boolean }[] }
  idea_stock: { topic: string; stock: number; used: number }[]
  collection: { posts: number; creators: number } | null
  note: string | null
}
```
and add `brain?: PlanBrain` to `PlanPost` and `PlanSlot`; `draft_id?: string; impressions?: number | null; reactions?: number | null; comments?: number | null` to `PlanRead['done'][number]`; `done_median?: number | null; tz?: { name: string; label: string }; x_days?: string[]; brain_strip?: BrainStrip; supply?: { draft_id: string; title: string; format: string | null; created_at: string; brain: boolean | PlanBrain; evidence: PlanEvidence[] }[]` to `PlanRead`.

- [ ] **Step 7: Test the parse.** In `src/lib/contentPlan.test.ts` add:

```ts
it('accepts an enriched read and keeps the brain fields', () => {
  const r = parsePlan({ ok: true, account: 'risedtc', weeks: [w('this'), w('next'), w('after')], done: [], warnings: [], brain_strip: { rules: [], next_check: { date: null, watch: [], proposals: [], recent: [] }, reads: { items: [], total: 0 }, predictions: { measured: 0, need: 20, validated: false }, views: { median: null, breakouts: 0, measured: 0, posts: [] }, idea_stock: [], collection: null, note: null } }, 'risedtc')
  expect(r.brain_strip?.predictions.need).toBe(20)
})
```
(`w` = a helper building `{ start, which, target: 5, filled: 0, open: 5, posts: [], planned: [] }`; reuse an existing helper if the file has one.) Run `npx vitest run src/lib/contentPlan.test.ts` (PASS) and `npx tsc -b` (exit 0).

- [ ] **Step 8: Apply live and commit.** Apply `db/259_content_plan_brain.sql` with q.py, rerun the checks (Step 4) and timing (Step 5) after apply, then verify the live old Plan tab still loads (the controller's live check does the browser part). Commit:

```bash
git add db/259_content_plan_brain.sql db/259_content_plan_brain_rollback.sql src/lib/contentPlan.ts src/lib/contentPlan.test.ts
git commit -m "db/259: content_plan_week carries the content brain data for the Plan tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: English versions of call quotes (cached on `client_ideas`)

**Files:**
- Create: `db/260_content_plan_quotes.sql`, `db/260_content_plan_quotes_rollback.sql`
- Create: `supabase/functions/content-plan-quotes/index.ts`, `supabase/functions/content-plan-quotes/quotes.ts`, `supabase/functions/content-plan-quotes/quotes.test.ts`

**Model:** `sonnet`

**Interfaces:**
- Consumes: columns `client_ideas.quote_en, quote_en_at, quote_en_src` (Task 1); the source-quote rule of Task 1 (same precedence; implement it as SQL function `public.content_plan_source_quote(p_idea uuid) returns text` in db/260 and switch `content_plan_brain_items` to call it only if Task 1 did not already define one; one definition only).
- Produces: `public.content_plan_quotes_due(p_limit int default 20) returns table(idea_id uuid, src text)` (service_role only): ideas on plan slots or behind drafts dated in the next 3 weeks whose source quote is non-null and `quote_en_src is distinct from src`. `public.content_plan_quote_save(p_idea uuid, p_src text, p_en text) returns boolean` (service_role only): writes only when `p_en` is non-empty and `p_src` still equals the current source quote. Edge function `content-plan-quotes` (POST, header `x-inbox-secret` must equal the `INBOX_PUSH_SECRET` env the other inbox functions use; same check as `supabase/functions/inbox-notify/index.ts`). pg_cron job `content-plan-quotes` every 30 minutes calling it with pg_net, the secret read from `integration_config.inbox_push_secret` at run time inside the cron SQL (never written into a repo file).

- [ ] **Step 1: Write the pure prompt/parse module test** `supabase/functions/content-plan-quotes/quotes.test.ts` (Deno test, run with `deno test supabase/functions/content-plan-quotes/quotes.test.ts` if deno is installed; else port the same cases to `src/lib/planQuotes.test.ts` importing the module through a relative path and run with vitest):

```ts
import { buildBody, readAnswer } from './quotes.ts'
Deno.test('body has no system field and puts the instruction in the user turn', () => {
  const b = buildBody('Mislim da je to dobro.')
  if ('system' in b) throw new Error('system field present')
  if (b.messages.length !== 1 || b.messages[0].role !== 'user') throw new Error('not one user turn')
  if (!String(b.messages[0].content).includes('Mislim da je to dobro.')) throw new Error('quote missing')
})
Deno.test('reads only text blocks and refuses empty or refused answers', () => {
  if (readAnswer({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '  I think it is good.  ' }] }) !== 'I think it is good.') throw new Error('text block')
  if (readAnswer({ content: [] }) !== null) throw new Error('empty')
  if (readAnswer({ content: [{ type: 'text', text: "I can't help with that." }] }) !== null) throw new Error('refusal')
})
```

- [ ] **Step 2: Implement `quotes.ts`.**

```ts
export const MODEL = 'claude-sonnet-4-5'
export function buildBody(quote: string) {
  return {
    model: MODEL, max_tokens: 400,
    messages: [{ role: 'user', content:
      'Below is a short quote from a business call. If it is already in English, return it exactly as it is. ' +
      'If it is in another language, translate it into plain, natural English. Keep the speaker\'s meaning and tone. ' +
      'Return only the quote text, with no quotation marks and no notes.\n\nQuote:\n' + quote }],
  }
}
const REFUSAL = /^(i can'?t|i cannot|i'm sorry|sorry,|i am unable)/i
export function readAnswer(json: { content?: { type: string; text?: string }[] }): string | null {
  const text = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim().replace(/^["“]|["”]$/g, '').trim()
  if (!text || REFUSAL.test(text) || text.length > 1200) return null
  return text
}
```
Use the model id the other proxy callers in this repo or the Content System use (grep `railway` in `supabase/functions` and n8n exports for the model string; keep MODEL equal to it).

- [ ] **Step 3: Implement `index.ts`**: check `x-inbox-secret`; read `railway_proxy_key` and `railway_proxy_url` from `integration_config` with the service client; call `content_plan_quotes_due(20)`; for each row POST `buildBody(src)` to the proxy `/v1/messages` with headers `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json` (match how other repo callers authenticate to the proxy; grep first); `readAnswer`; on a non-null answer call `content_plan_quote_save`; on HTTP error/refusal/empty write nothing and count it. Return `{ due, saved, skipped }`. Never log quote text or keys.

- [ ] **Step 4: db/260**: the two functions above (+ `content_plan_source_quote` if needed), grants, and the cron job (insert via `cron.schedule('content-plan-quotes','*/30 * * * *', $$ select net.http_post(url := (select value #>> '{}' from public.integration_config where key='inbox_notify_url')... $$)`: build the function URL as `https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-plan-quotes` and the header from `(select value #>> '{}' from public.integration_config where key = 'inbox_push_secret')` evaluated inside the cron command, so no secret is stored in the repo). Check `integration_config.value` type first (jsonb vs text) and adapt the extraction. Rollback: `select cron.unschedule('content-plan-quotes');` + drop the functions.

- [ ] **Step 5: Deploy and run once.** `SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w) supabase functions deploy content-plan-quotes --project-ref bjbvqvzbzczjbatgmccb --no-verify-jwt` (the function checks its own secret header). Trigger one run through the cron command body (copy it into a SELECT run by q.py). Then prove: `select count(*) filter (where quote_en is not null), count(*) from client_ideas where id in (<due ids>)`; Arch items in `content_plan_week('arch')` now show English quotes; no non-English quote ships (rerun Task 1's DO check). Save outputs to `~/.local/state/offfix/build/phase1/260-*.txt`.

- [ ] **Step 6: Commit** `db/260_*`, `supabase/functions/content-plan-quotes/*` with message `db/260 + content-plan-quotes: English versions of call quotes, cached on client_ideas`.

### Task 3: Start recording (moves, photo reason, pick snapshot, Ivan early reads)

**Files:**
- Create: `db/261_content_plan_recording.sql`, `db/261_content_plan_recording_rollback.sql`
- Create (evidence): `~/.local/state/offfix/build/sql/261_checks.sql`

**Model:** `opus`

**Interfaces:**
- Consumes: `carousel_drafts`, `operator_set_schedule_date`, `ivan_photo_assign_v1(p_draft_id uuid, p_photo_id uuid, p_reason text)`, `content_plan_apply(p_account text, p_week date, p_picks jsonb, p_run jsonb)`, `content_plan_slots`, cb33 labelling (`cb33_label_discover`, `cb33_label_claim`, `cb33_render_read`).
- Produces: table `public.content_plan_moves(id bigserial pk, draft_id uuid not null, account text, from_at timestamptz, to_at timestamptz, by_who text not null, reason text, at timestamptz default now())` filled by an AFTER UPDATE OF scheduled_at trigger on `carousel_drafts` (never raises: whole body inside `begin … exception when others then return null; end`); `by_who` = `'ivan'` when `auth.uid()` is not null or the session role is `authenticated`, `'planner'` when `current_setting('application_name', true)` or the calling function marks it (set a GUC `content_plan.actor` inside `content_plan_apply`/Auto-Scheduler paths when available), else `'system'`. Column `content_plan_slots.pick_snapshot jsonb` (nullable) written by `content_plan_apply` from each pick's optional `snapshot` key (`{rank, proof, read}`) and, when absent, from `cb33_idea_read(account, idea_ref)` at apply time. `ivan_photo_assign_v1` also stores `photo_reason` (= `p_reason`) and `photo_reason_at` in taxonomy when a photo is assigned and `p_reason` is not null. Task 1's `time_set_by` reads `content_plan_moves` (latest row per draft: `hand` when `by_who='ivan'`, `planner` otherwise).

Ruling carried in this task (spec R2.6 last bullet + controller instruction): the Ivan writer `ULWz3DbYF0oSv2G8` is NOT edited. Its eight check scores, structure and opener are already in `agent_log` / `taxonomy` and Task 1 reads them server-side. Record this in the report.

- [ ] **Step 1: Investigate and write findings to the report** (SELECTs only): (a) does the n8n Ivan photo assigner pass `p_reason` when it assigns a photo? (grep the pulled workflow JSON via `n8nac` read-only `pull` into a NEW backup file under `research/plan-section-2026-10-11/`, or read executions with the n8n-execs skill); (b) why Ivan's Review drafts have no `cb33_early_reads` row: read `cb33_label_discover` body for its client/status filter; (c) the exact `content_plan_apply` body (`pg_get_functiondef`), saved into the rollback file first.
- [ ] **Step 2: Write `db/261_content_plan_recording.sql`** with: the moves table + trigger; `pick_snapshot` column; `content_plan_apply` replaced with the snapshot write added (body otherwise byte-identical to live; diff it); `ivan_photo_assign_v1` replaced with the reason kept; and, only if Step 1(b) shows a status/client filter that excludes Ivan Review drafts, the smallest change that lets the existing labeller pick them up (no new LLM path). If the photo assigner never passes a reason, note that the reason column stays empty until the assigner sends it, and do not edit that workflow in this task.
- [ ] **Step 3: Rolled-back proofs** in `261_checks.sql`: (1) update a real Ivan review draft's `scheduled_at` inside a DO block, read back the moves row, `raise exception` with it (rolled back); (2) call `content_plan_apply` on a fake week with a snapshot pick inside a DO block and raise the stored `pick_snapshot`; (3) call `ivan_photo_assign_v1` on an eligible draft with a reason and raise the taxonomy. Expected: each raise prints the row; nothing persists (verify with a count after).
- [ ] **Step 4: Apply, rerun Task 1's DO check and timing** (Task 1 reads `content_plan_moves`), commit `db/261_*` with message `db/261: record post moves, photo reasons and the pick snapshot for the Plan tab`.

### Task 4: Planner records candidates and writes plain `why_now`

**Files:**
- n8n workflow `NcDrN7QXun5s37u0` (planner) in `/Users/ivanmanfredi/Desktop/Ivan - Content System/workflows/n8n_ivanmanfredi_ivan_m/personal/`
- Backup: NEW file `/Users/ivanmanfredi/Desktop/Ivan - Content System/research/plan-section-2026-10-11/planner-before-2026-10-12c.workflow.ts` (pick a name that does not exist yet; check with `ls` first)

**Model:** `opus`

**Interfaces:**
- Consumes: `content_plan_apply(p_account, p_week, p_picks, p_run)`; Task 3's optional per-pick `snapshot` key.
- Produces: `content_plan_runs.outcome.candidates[]` = `[{ref, source, title, rank, picked: bool}]` (every candidate the model saw, in rank order) and `outcome.skipped[]` = `[{ref, title, reason}]` (one plain reason per candidate not picked, from the model's answer); each pick carries `snapshot: {rank, proof, read}` when the planner has them; `why_now` at most 20 words, everyday words.

- [ ] **Step 1: Read the protocol file completely** (Global Constraints) and confirm in the report that it was read.
- [ ] **Step 2: Pull, back up, read the workflow map**: `n8nac pull NcDrN7QXun5s37u0`, `cp` the pulled file to the NEW backup path (refuse if it exists), read only the `<workflow-map>` and the nodes that build the prompt, parse the answer, and call `content_plan_apply`.
- [ ] **Step 3: Edit the prompt** (user turn only; confirm there is no `system` field in the proxy call body; if one exists, move its text into the user turn): add the rules verbatim: "why_now: at most 20 words. Everyday words a non-native English reader understands in one pass. Never use these words: outlier, usual, primer, pillar, cadence, Review draft, niche winner, pattern. Say why this topic fits this week, not the draft's status." and ask the model to return, besides the picks, `skipped: [{ref, reason}]` with one short plain reason per candidate it did not pick.
- [ ] **Step 4: Edit the parse/apply node** so `p_run.outcome` carries `candidates` (all candidates with rank order and `picked`) and `skipped` (merge model reasons by ref; candidates the model did not mention get reason `"Not picked this run."`), and each pick carries `snapshot` when rank/proof/read exist on the candidate. Keep the existing `note` field (backward compatible).
- [ ] **Step 5: Validate and push**: `n8nac skills validate <file>`, `n8nac push <workflowDir>/<file>.workflow.ts --verify`, then `n8nac workflow deactivate NcDrN7QXun5s37u0` and `n8nac workflow activate NcDrN7QXun5s37u0`.
- [ ] **Step 6: Prove with a dry run**: call the planner webhook `content-plan-run` with `dry_run: true` for one account (header `x-brain-key` = `integration_config.cb35_brain_run_key`, read inside a script that never prints it; run one account per call), then read the execution (`n8nac execution list --workflow-id NcDrN7QXun5s37u0 --limit 1 --json` and `execution get <id> --include-data --json`, grep only the outcome object) and show `candidates` and `skipped` present and every `why_now` under 21 words with no banned word. If dry_run does not write `content_plan_runs`, prove from the execution data instead. Save to `~/.local/state/offfix/build/phase1/planner-dryrun.json`. No real (non-dry) run is triggered by this task.

### Phase 1 ship gate (controller)

- [ ] Rebase, push, confirm the Pages build is green and the live old Plan tab loads for Ivan/Rise/Arch with no console errors (writes blocked), `node tools/thread-open.mjs` passes; ledger the db files applied (259, 260, 261) and commits.

---

## Phase 2: Plan UI rebuild (skin section `content.plan`)

### Task 5: `planBrain.ts` pure plain-words mapping

**Files:**
- Create: `src/d/content/plan/planBrain.ts`, `src/d/content/plan/planBrain.test.ts`

**Model:** `sonnet`

**Interfaces:**
- Consumes: types from `src/lib/contentPlan.ts` (Task 1): `PlanRead`, `PlanPost`, `PlanSlot`, `PlanBrain`, `BrainStrip`, `StripRule`, `PlanWeek`; `displayTitle` from the same file.
- Produces (exact exports):
  - `type Acct = 'ivan' | 'risedtc' | 'arch'`; `ACCT_NAME: Record<Acct,string>` = Ivan/Rise/Arch; `OWNER: Record<Acct,string>` = you/Mattan/Davorin.
  - `type St = 'published' | 'scheduled' | 'review' | 'writing' | 'failed'`; `ST_WORD: Record<St,string>` = Published / Scheduled / Waiting for your OK / Being written / Failed.
  - `type PlanItem = { key: string; kind: 'post' | 'planned'; week: string; which: 'this'|'next'|'after'; day: string | null; suggested: boolean; at: string | null; title: string; st: St; draftId: string | null; slotId: string | null; ideaRef: string | null; ideaSource: string | null; format: string | null; brain: PlanBrain | null; evidence: PlanEvidence[]; whyNow: string | null; post?: PlanPost; slot?: PlanSlot }`
  - `itemsOf(read: PlanRead): PlanItem[]` (posts + planned slots, sorted by day then at; slot status mapping: `waiting_review` -> review, `planned`/`requested`/`drafting`/`proposal` -> writing; post status mapping: published/posted -> published, scheduled/pending/approved -> scheduled, review -> review, error -> failed, else scheduled; a planned slot with no day stays `day: null, suggested: true`; a planned slot with a day is `suggested: true`).
  - `statusOf`, `timeLabel(it, tz): string` ('07:00 PT' / '10:45 Warsaw' / ''), `reasonFor(it, acct): string | null`, `plainWhy(s: string): string`, `quoteFor(it): string | null`, `traitLine(it, acct): string | null`, `readLine(it, acct): { sign: 'Good sign'|'Bad sign'|'Neutral'; text: string; flat: boolean; x: number; detail: string; rel: string } | null`, `qaLine(it): string | null`, `factsLine(it): string | null`, `dimsOf(it): { key: string; label: string; v: number; low: boolean }[]`, `angleLine(it): string | null`, `firstLineChecks(it): string[]`, `dayWhy(it, acct, strip, tz): string`, `weekWhy(items, week): string`, `mixLine(items): string`, `flagsFor(it, strip): { key: 'lm'|'boosted'|'founder'|'carousel'|'weekend'|'failed'|'low'|'fact'; label: string; tone: 'ink'|'plain'|'red'|'amber' }[]`, `answerOf(read): { need: number; title: string; parts: string[] }`, `warningOf(w: PlanWarning): { text: string; link: { label: string; sub: string } | null }`, `ruleRow(r: StripRule): { name: string; effect: string; tone: 'pos'|'neg'|'tag' }`, `readsSummary(strip, acct): string`, `viewsLine(strip): string`, `resultLine(it, strip): string | null`, `weekDays(week: PlanWeek, items: PlanItem[]): number[]` (0..4 plus 5/6 only when an item sits there), `topicWord(p: string): string`, `upcoming(items, today): PlanItem[]`, `lateRun(read, now): boolean` (no planner run in 26 hours).

- [ ] **Step 1: Write the failing tests** `planBrain.test.ts` (vitest). Cover at least these cases with exact expected strings:

```ts
import { describe, expect, it } from 'vitest'
import { readLine, qaLine, factsLine, angleLine, dayWhy, flagsFor, ruleRow, warningOf, quoteFor, weekDays, answerOf, plainWhy, resultLine, mixLine, weekWhy, type PlanItem } from './planBrain'

const base = (over: Partial<PlanItem> = {}): PlanItem => ({ key: 'k', kind: 'post', week: '2026-10-12', which: 'this', day: '2026-10-14', suggested: false, at: '2026-10-14T14:00:00Z', title: 'T', st: 'review', draftId: 'd', slotId: null, ideaRef: null, ideaSource: null, format: 'text', brain: null, evidence: [], whyNow: null, ...over })
const brain = (b: object) => ({ draft_id: 'd', words: 120, edited: false, thumb: null, body_head: null, first_line: null, has_link: false, flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: false }, qa: null, facts: null, angle: null, trait: null, read: null, brief: null, quote: null, quote_pending: false, photo: null, replaced: null, result: null, time_set_by: null, ...b }) as PlanItem['brain']

describe('readLine', () => {
  it('good sign with detail and proof words', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'proof_type', val: 'named_example', rate: 0.068, base: 0.045, n: 398, lo: null, hi: null, proven: true, small: false } }) }), 'risedtc')!
    expect(r.sign).toBe('Good sign')
    expect(r.text).toBe("Posts with a named example go viral 1.5x more often in Rise's niche.")
    expect(r.detail).toBe('6.8% of these posts went viral, vs 4.5% of all posts. Based on 398 posts.')
    expect(r.rel).toBe('Proven on recent posts')
  })
  it('bad sign, a bit less often, not proven', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'proof_type', val: 'numbers_result', rate: 0.038, base: 0.045, n: 902, lo: null, hi: null, proven: false, small: false } }) }), 'risedtc')!
    expect(r.sign).toBe('Bad sign'); expect(r.text).toBe("Posts with a result in numbers go viral a bit less often in Rise's niche."); expect(r.rel).toBe('Not proven yet')
  })
  it('half as often under .6', () => {
    expect(readLine(base({ brain: brain({ read: { dim: 'angle', val: 'news', rate: 0.02, base: 0.045, n: 300, lo: null, hi: null, proven: true, small: true } }) }), 'arch')!.text).toBe("News posts go viral about half as often in Arch's niche.")
  })
  it('neutral within 15 percent, no scale', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'stakes', val: 'time_effort', rate: 0.053, base: 0.053, n: 571, lo: null, hi: null, proven: false, small: false } }) }), 'ivan')!
    expect(r.sign).toBe('Neutral'); expect(r.flat).toBe(true); expect(r.text).toBe('Posts about time or effort do about average in your niche.')
  })
  it('few examples', () => {
    expect(readLine(base({ brain: brain({ read: { dim: 'angle', val: 'story', rate: 0.07, base: 0.05, n: 120, lo: null, hi: null, proven: true, small: true } }) }), 'arch')!.rel).toBe('Proven on recent posts, but few examples')
  })
  it('no read', () => { expect(readLine(base(), 'ivan')).toBeNull() })
})

describe('qaLine / factsLine', () => {
  it('recovered', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 60, final: 63, max: 80, pass_line: 59, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 63/80 (needs 59). It was rewritten once.'))
  it('low approved anyway', () => expect(qaLine(base({ st: 'scheduled', brain: brain({ qa: { outcome: 'low', first: 55, final: 57, max: 80, pass_line: 59, rewrites: 1, approved_anyway: true, dims: null, weakest: null } }) }))).toBe('Low score: 57/80, even after a rewrite. Approved anyway.'))
  it('failed', () => expect(qaLine(base({ st: 'failed' }))).toBe('Failed twice. The planner is picking a new topic for this slot.'))
  it('passed first time', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'passed', first: 66, final: 66, max: 80, pass_line: 59, rewrites: 0, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 66/80 (needs 59).'))
  it('hand checked', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'hand', first: null, final: null, max: 80, pass_line: null, rewrites: 0, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Checked by hand.'))
  it('facts all match / some missing', () => {
    expect(factsLine(base({ brain: brain({ facts: { pass: true, failed: 0, total: 8 } }) }))).toBe('All 8 facts match the call.')
    expect(factsLine(base({ brain: brain({ facts: { pass: false, failed: 2, total: 8 } }) }))).toBe('2 of 8 facts not found in the call. It will be held at publish until fixed.')
  })
})

describe('angleLine', () => {
  it('structure + opener', () => expect(angleLine(base({ brain: brain({ angle: { structure: 'TEARDOWN (pillar)', opener: 'specific_receipt' } }) }))).toBe('Written as a teardown. Opens with proof.'))
  it('none', () => expect(angleLine(base())).toBeNull())
})

describe('dayWhy', () => {
  const strip = { rules: [{ rule_id: 'R11-weekend-risedtc', name: 'No weekend posts', metric: 'views', gain: 19, lo: 10.1, hi: 27, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'scheduler', creators: 46 }] } as never
  it('suggested slot', () => expect(dayWhy(base({ kind: 'planned', suggested: true, day: null }), 'risedtc', strip, { name: 'America/Los_Angeles', label: 'PT' })).toBe('No day yet. It gets the first free weekday of its week when you approve it.'))
  it('weekday with the testing rule', () => expect(dayWhy(base({ day: '2026-10-14', at: '2026-10-14T14:00:00Z' }), 'risedtc', strip, { name: 'America/Los_Angeles', label: 'PT' })).toBe('Wed 14 Oct, 07:00 PT. A weekday: weekend posts get 19% fewer views for Rise creators (still testing).'))
})

describe('flagsFor', () => {
  it('weekend post against a weekdays rule, low score not shown for Arch', () => {
    const strip = { rules: [{ rule_id: 'R11-weekend-ivan', name: 'Weekdays only', status: 'live' }] } as never
    const f = flagsFor(base({ day: '2026-10-17', brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: true, weekend: true, failed: false, low_score: false, fact_fail: false } }) }), strip).map(x => x.label)
    expect(f).toEqual(['Carousel', 'Weekend'])
  })
  it('failed is red and replaces low score', () => {
    const f = flagsFor(base({ st: 'failed', brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: true, low_score: true, fact_fail: false } }) }), { rules: [] } as never)
    expect(f.map(x => [x.label, x.tone])).toEqual([['Failed', 'red']])
  })
  it('low score amber, not on published', () => {
    const b = brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: true, fact_fail: false } })
    expect(flagsFor(base({ brain: b }), { rules: [] } as never).map(x => x.label)).toEqual(['Low score'])
    expect(flagsFor(base({ st: 'published', brain: b }), { rules: [] } as never)).toEqual([])
  })
  it('fact fail red', () => expect(flagsFor(base({ brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: true } }) }), { rules: [] } as never).map(x => x.label)).toEqual(['Not backed by the call']))
})

describe('ruleRow', () => {
  it('gain words', () => expect(ruleRow({ rule_id: 'R06-link-ivan', name: 'No links in the post', metric: 'views', gain: 13, lo: 3.3, hi: 21.7, status: 'live', unclear: false, held_latest: true, your_rule: false, enforcer: 'writer', creators: 69 })).toEqual({ name: 'No links in the post', effect: '13% more views', tone: 'pos' }))
  it('unclear', () => expect(ruleRow({ rule_id: 'R11-weekend-ivan', name: 'Weekdays only', metric: 'views', gain: 5.7, lo: -4.1, hi: 14.6, status: 'live', unclear: true, held_latest: false, your_rule: false, enforcer: 'scheduler', creators: 69 }).effect).toBe('your rule, not clear in the data'))
  it('your rule', () => expect(ruleRow({ rule_id: 'R04-short50-ivan', name: 'More than 50 words', metric: 'views', gain: null, lo: null, hi: null, status: 'live', unclear: false, held_latest: false, your_rule: true, enforcer: 'writer', creators: null }).effect).toBe('your rule'))
  it('comments', () => expect(ruleRow({ rule_id: 'R07-question-comments', name: 'A question gets more comments', metric: 'comments', gain: 7.93, lo: 2.78, hi: 13.35, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'writer', creators: 140 }).effect).toBe('8% more comments'))
})

describe('warningOf', () => {
  it('lm due links lead magnets', () => expect(warningOf({ code: 'lm_due', text: 'No lead magnet in the week of 26 Oct' }).link?.label).toBe('Lead magnets'))
  it('empty topic links ideas', () => expect(warningOf({ code: 'empty_topic_area', text: 'Out of ideas for sales posts (3 used in 8 weeks)' })).toEqual({ text: 'Out of ideas for sales posts (3 used in 8 weeks)', link: { label: 'Add ideas', sub: 'ideas' } }))
})

describe('quoteFor', () => {
  it('pending non-English shows nothing', () => expect(quoteFor(base({ brain: brain({ quote: null, quote_pending: true }) }))).toBeNull())
  it('cuts long quotes on a word with an ellipsis', () => { const q = quoteFor(base({ brain: brain({ quote: 'word '.repeat(60) }) }))!; expect(q.length).toBeLessThanOrEqual(201); expect(q.endsWith('…')).toBe(true) })
})

describe('weekDays', () => {
  it('adds Saturday only when a post sits there', () => {
    const w = { start: '2026-10-12', which: 'this', target: 4, filled: 5, open: 0, posts: [], planned: [] } as never
    expect(weekDays(w, [base({ day: '2026-10-17' })])).toEqual([0, 1, 2, 3, 4, 5])
    expect(weekDays(w, [base({ day: '2026-10-14' })])).toEqual([0, 1, 2, 3, 4])
  })
})

describe('answerOf / plainWhy / mixLine / weekWhy / resultLine', () => {
  it('plainWhy rewrites machine phrases', () => expect(plainWhy("A ready Review draft adapted from a niche outlier at 4.5x its author's usual")).toBe("A written draft based on a post that got 4.5x its author's normal views"))
  it('resultLine', () => expect(resultLine(base({ st: 'published', brain: brain({ result: { views: 27, reactions: 1, comments: 0, viral: false, young: false, url: null, engaged: null } }) }), { views: { median: 166 } } as never)).toBe('27 views. A normal post gets 166.'))
  it('weekWhy never repeats the post reason and uses the mix', () => expect(weekWhy([base({ evidence: [{ type: 'call', label: 'From the call on 3 Oct' }] }), base({ key: 'b', brain: brain({ flags: { lm: true, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: false } }) })], '2026-10-12')).toBe('This week: 1 from calls · 1 lead magnet.'))
})
```
(Also add an `answerOf` case: two review items this week + one later + one scheduled + one failed => `{ need: 3, title: '3 posts wait for your OK', parts: ['2 this week', '1 later', '1 scheduled', '1 failed'] }`, and none => `title: 'Nothing waits for you'`; and an empty-account case where every function returns null/[]/'' without throwing.)

- [ ] **Step 2: Run** `npx vitest run src/d/content/plan/planBrain.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement `planBrain.ts`.** Port the v3 logic (`~/.local/state/offfix/mock2/v3-body.html`: `TRAIT`, `STRUCT`, `HOOK`, `DIM`, `PIL`, `plainWhy`, `reason`, `shouldWork`, `readLine`, `qaLine`, `dims`, `angle`, `dayWhy`, `flags`, `answer`, `mixLine`) onto the typed `PlanItem`/`PlanBrain` shapes, with these changes required by R3/R4: reliability words from `read.proven`/`read.small`; `qaLine` from `qa.outcome`; `factsLine` from `brain.facts` (failed adds " It will be held at publish until fixed."); `flagsFor` adds `weekend` (only if a weekdays rule exists in `strip.rules` and the item day is Sat/Sun), `fact` (`Not backed by the call`, red), `low` suppressed for `arch` and for published; `traitLine` = "Top posts in <Rise's|your|Arch's> niche have this too: <trait words>." with the v3 replacements; `firstLineChecks` from `first_line`/`words`: `first_line.length <= 45` -> "Short first line: posts like this do 9% better.", first line contains `?` -> "A question in the first line: 12% fewer views.", `words !== null && words < 100` -> "Under 100 words: 12% fewer views." (constants from spec R3.4, named `FIRST_LINE_*`); `resultLine` per R4; `viewsLine` = `Last 90 days: <median> views on a normal post · viral = 3x that`; `readsSummary`: "<k> of <n> proven on recent posts" or "Not proven yet. The brain needs more of your recent posts." (Ivan) and the predictions line "Predictions start at 20 measured posts: <acct> <m> of 20." / "Rise has 24; its model has not passed its check yet." when `measured >= need && !validated`. Plain topic words for idea stock: `demand` sales posts, `reach` posts that bring new followers, `teardown` teardowns, `trust` trust posts, `personal` founder stories, `case_study` case studies, `how_to` how-to posts, `opinion` opinion posts, `authority` expert posts. Author names come from `brief.author` (already a real name); if null, say "a top post" (never a slug). No em dash anywhere in the strings (add a test that scans every exported string constant for `—`).
- [ ] **Step 4: Run** the test file: PASS. Run `npx tsc -b`: exit 0.
- [ ] **Step 5: Commit** `src/d/content/plan/planBrain.ts src/d/content/plan/planBrain.test.ts` — `plan: planBrain plain-words mapping (R4) with tests`.

### Task 6: PlanV2 frame: skin section, head, answer line, warnings, List view, phone

**Files:**
- Create: `src/d/content/plan/PlanV2.tsx`, `src/d/content/plan/PlanList.tsx`, `src/d/content/plan/plan2.css`, `src/d/content/plan/PlanV2.test.tsx`
- Modify: `src/ds/skin.ts` (Section + SECTIONS + BRIEF_DESKTOP gain `'content.plan'`), `src/ds/skin.test.ts` (counts 17 -> 18; `content.plan` implies `content`), `src/d/content/v2/flags.ts` (`plan: useSkin('content.plan')`), `src/d/content/index.tsx:201` (`sub === 'plan'` renders `PlanV2` when `cv2.plan`, else today's `Plan`), `src/d/shell/Phone.tsx:130` (content titles gain `plan: 'Plan'`)

**Model:** `opus`

**Interfaces:**
- Consumes: `fetchPlan(lane, signal)`, `PlanRead`, `planBrain` exports (Task 5), `Seg`, `SeatAv`, `Pill` from `src/d/content/v2/ui.tsx`, `Count` from `src/d/ui/Count.tsx`, `Failed`/`Skeleton` from `src/d/ui/states.tsx`, `useToast`, `useFrameMaybe` (layout `desktop|phone`), `useMotionLevel` from `src/ds/motionLevel.ts`, `dHash` from `src/d/route`, `LANES`, `LANE_NAME`, `Lane` from `src/d/content/model`.
- Produces: `export function PlanV2({ lane, setLane }: { lane: Lane; setLane: (l: Lane) => void })`; `PlanList({ read, items, phone, onOpen }: { read: PlanRead; items: PlanItem[]; phone: boolean; onOpen: (it: PlanItem) => void })`; a slot in `PlanV2` for `WeeksView` (Task 7), `PlanPanel` (Task 8) and `BrainStrip` (Task 9): until those land, `PlanV2` renders List on desktop too and `onOpen` is a no-op state setter `setOpen(it)`. CSS root class `.pl2`; status classes `.pl2-s-published|scheduled|review|writing|failed`.

- [ ] **Step 1: Failing tests** `PlanV2.test.tsx` (jsdom, mock `fetchPlan` with `vi.mock('../../../lib/contentPlan', ...)` keeping the real helpers via `importActual`): (1) renders "3 posts wait for your OK" and the parts line from a fixture read; (2) seat-switch race: first `fetchPlan('ivan')` resolves AFTER the second `fetchPlan('risedtc')`; the Rise title must stay and Ivan's items must never appear; (3) failed fetch shows the Failed state with Retry; (4) empty read (no items, empty strip) renders "Nothing waits for you" without throwing; (5) warnings render the R4 text plus the fix link `href` (`#exp/d/content/ideas?lane=risedtc` for empty topic); (6) no rendered text contains `—`. Build the fixture from `~/.local/state/offfix/build/phase1/259-shape-risedtc.json` trimmed to 4 items (store it as `src/d/content/plan/fixtures/rise.json`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Layout per spec §3 + R2.1: header row = large title "Plan" (desktop only; phone uses the shell's LargeTitle), `Seg` of the three seats with `SeatAv`, `Seg` "Weeks | List" (desktop only; phone always List), right-aligned planner line only when `lateRun(read, now)` ("The planner has not run since <Mon 12 Oct 07:20>."). Answer line: 28 px figure line `<Count value={need}/> post(s) wait for your OK` (signal red only when need > 0) and one line of parts joined by " · ". Warnings: attention-pair chips with the fix link (Ideas / Lead magnets / the draft / photo library), stagger 30 ms capped 400 ms. List: day groups with sticky headers ("Mon 26 Oct · 1 post", today in `--ds-signal` "Today"), rows with title 15 px, status dot + word (word on desktop; on phone keep the word too because colour alone is not a status), flags; tap expands in place (grid-rows 0fr -> 1fr, 380 ms, 0 ms when motion is off) showing: reason, quote (if any), trait line, the brain guess block, buttons "Why, in full" (opens panel) and, when waiting, "Read and approve" (link `dHash('content','now',{ draft, lane })`). Phone: 18 px radius cards, 20 px gutter only, no extra page padding, every tap >= 44 px, no text < 12 px. All hooks at the top of each component before any return. Fetch with AbortController and an account check (`r.account === lane`) exactly like today's `Plan.tsx`.
- [ ] **Step 4: Skin and routing.** Add `'content.plan'` to `Section`, `SECTIONS`, `BRIEF_DESKTOP` (and therefore WEB_DESKTOP/PHONE); update `skin.test.ts` expectations (17 -> 18, the content-implies list). `flags.ts` gains `plan`. `index.tsx`: `if (sub === 'plan') body = column(cv2.plan ? <PlanV2 .../> : <Plan .../>)`. Phone large title map gains `plan: 'Plan'`.
- [ ] **Step 5: Run** `npx vitest run src/d/content/plan src/ds/skin.test.ts src/d/content/SubNav.brain.test.tsx` PASS (SubNav was a baseline failure only if it is in the baseline list; otherwise it must pass) and `npx tsc -b` exit 0.
- [ ] **Step 6: Local look check**: `npx vite --port 5199` + a Playwright script under `~/.local/state/offfix/build/phase2/local-shot.mjs` (session injection like `~/.local/state/offfix/shots.mjs`, writes blocked) at 1280 and 390; save PNGs to `~/.local/state/offfix/build/phase2/task6-*.png`.
- [ ] **Step 7: Commit** — `plan: Oxygen Plan frame, answer line, warnings and list view behind content.plan`.

### Task 7: Weeks view and hover card (desktop)

**Files:**
- Create: `src/d/content/plan/PlanWeeks.tsx`, `src/d/content/plan/PlanHoverCard.tsx`, `src/d/content/plan/useHoverIntent.ts`, `src/d/content/plan/useHoverIntent.test.ts`, `src/d/content/plan/PlanWeeks.test.tsx`
- Modify: `src/d/content/plan/PlanV2.tsx` (Weeks is the desktop default), `src/d/content/plan/plan2.css`

**Model:** `opus`

**Interfaces:**
- Consumes: Task 5 (`weekDays`, `flagsFor`, `timeLabel`, `reasonFor`, `quoteFor`, `traitLine`, `readLine`, `qaLine`, `resultLine`, `mixLine`, `ST_WORD`), Task 6 (`PlanV2` open state `setOpen(it)`).
- Produces: `PlanWeeks({ read, items, today, onOpen })`; `useHoverIntent(): { bind(key: string): { onPointerEnter, onPointerLeave, onFocus, onBlur }; open: string | null; close(): void }` with timings first open 500 ms, warm open 80 ms (warm = a card was open within the last 900 ms), close 140 ms; `PlanHoverCard({ item, anchor: DOMRect, read, onClose })` placed beside the card, flipped to the left near the right edge (card width 340), vertically clamped to the viewport, grows from the edge facing the card (scale .96 -> 1, 4 px travel, `cubic-bezier(.16,1,.3,1)`; no motion when `useMotionLevel()` is `off` or reduced motion).

- [ ] **Step 1: Failing tests.** `useHoverIntent.test.ts` with fake timers: opens after 500 ms, not at 499; second card within 900 ms opens after 80 ms; leaving closes after 140 ms; focus opens like hover; `close()` cancels pending timers. `PlanWeeks.test.tsx`: three week rows with headers "This week / Next week / Week after", range "12 Oct to 16 Oct", meter `n of target`, mix line; a Saturday post adds a sixth column only in its week; today column labelled "Today"; past days get the past class; "Open slot" wells only up to `week.open` on future weekdays; a planned slot card has the dashed class and the suggested-day status; card face shows status word, time with zone, thumbnail when `brain.thumb`, title (3-line clamp), the one-line reason only when there is no thumbnail, and only exception flags (no "Check passed", no topic/audience chips); "X" mark on a day header when the day is in `read.x_days`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per spec §3a + R2.1/R2.2 + R3.5 and the v3 mock (`weeks()`, `hover()`), using Oxygen tokens. Hover card contents in order (R2.3): status (+ "No day yet" when suggested), title, "Why this post" reason, English quote, "Why it should do well" trait line, "Brain guess" one sentence + reliability, "Quality check" line, "Link allowed: boosted lead magnet." when `has_link && flags.boosted && flags.lm`, and for published posts the result line. The hover card closes when the panel opens (call `close()` inside `onOpen`). Hover is desktop only (`layout === 'desktop'` and `matchMedia('(hover: hover)')`); keyboard focus opens it too. Cards are buttons with `aria-describedby` pointing at the hover card when open.
- [ ] **Step 4: Run** tests PASS, `npx tsc -b` exit 0, local screenshots at 1280 (weeks + one open hover) to `~/.local/state/offfix/build/phase2/task7-*.png`.
- [ ] **Step 5: Commit** — `plan: weeks view with hover card`.

### Task 8: Detail panel (seven questions) and Move day

**Files:**
- Create: `src/d/content/plan/PlanPanel.tsx`, `src/d/content/plan/MoveDay.tsx`, `src/d/content/plan/PlanPanel.test.tsx`, `db/262_content_plan_move_slot.sql`, `db/262_content_plan_move_slot_rollback.sql`
- Modify: `src/d/content/plan/PlanV2.tsx`, `src/d/content/plan/plan2.css`, `src/lib/contentPlan.ts` (add `moveSlotWeek`)

**Model:** `opus`

**Interfaces:**
- Consumes: `Sheet` from `src/d/ui/Sheet.tsx` (right panel desktop, bottom sheet with grab bar + swipe-down phone), `useToast` (action Undo), the existing schedule write in `src/lib/content.ts` around line 1446-1470 (`operator_set_schedule_date(p_gate, p_draft_id, p_scheduled_at)`; reuse the exported helper there and its gate value), Task 5 mapping functions.
- Produces: `PlanPanel({ item, read, lane, onClose, onChanged })`; `MoveDay({ item, read, onPick, onCancel })` (two-week weekday picker, weekends shown only if the current day is a weekend, keeps the post's time of day in its zone); SQL `public.content_plan_move_slot(p_slot uuid, p_week date) returns jsonb` (authenticated, operator-gated the same way as the other operator_* RPCs: copy the gate check used by `operator_set_schedule_date`), moving a planned slot to another week of the 3-week horizon only when that week has room (`filled < target`), returning `{ok, from_week, to_week}`; `moveSlotWeek(slotId: string, week: string): Promise<{ from_week: string; to_week: string }>` in `src/lib/contentPlan.ts`.

- [ ] **Step 1: db/262** with rollback, rolled-back DO proof (move a real slot inside a DO block, raise the result, verify unchanged after), apply.
- [ ] **Step 2: Failing tests** `PlanPanel.test.tsx`: the seven sections in order with headings "Why this post", "Why this week", "Why this day", "How it is written", "Is it good", "Will it do well", "How it did" (last only for published); "Why this week" text differs from "Why this post"; "Will it do well" shows the scale only when not flat and never a helps/hurts list; the eight score bars with the weakest marked; keys: waiting -> "Read and approve" (ink) + "Open draft" + "Move day"; published -> "Open on LinkedIn" only (no Move day, no Open draft); failed -> "Open draft" only; a pending non-English quote shows no quote; Rise photo reason reads "Mattan's photo, picked in rotation" when `photo.rotation`; Ivan "No photo: <reason>"; replaced slot shows "Replaced: '<title>' failed the quality check on <12 Oct>; the planner picked this one."; first lines (260 chars) block; Move day calls the schedule helper with the new date at the same local time and shows a toast with Undo that restores the old date.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** per R2.4 + R3.3-R3.5 + R4 and the v3 `panelHtml()`. Meta line: day, time with zone, words, "edited by hand". Section 1 reason + source line (if different) + quote (blockquote) + "A written draft based on a post by <Name> that got <ratio>x their normal views." when `brief`. Section 3 `dayWhy`. Section 4 `angleLine` + trait line + borrowed shape + `firstLineChecks` + the H01 opener line when a live/shadow H01 rule exists: "Writer rule: open with something <you|Mattan|Davorin> did or saw." Section 5 `qaLine` + `factsLine` + bars. Section 6 the read block (sign, sentence, scale half as often / average / 2x as often, detail + reliability) or "No brain guess yet for this draft." Section 7 views vs median, reactions, comments, "Went viral." when viral, Rise engaged line "<brand> of <total> people who engaged run a brand (Rise normal: <usual>%)."; young posts "Numbers are still coming in." Keys pinned at the bottom.
- [ ] **Step 5: Run** tests PASS, tsc exit 0, local screenshots desktop panel + phone sheet to `~/.local/state/offfix/build/phase2/task8-*.png`.
- [ ] **Step 6: Commit** — `plan: detail panel with the seven questions and Move day (db/262)`.

### Task 9: Brain strip (four tiles with charts) and idea-stock popover

**Files:**
- Create: `src/d/content/plan/BrainStrip.tsx`, `src/d/content/plan/charts.tsx`, `src/d/content/plan/charts.test.ts`, `src/d/content/plan/BrainStrip.test.tsx`
- Modify: `src/d/content/plan/PlanV2.tsx`, `src/d/content/plan/plan2.css`, `src/lib/contentPlan.ts` (proposal decide + undo calls)

**Model:** `opus`

**Interfaces:**
- Consumes: `read.brain_strip` (Task 1), Task 5 (`ruleRow`, `readsSummary`, `viewsLine`, `topicWord`), RPCs `brain_proposal_accept(p_id bigint, p_actor text)`, `brain_proposal_dismiss(p_id bigint, p_actor text)`, `brain_rule_undo(p_token uuid)` (check their grants to `authenticated`; if not granted, add `db/263_plan_brain_actions.sql` + rollback with thin operator-gated wrappers `operator_brain_proposal_decide(p_id bigint, p_accept boolean)` and `operator_brain_rule_undo(p_token uuid)` copying the gate of `operator_set_schedule_date`).
- Produces: `BrainStrip({ strip, acct, items, onIdeaStock })`; pure chart scale helpers in `charts.tsx`: `logX(v: number, lo: number, hi: number, w: number): number`, `ratioX(r: number, w: number): number` (log2 from .5x to 2x), `effectX(v: number, lo: number, hi: number, x0: number, w: number): number`.

- [ ] **Step 1: Failing tests**: `charts.test.ts` (ratioX(.5)=0, ratioX(1)=w/2, ratioX(2)=w, clamps; logX monotone and clamped); `BrainStrip.test.tsx`: tile titles "What moves views", "Next brain check", "Brain guesses, next 2 weeks", "Views per post, 12 weeks"; filled dot for live, hollow for shadow; Ivan shows all six live rules incl. "your rule" rows; unclear row says "your rule, not clear in the data"; a held_latest=false rule says "did not hold on the newest posts, kept because you set it"; `zz-` never rendered; Next brain check "Mon 2 Nov. Under watch: weekdays only, the 50-word floor." style line from `next_check`; proposals render Accept / Dismiss buttons that call the RPC and toast; recent changes render Undo; reads tile grey dots when not proven + "small sample" label when `small`; predictions line; views tile median line + 3x line + hollow young dots, footer "Last 90 days: 253 views on a normal post · viral = 3x that"; source line "From 10,629 posts by 140 creators." from `collection`; Rise note rendered under the strip; every SVG text >= 12 px; empty strip renders "None proven yet" / "No brain guesses yet" without throwing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** from `~/.local/state/offfix/final-review/viz/src/build.py` (tiles 04 rules, 03 reads, 01 views) with Oxygen tokens, R4 words ("Rules we follow" filled / "Testing, not used yet" hollow legend), tooltips via `title`/`<title>` plus an accessible list fallback (`<ul class="pl2-sr">`). The "Out of ideas" warning chips (clients) open a popover with the idea-stock bars (stock bar, used tick, amber when 0), from `idea_stock` with `topicWord`; Ivan keeps the text warning. Phone: strip tiles stack in a horizontal scroll row with 44 px tap targets; charts keep 12 px text.
- [ ] **Step 4: Run** tests PASS, tsc exit 0, local screenshots of the strip for the three seats to `~/.local/state/offfix/build/phase2/task9-*.png`.
- [ ] **Step 5: Commit** — `plan: brain strip charts and idea stock`.

### Task 10: Live verification harness and Phase 2 ship

**Files:**
- Create (not in repo): `~/.local/state/offfix/build/verify/plan-live.mjs`

**Model:** `sonnet`

**Interfaces:**
- Consumes: live app `https://ivanmanfre.github.io/ivan-inbox/#exp/d/content/plan`, session `python3 ~/.local/state/offfix/mksession.py` -> `~/.local/state/offfix/.session.json`, Playwright from `~/.claude/skills/playwright-driver/node_modules/playwright`.
- Produces: `node plan-live.mjs <outdir>` writing `census.json` and PNGs: for each seat (Ivan, Rise, Arch) at 1280 (Weeks, List, one hover open, panel open), 390 and 430 (WebKit iPhone emulation: list, one row expanded, sheet open); counts of visible text nodes under 12 px and tap targets under 44 px on phone (exempt nothing except hidden/zero-size); horizontal overflow; console errors and `console.warn` lines containing "An error occurred"; a reduced-motion run (`reducedMotion: 'reduce'`) asserting the hover card and expand have no transition duration; writes blocked except `/auth/v1/token` and `/rpc/` (allow GET/HEAD).

- [ ] **Step 1: Write the script** from `~/.local/state/offfix/shots.mjs` (session injection, write blocking) and the census rules above; guard `process.on('unhandledRejection')`; never run two browser jobs at once; wait for the plan answer line (not a fixed 4 s) before measuring.
- [ ] **Step 2: Run it against the local dev build** (`--base http://localhost:5199/`) and fix nothing itself: report findings to the controller.
- [ ] **Controller ship:** after Tasks 5-9 and local census are clean: `git pull --rebase origin main`, `npx tsc -b`, unit suite (no new failures vs baseline), `git push origin HEAD:main`, wait for the Pages run (`gh run list --limit 3`), run `plan-live.mjs ~/.local/state/offfix/build/phase2/live` and `node tools/thread-open.mjs`; zero sub-12 px text, zero sub-44 px taps, zero console errors on Plan for all seats; desktop other tabs unchanged (spot-check Calendar and Review screenshots before/after).

---

## Phase 3: new-plan alert, plain words outside Plan, client panels

### Task 11: `plan_ready` alert

**Files:**
- Create: `db/264_content_plan_ready_alert.sql`, `db/264_content_plan_ready_alert_rollback.sql`
- Modify: `supabase/functions/_shared/notify.ts` (PUSH_DEFAULT), `supabase/functions/_shared/notify.test.ts`, `supabase/functions/_shared/alert-kinds.ts` (a `content_plan` presentation if the kinds map needs one)

**Model:** `opus`

**Interfaces:**
- Consumes: `content_plan_week` (Task 1 fields: weeks, brain flags, warnings), `content_plan_runs`, `content_plan_slots`, `integration_config` keys `inbox_notify_url`, `inbox_push_secret`, pg_net, pg_cron.
- Produces: table `public.content_plan_alerts(account text, week_start date, filled_at timestamptz not null, sent_at timestamptz, request_id bigint, payload jsonb, primary key(account, week_start))`; function `public.content_plan_ready_check(p_account text, p_week date, p_now timestamptz default now()) returns jsonb` (SECURITY DEFINER, service only) that (1) returns `{fire:false, why}` when the week had no run with `picked > 0` (nothing planned), when an alert row already has `sent_at`, or when some planned post of the week has no written draft and it is less than 6 hours since `filled_at`; (2) otherwise builds the payload and posts it with `net.http_post` to the inbox-notify URL with header `x-inbox-secret` read from `integration_config` at run time, stores `sent_at`, `request_id`, `payload`, returns `{fire:true, payload}`; `public.content_plan_ready_sweep()` loops accounts and the next two weeks; `content_plan_apply` calls `perform public.content_plan_ready_check(p_account, p_week)` at its end (inside `begin … exception when others then null; end` so an alert failure never fails a plan write); pg_cron job `content-plan-ready` every 15 minutes running the sweep.
- Payload (feed + push): `{family:'content_plan', source:'content-plan', dedupe_key:'plan-ready:'||account||':'||week, severity:'info', title, body, url:'./#exp/d/content/plan?lane='||account, media:{kind:'plan_ready', account, week}, push:true}`; title `'<Rise> · week of 26 Oct is ready'`; body built from counts with R4 words, no scores: `'5 written, 4 wait for your OK.'` then optional `' 1 is still being written.'`, `' 1 has a low score.'`, `' 1 failed.'`, `' Out of ideas for sales posts.'` (from empty_topic_area warnings). When all are written and waiting: `'5 posts written and checked. They wait for your OK.'`

- [ ] **Step 1: Bring the 12-hour rule into this branch.** `git cherry-pick 42f75b23` (commit "notify: the same alert rings once per 12 hours", already deployed live as inbox-notify v22 but not on origin/main). Then download the live function to compare: `SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w) supabase functions download inbox-notify --project-ref bjbvqvzbzczjbatgmccb` into `~/.local/state/offfix/build/phase3/inbox-notify-live/` and diff `_shared/notify.ts` and `inbox-notify/index.ts` against the branch. If the live code has anything else the branch lacks, STOP and report (do not deploy over it).
- [ ] **Step 2: Failing test** in `notify.test.ts`: `pushDefault('content_plan','info')` is `true`; a muted family stays false. Run the notify tests the way the file expects (deno test if the file imports `jsr:`/`npm:` specifiers; check the header) — FAIL. Add `content_plan: true, // plan_ready only: one alert per account-week (db/264); the Monday plan line is written by SQL and never pushes` to PUSH_DEFAULT. PASS.
- [ ] **Step 3: db/264** + rollback (`cron.unschedule('content-plan-ready')`, restore the 261 `content_plan_apply` body, drop the new objects). Rolled-back DO proofs (raise the results): (a) `content_plan_ready_check` on a week whose last run has `picked = 0` -> `fire:false`; (b) on a filled week where a draft is missing and filled_at is 1 h ago -> `fire:false`; (c) same with filled_at 7 h ago -> `fire:true` and the payload text, but inside the DO block replace the http call by checking the built payload only (add a `p_dry boolean default false` parameter that skips `net.http_post` and the ledger write); (d) calling it twice on a sent week -> second is `fire:false` ('already sent'). Paste the four raise messages into `~/.local/state/offfix/build/phase3/264-proofs.txt`.
- [ ] **Step 4: Deploy inbox-notify** (`supabase functions deploy inbox-notify --project-ref bjbvqvzbzczjbatgmccb`, keeping its current JWT setting: read it from the existing deploy notes/`supabase/config.toml` first) only after Step 1's diff is clean. Apply db/264.
- [ ] **Step 5: One real feed-only test row**: call inbox-notify once through `net.http_post` in a SELECT with `family 'content_plan'`, `title 'TEST plan_ready shape (remove)'`, `push:false`, `dedupe_key 'plan-ready:test:2026-10-12'`, `media.kind 'plan_ready'`, `media.test true`; confirm the row; then mark it removed the way the inbox does (set `dismissed_at = now()` on that id only; this is a test row this task created, not content data). Save receipts to `~/.local/state/offfix/build/phase3/notify-test.txt`.
- [ ] **Step 6: Commit** — `db/264 + notify: plan_ready alert, one per account-week, push for plan_ready only`.

### Task 12: Plain words on the Monday card, brain line and rule-change feed

**Files:**
- Create: `db/265_plan_plain_words_feed.sql`, `db/265_plan_plain_words_feed_rollback.sql`

**Model:** `sonnet`

**Interfaces:**
- Consumes: live bodies of `brain_monday_line(p_now)`, `content_plan_monday_lines(p_now)` (and `cb39_monday_card` if the lines are assembled there), any function that writes the "rule moved to in force" feed row (search `pg_proc.prosrc ilike '%inbox_notifications%' and prosrc ilike '%brain_rule%'`), `brain_rule_plain` (Task 1).
- Produces: the same functions with R4/R3.6 words: brain line like `"Brain: no rule changed this month. Being tested: a picture, 54% more views for Rise creators."` (never raw codes such as `R06-link-ivan` or "set to"); plan lines per account like `"Ivan: 5 posts this week. Your rule is 2 to 4."` when over the rule, `"Rise: next 2 weeks planned. 4 wait for your OK."`; rule-change feed text `"Pictures are now used for Rise (54% more views, 46 creators). Undo"` with the undo token in `media`.

- [ ] **Step 1:** Capture live bodies into the rollback file. **Step 2:** Write the new bodies (names from `brain_rule_plain`, gains with `follow_sign`). **Step 3:** Rolled-back proof: `do $$ begin raise exception '%', public.brain_monday_line(now()) || ' || ' || (select string_agg(x::text, ' | ') from public.content_plan_monday_lines(now()) x); end $$;` (adapt to the real return types); the raised text must contain no `R0`/`R1`/`H0` codes, no em dash, no banned word. **Step 4:** Apply; save the raised text to `~/.local/state/offfix/build/phase3/265-lines.txt`. **Step 5:** Commit — `db/265: Monday card, brain line and rule-change feed in plain words`.

### Task 13: Client panels: drop internal text and stale blocks, add "Coming up"

**Files:**
- Create: `db/266_client_panel_coming_up.sql`, `db/266_client_panel_coming_up_rollback.sql` (and, only if the panel renderer needs it, a change in the personal-site repo: see Step 1)

**Model:** `opus`

**Interfaces:**
- Consumes: `client_boards` (`slug` `arch-agency`, `risedtc-com`; `board` jsonb with `week_plan`, `week_plan_focus`, `week_plan_pending`, `calendar`, `calendar_plan`, `engine_updates`), their writers, `content_plan_week`.
- Produces: no internal text on client panels (`week_plan` "Story bank: 2 eligible / 0 in cooldown / 0 pending consent" gone), stale `calendar`/`engine_updates` blocks either fed from the plan or hidden, and a "Coming up" list for the next two weeks with day and title only (`"Coming up · Tue 20 Oct: Customers were missing free shipping by a few dollars"`), no scores, no reads, no "waiting for Ivan".

- [ ] **Step 1: Investigate (read only) and report:** where the panels render (`client_boards` readers in the personal-site repo: find the repo path from memory `client-panels-periods-live-2026-10-12.md` / `feedback-no-client-reports-panels-are-status-2026-10-12.md`; read `~/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/` notes on personal-site deploy hazards before touching it), which keys the page shows, and which workflow/function writes `week_plan`, `calendar`, `engine_updates` (search `pg_proc` and n8n exports for `client_boards` writers). Prefer a data-only fix: a SQL function `public.client_board_coming_up(p_slug text)` that writes `board.calendar` (or the key the page already renders as a calendar) from `content_plan_week` (dated client posts of the next 2 weeks with status scheduled/approved/review that Ivan has approved for scheduling: client panels show only posts with a date; planned-but-undated items are not shown) as day + title, and empties `week_plan` internal lines and stale `engine_updates` (set to `[]`/remove the internal line, keeping a backup of the old values in the rollback file and in `~/.local/state/offfix/build/phase3/client-boards-before.json`). Run it by pg_cron hourly. If a writer would overwrite the fix, change that writer's SQL source minimally or report it.
- [ ] **Step 2:** If, and only if, the page cannot show the data without a code change, make the smallest change in the personal-site repo following its deploy rule (`menubar/deploy.sh` only, per memory) and report the commit; otherwise make no site change.
- [ ] **Step 3:** db/266 + rollback; rolled-back proof that raises the new `calendar`/`week_plan` values for both slugs; apply; screenshot both client panels (logged-in check method from the personal-site memory notes; read only) to `~/.local/state/offfix/build/phase3/panel-*.png`. Never send anything to a client. **Step 4:** Commit — `db/266: client panels lose internal text and show the next two weeks (day and title)`.

### Task 14: Final verification and memory note (controller)

- [ ] Rebase, tsc, unit suite vs baseline, push, Pages green; rerun `plan-live.mjs` into `~/.local/state/offfix/build/final/`, `node tools/thread-open.mjs`; DB checks (Task 1 DO block, timing for all three accounts) into `~/.local/state/offfix/build/final/`.
- [ ] Append a short dated update to `~/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/content-plan-horizon-2026-10-11.md` (append only): what shipped, db files, commits, rulings, open items.
