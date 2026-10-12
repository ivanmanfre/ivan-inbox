# Content > Plan tab: Oxygen redesign with content brain data

Date: 2026-10-12. Status: design, waiting for Ivan's approval. Mockup (real data, interactive):
`/Users/ivanmanfredi/Desktop/Ivan - Content System/research/plan-section-2026-10-11/plan-oxygen-mockup-2026-10-12.html`

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
