# Content > Plan tab: Oxygen redesign with content brain data

Date: 2026-10-12. Status: revision 2 after a full content brain audit and an adversarial review; waiting for Ivan's approval.
Mockup v2 (real data, interactive): `/Users/ivanmanfredi/Desktop/Ivan - Content System/research/plan-section-2026-10-11/plan-oxygen-mockup-v2-2026-10-12.html`
Audit outputs: `~/.local/state/offfix/brain-audit/` (q01-q19), review notes: `~/.local/state/offfix/review/plan-oxygen-review-2026-10-12.md`.

## 1. What Ivan asked for

Said (12 Oct): make the Plan tab friendlier and easier to digest; hover, animation, readability; planned calendar dates; creative alternatives; a notification when a new plan is ready; plan it in detail using the most important content brain data (tags, flags, details) in the card, the hover and the preview; match the Oxygen inbox design; use 21st.dev for inspiration.

Standing rules this must respect: no checking each post, warnings only when something is missing; client posts are never sent or scheduled without Ivan; plain words, no machine labels.

Assumptions (correct me): Ivan opens Plan mostly on desktop to see the two weeks at a glance, and on the phone to check what waits for him. Approving still happens in Review; Plan links there.

## 2. Success criteria

- In 3 seconds Ivan can answer: is the next two weeks covered, what waits for me, is anything broken.
- Every post shows its day, status and flags on the face; the reason it was picked and the brain's read appear on hover without a click; everything else is one click away.
- Looks like the rest of the Oxygen inbox (Calendar, Review): same tokens, type, motion, components.
- One alert per account-week when a plan is ready, never on "nothing to do" runs.
- Floors hold: no text under 12px on phone, every tap 44px, reduced motion respected, desktop other tabs unchanged.

## 3. Layout

Header: large title "Plan" (phone large title gets a `plan` entry in `Phone.tsx`), seat switch using the shared `Seg` with seat avatars (`.cv2-seg`, `SeatAv`), view switch `Weeks | List` (desktop only; phone is always List), right-aligned "Planner looked today 07:20" in mono meta.

Answer line (the only line under the title): "N posts wait for your OK" as a 28px figure line, with rolling `Count` figures: next 2 weeks, scheduled, need your OK (signal red when > 0), being written (only if > 0), failed (only if > 0).

Warnings: attention-pair chips (`#865d19` on `#fcf1e2`), each with a fix link: empty topic area -> Ideas, lead magnet due -> Lead magnets, draft failed -> the draft, no photos -> photo library. No helper sentences (cadence line and "Planned posts show..." notes are removed; that info moves into hover/panel).

### 3a. Weeks view (desktop default)

Three rows (this week, next week, week after), five weekday columns. Week header: name, date range, a 5-segment fill meter, "n of 5". Today's column gets an ink ring and red "Today". Past days lose their background. Empty future day shows a dashed "Free" well.

Card face (max four things):
1. status dot + word (Published grey, Scheduled clear-green, Waiting for your OK attention-amber, Being written info-blue with a soft pulse, Failed urgent-red) and the time in mono (posts that have a real time)
2. title, up to 3 lines
3. flag icons only when true: lead magnet (ink chip), boosted with ads, founder story, carousel / photo, "failed a check once" (red)
4. a planned slot whose day is only a suggestion has a dashed border; a dated post has a solid one

Hover card (desktop, keyboard focus too): 500ms to open the first time, 80ms while scanning ("warm" mode), 140ms close; grows from the edge facing the card (scale .96 -> 1, 4px travel, `cubic-bezier(.16,1,.3,1)`), placed beside the card, flipped near the right edge. Contents in order: status (+ "suggested day"), title, why this week, the call quote, the content brain early read (see 4), tags (pillar, audience, ICP, check), source line with call icon.

### 3b. List view (desktop option, phone always)

Day groups with sticky day headers ("Mon 26 Oct · 1 post", today in red). Rows: title 15px, status dot (+ word on desktop), flags; tags on desktop rows only. Tap expands in place (grid-rows 0fr -> 1fr, 380ms): why this week, quote, early read, "All details" and, if waiting, "Read and approve". Phone uses the 18px card radius and the 20px gutter only (remove the page's own 16px padding).

### 3c. Detail panel

`src/d/ui/Sheet.tsx`: right panel on desktop, bottom sheet with grab bar and swipe-down on phone. Sections, each only if it has data:
- status, title, day/time (or "suggested day, set when scheduled"), word count
- flags + tags
- Why this week
- Where it comes from: all evidence labels, call quote, and for brain adaptations "Adapted from <author>, Nx their usual" with the source link
- Content brain early read: meter + the read sentence + reliability
- Quality check: passed / failed, score, "failed once, then went through", claim-check flags
- Picture: photo used or "No photo: <reason>" (Ivan)
- First lines of the post (260 chars)
- Done posts only: impressions, reactions, comments vs the account median
Keys pinned at the bottom: Read and approve (ink, only when waiting), Open draft, Move day.

"Move day" opens a 2-week day picker and calls `operator_set_schedule_date` (dated posts) or moves the plan slot's week (planned slots). Toast with Undo (existing `useToast` action).

### 3d. Alternatives considered

- Calendar (chosen for desktop): best answer to "is the fortnight covered", and dates were asked for.
- Agenda list (chosen for phone and as a desktop toggle): reads best at 390px; sticky day headers from the 21st.dev kuratlielia Timeline.
- Board by readiness: dropped for Plan. It duplicates Review; may come back as a Review layout later.
- The existing Calendar tab keeps the month grid, drag-to-move and rails. Plan stays a 3-week planning read and links each card into Calendar/Review.

## 4. Content brain data shown (from the 12 Oct inventory)

| Data | Source | Fill (Arch / Ivan / Rise, posts on the plan) | Where |
|---|---|---|---|
| Status, day, time | `content_plan_week` today | 100% | face |
| Lead magnet | RPC + new check of `taxonomy.lead_magnet_slug`/`gate_keyword` (Rise LMs read false today) | Ivan 6/20 | face |
| Boosted | `taxonomy.paid_boost` | Ivan 2 | face |
| Founder story | `taxonomy.pillar='personal'` | Rise 2/20 | face |
| Carousel / photo | format, `image_urls` | 100% | face |
| QA give-up / failed | `agent_log` QA Give-Up, status error | Arch 5, Ivan 1, Rise 1 | face (red) + panel |
| Why this week | plan slot `why_now` | planned slots 100% | hover, panel |
| Call quote | `client_ideas.score_breakdown->>'why'` (RPC reads empty fields today) | Rise 88%, Arch 78% of ideas | hover, panel |
| Early read: breakout rate vs niche usual, reliability | `cb33_early_reads.rendered_read` (`pattern.rate/base_rate/n`, `holdout.state`, `sentence`) | Arch 9/9, Ivan 11/20, Rise 14/20 | hover meter, panel |
| Pillar, audience (funnel) | `taxonomy.pillar`, `funnel_stage` | pillar A 1/9, I 7/20, R 12/20; funnel ~95% | hover chips |
| ICP score | `client_ideas.icp_score` | A 6/9, R 9/20 | hover chip, panel |
| Quality check verdict/score | `qa.verdict`, `qa.score/total_80` | uneven, normalised server-side | hover chip, panel |
| Brain adaptation source | `taxonomy.brain_brief` author/ratio/url/why | supply drafts | panel |
| Photo reason | `taxonomy.no_photo_reason`/`photo_reason` | Ivan | panel |
| Hand edited | `taxonomy.human_edited` / agent_log | A 8/9 | panel icon |
| Done performance | `client_post_metrics` via `cb37_draft_post_links_v`; Ivan `ivan_post_outcome_spine` | A 12/13, I 23/32, R 40/41 | "Topics done" hover, panel |

Shown with care: the industry forecast score (`editorial_forecasts`) has no likelihood on any row (insufficient data), so it is not shown as a prediction; only the early read appears, always with its reliability ("Checked on recent posts" / "Not confirmed on recent posts yet"; Ivan's reads are all the second today). Skipped: topic_strength, render_engine, experiments (stale), cb39 verdicts (empty), hook/structure (patchy).

## 5. Data changes (db/259, additive, rollback file)

`content_plan_week` gains per post, planned slot and supply item a `brain` object, computed server-side (agent_log is never shipped):
`{ qa:{verdict,score,gave_up,regen}, read:{sentence,rate,base_rate,n,dimension,value,holdout}, tags:{pillar,funnel,icp}, quote, brief:{author,ratio,url,why}, photo:{has,reason}, edited, words }`
and `done[]` gains `draft_id, impressions, reactions, comments` plus top-level `done_median`.
Fixes: lead_magnet also true for `lead_magnet_slug`/`gate_keyword`; idea quote falls back to `score_breakdown->>'why'`.
Speed: one batched lateral per draft; target under 300ms per account read (today's read measured first, gate on no regression > 150ms).

## 6. New-plan alert

When the planner fills a week for an account and every planned post of that week has a written draft (or 6 hours after filling, whichever first), write one `inbox_notifications` row through `_shared/notify.ts`: family `content_plan`, kind `plan_ready`, dedupe `plan-ready:<account>:<week>`, url `#exp/d/content/plan?lane=<account>`. Title "Rise · week of 26 Oct is ready", body "5 posts written and checked. They wait for your OK." (or "3 of 5 written, 2 still being written"). Push allowed for `plan_ready` only (add to `PUSH_DEFAULT`), respecting the existing 12h same-alert rule and the 10-07 phone notification cut; the Monday plan line (db/253) stays feed-only. Trigger point: a DB function called at the end of `content_plan_apply` plus a 15-minute pg_cron sweep for the "drafts finished" condition. Never fires on "nothing to plan" runs.

## 7. Oxygen styling (no new tokens)

`src/ds/tokens.css` §10 tokens only; ink is the accent, red only through `--ds-signal` (today, need-your-OK count); severity pairs for status; Geist with mono for times; radii chip 5, button 7, card 10, pane 14 (phone 18); motion curves and durations from the tokens, stagger 30ms capped at 400ms, `useMotionLevel()` for subtle/off, reduced motion = 0ms. New skin section `content.plan` in `src/ds/skin.ts`; legacy `--t1/--t2/--lime` usage in `plan.css` replaced; the stray evidence `ul` border fixed; old `.cn-client-switch` replaced by `Seg`.

Reuse: `Seg`, `SeatAv`, `Pill`, `Menu`, `.cv2-k` keys, `Sheet`, `useToast`, `Skeleton/Empty/Failed`, `Count`, `Reveal`. New small parts: `PlanHoverCard` (~60 lines positioning + timing, no Radix), `PlanDayGrid`, `PlanList`, `PlanPanel`, `planBrain.ts` (pure mapping, unit-tested).

## 8. Testing

- Unit: `planBrain.ts` mapping (labels, dedupe of tags, reliability words, failed vs failed-once), `contentPlan.test.ts` extended.
- SQL: rolled-back DO checks for db/259 shape on all three accounts; timing before/after.
- Browser (playwright, live session, writes blocked): 1280 / 390 / 430 census, zero text under 12px, zero taps under 44px, no overflow/overlap, hover opens at 500ms then 80ms, panel and sheet open/close, reduced motion, all three seats; `tools/thread-open.mjs` still passes.
- Alert: rolled-back test of the notify call shape; then one real feed-only test row marked as a test and removed.

## 9. Phases

1. db/259 data + the two fixes (no UI change).
2. Plan UI rebuild (Weeks, List, hover, panel, Move day) behind the existing tab.
3. New-plan alert.
Each phase ships alone, verified on the live app before the next.


## Revision 2 (12 Oct, after the brain audit and the adversarial review). Supersedes sections 3-6 where they differ.

### R2.1 Plan level
- Answer line counts from today, this week included: "8 posts wait for your OK", then one line "2 this week · 6 later · 4 scheduled · 1 failed". No duplicate figure.
- Brain strip, four tiles, per account:
  1. Rules the writer follows: live `brain_rules` with effect and post count (Ivan: no link -13%, fewer posts a week -9%, weekdays -6%, 50-word floor; Rise: no hashtags -25%; Arch: none proven yet).
  2. Being tested, not applied yet: shadow rules with effect (images +54% Rise, weekends -19% Rise, carousels +51% Ivan).
  3. Early reads: "9 of 9 checked on recent posts" (Ivan: "0 of 8, not confirmed yet").
  4. Last 90 days: typical views (Rise 253, Ivan 166, Arch 665) and breakouts (Rise 10 of 63).
  Test rows (`zz-selftest-*`) are filtered out.
- Warnings in plain words with a fix link: "No ideas left for posts that sell (3 in 8 weeks) · Add ideas"; "No lead magnet in the week of 26 Oct. Peer Scan is ready and waits for your launch".
- Week header: name, range, fill meter, n of target, and the week's mix ("3 from calls · 1 founder story · 1 lead magnet · 2 adapted from niche winners"). This is the week-level "why this week".
- Weekend columns appear only when a post sits there. "Open slot" only for real open slots; Arch's non-posting days stay blank.
- Planner run time shows only when the planner is late (no run in 26 hours).

### R2.2 Card face
Status word, time with zone ("07:00 PT", "10:45 Warsaw"), photo thumbnail when the post has one, title, the one-line reason when there is no thumbnail, and flags only for exceptions: lead magnet, boosted, founder story, carousel, failed (red), under the quality bar (amber, a post that went to Review below the pass line). "Check passed", audience and topic chips are removed from the face. History ("failed once, then passed") lives in the panel only.

### R2.3 Hover (desktop)
Why this post, the English call quote, why it should work (the niche trait the brain matched), the brain read in one sentence with its reliability, the quality check result, and for published posts the result vs the typical post.

### R2.4 Detail panel: the seven questions
1. Why this post: the pick reason (slot `why_now`, the brain pick reason with the source author's name and ratio, the series or lead magnet reason), the source, the English call quote.
2. Why this week: the slot reason when it differs from 1, else the week mix.
3. Why this day: real date and time with zone plus the weekday rule and its effect ("Weekdays only: weekend posts do 19% worse for Rise creators, still being tested"); a planned slot says "No day yet. It takes the first free weekday of its week when you approve it."
4. Why this angle: structure and opener in plain words with the structure reason ("A side-by-side comparison that opens with a number. His path vs the typical path, on hours, dollars, loans."), the matched niche trait, the borrowed shape.
5. Is it good: the full check story from `agent_log` ("First draft 60 of 80. Rewritten once: 63 of 80, passed (pass line 59)" or "55 of 80 after one rewrite, under the pass line. It went to Review anyway and was approved by hand"), claim check ("8 of 8 claims traced back to the call"), and the eight scores as small bars with the weakest one marked.
6. Will it work: "Posts proved with a result in numbers break out 1.2x less often than usual in Rise's niche (3.8% vs 4.5%, 902 posts)" on a scale from half as often to 2x as often with usual in the middle; reliability ("Checked on recent posts", "small sample", "Not confirmed on recent posts yet"); reads within 10% of usual say "about usual" with no scale; then "Helps it / Holds it back" (top recipe contributions, validated accounts only). "No early read yet" when missing.
7. How it did (published): views vs the typical post, reactions, comments, breakout flag.
Then the first lines, and keys: Read and approve (waiting), Open draft, Move day, or Open on LinkedIn (published).

### R2.5 Words
Every brain label is translated before display (topic, proof, angle, stakes, structure, opener, QA dimensions, recipe drivers). Buyer fit replaces ICP; "for new followers" replaces reach; "posts that sell" replaces demand. Call quotes show only in English; db/259 stores an English version of non-English quotes (one proxy call per idea, cached on `client_ideas`). The planner's own notes are never shown as quotes.

### R2.6 Data to add (db/259) and to start recording
Add to `content_plan_week` per item: the check story (first score, rewrite score, pass line, outcome, the eight scores), claim check counts, structure, opener and structure reason, the matched niche trait, the read (rate, usual, posts, reliability, small sample), recipe drivers (validated only), the brain pick reason with author name and ratio, thumbnail URL, time zone, English quote, published result vs median and breakout flag. Plan level: live and shadow rules, read reliability counts, median views, breakout count.
Start recording what is stored nowhere today:
- Planner: the full candidate list with ranks and the reason per skipped candidate (`content_plan_runs.outcome.candidates[]` and `skipped[]`), instead of a 200-character note.
- Ranker snapshot on the slot at pick time (rank, proof, pattern read).
- Ivan photo assigner reason (the model returns it, `ivan_photo_assign_v1` drops it).
- Ivan writer lane: the eight check scores, the structure and opener used, and an early read on every Review draft (Ivan's 3 waiting drafts have none today).
- Time choice and moves: who moved a post and why.
Rise photos are assigned in rotation with no reasoning, so the panel says "Mattan's photo, picked in rotation" until a reasoned assigner exists. The industry forecast stays hidden (no likelihood on any row).

### R2.7 Findings from the audit that need Ivan to know
- Rise posts going out under the quality bar: "Elemental Air" (Tue 13 Oct) and "What does storage cost you per order?" (Wed 14 Oct, 57 of 80 after a rewrite) went to Review below the pass line and are scheduled. "If a channel can't grow..." (Fri 23 Oct, 55 of 80) waits for approval below the bar.
- The planner picked Rise ideas the brain's recipe rates negative; the plan gives no warning about it today.
- A brain self-test rule (`zz-selftest-20261012T122939Z`) is still in `brain_rules` as shadow; it is filtered from the UI and left in place (content-system data is not deleted without Ivan).
