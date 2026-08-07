# Judge Seat 1 — Ergonomics — inbox-v2-revamp-2026-08-01

Scope: fewer taps, fewer wrong moves. Not craft, not IA-scalability (other seats). All claims cite a crop filename; where a candidate's own brief claims something I could not find a matching PNG for, I say so explicitly and discount it.

## Calibration (mandatory)

- `baseline/sends-mobile.png` / `sends-desktop.png`: dense but legibly organized — three severity-dotted decision tiles (Accept/Governor/Runway), one funnel bar, sparkline volume tiles. This is the known-good composition and I place it at the top of the app's own range — busy but never ambiguous about what needs attention. Confirms it as "known good."
- `baseline/ops-mobile.png`: "Nothing waiting on you." + Done·2 / Blocked·3, ~20 words. This is a real, correctly-minimal empty state for a genuinely empty queue — I am **not** calling it well-composed for a *working* queue (it carries no freshness signal, which is exactly the aesthetics audit's A5 finding); I am placing it correctly as the empty-state control, not rewarding its sparseness as good density.

Calibration holds: Sends ranks as the density ceiling worth keeping, empty Ops ranks as a legitimate-but-thin floor. Ballot is valid.

## 1. Taps per daily job, cold open, 390px

**Job A — triage, draft exists.** All three keep `ThreadScreen`'s row→approve→confirm flow untouched, so the in-thread cost is identical (3 taps) everywhere; the only variable is what's on screen at cold open. v2a and v2c both keep Inbox as the default landing tab (`crops/v2a/inbox-mobile.png`, `crops/v2c/inbox-mobile.png` both show Inbox active with no prior navigation implied) → **3 taps**, unchanged from baseline. v2b moves the default tab to Home (`crops/v2b/home-mobile.png`, brief §"What I made primary"); reaching the *full* thread list costs one more tap (Inbox tab, 1) than v2a/v2c → **4 taps** for a browse-everything triage. But v2b's Home zone 01 "Waiting on you" already surfaces the subset of threads that actually need a reply, one tap from cold open into the thread (`crops/v2b/home-mobile.png` rows are tappable, per `crops/v2b/thread-mobile.png`'s reachable state) → **3 taps** for the "what needs me" version of the same job, pre-filtered instead of scrolled.

**Job B — review/approve drafts.** DM-draft approve is 3 taps in all three (Drafts/Work tab → approve → confirm). The audit's U11 finding (Ops draft reached via Drafts costs a 4th tap because the badge blends two queues) is structurally addressed differently: v2b's Home explicitly splits the count into labelled rows ("6 Comment drafts" / "1 Feed drafts", `crops/v2b/home-mobile.png`) so the extra hop is expected, not a surprise; v2c's rail keeps Content and Ops as their own always-counted destinations (`crops/v2c/inbox-mobile.png` tab bar: Inbox 56 / Work 11 / Ops, each own badge) so the split is visible before the tap. v2a folds Content into Drafts as a second segment but Ops stays a fully separate, uncross-referenced tab (`crops/v2a/drafts-mobile.png`) — the U11 hop is unlabelled exactly as in the baseline.

**Job C — monitor sends + ops ("is anything stuck").** This is the sharpest split. v2a: Sends and Ops remain two unconnected tabs, **2 taps**, no cross-link, unchanged from baseline (confirmed absent in `crops/v2a/ops-mobile.png` and `sends-mobile.png` — neither mentions the other). v2c: same structure, rail items instead of tab items, still **2 clicks**, no aggregation (`crops/v2c/ops-mobile.png`, `sends-mobile.png` — separate surfaces). v2b: Campaign Health (zone 04) and Ops (zone 05) render on the **same Home screen**, confirmed simultaneously visible in `crops/v2b/home-desktop.png` — **0 taps**, one scroll. This is a direct, pixel-confirmed fix of the exact Job C gap `usability.md` names ("nothing on either screen tells the operator the other exists").

## 2. Single home for a pending item

v2b's claim is the one I can verify in pixels, not just prose: `crops/v2b/home-mobile.png` labels "Feed drafts … *approved in the feed lane, not here*" — the UI itself tells the operator this row is a pointer, not an action, which is a direct answer to U10 (Ops-teaser rows reading as actionable when they aren't). v2a and v2c both keep the same segmented-tab pattern for Drafts/Content (`crops/v2a/drafts-mobile.png` vs `crops/v2c/drafts-mobile.png` are nearly structurally identical: two pill tabs, one list) with no equivalent "not here" language visible in the crops — functional, not distinguished.

## 3. Are loading/empty/failed actually distinguishable on screen?

v2c is the only candidate with dedicated screenshots proving this: `crops/v2c/state-failed-inbox-mobile.png` shows a red banner, the literal error ("PostgREST returned 500 for inbox_messages_v"), a Retry button, dimmed stale rows underneath, and a "not syncing" red-dot header — unambiguous at a glance, and it exists for inbox/ops/content at both widths (6 dedicated shots). v2a's fetch-failed state is real but only independently forced via network intercept per `MEASURED.md` (not a screenshot in `crops/v2a/`) — I'm crediting it as instrument-confirmed, not pixel-inspected by me. v2b has no dedicated inbox/ops/content fetch-fail screenshot in `crops/v2b/` at all; the only failed-state pixels I could open are `crops/v2b/chat-error-mobile.png` (a clear, well-composed error), which does not stand in for the inbox/ops claim in its brief. Per the judge-spec instruction to score off pixels, v2c wins this sub-criterion decisively on evidence, v2a is credible-but-unshown, v2b is the weakest-evidenced of the three here despite a plausible prose claim.

## 4. Claude + voice reachability

All three: 1 gesture from anywhere. The difference is whether the surface you left survives. v2b's command bar is a bottom sheet that only partially covers the surface (`crops/v2b/chat-voice-mobile.png` — Home's zone 01 rows are still visible above the sheet), so it is the only candidate where the mobile surface stays literally on screen while asking. v2c wins on desktop specifically: `crops/v2c/peers-thread-chat-desktop.png` shows rail + list + thread + Claude, four regions, simultaneously legible, with an explicit "ASKING ABOUT Alyce Moussa" pairing card — the strongest reachability-without-losing-context result of the three, but on mobile it is a full takeover softened only by a context chip (same underlying cost as v2a). v2a's chat is a full sibling: mobile takeover (surface lost), desktop dock is good but starts in "focus" and needs an explicit tap to reach dock. Voice state legibility is a three-way tie at a high bar — `crops/v2a/chat-voice-mobile.png`, `crops/v2b/chat-voice-mobile.png`, `crops/v2c/voice-listening-mobile.png` all render an explicit "Listening" label plus a live waveform, not a spinner.

## 5. Wrong-action risk

U4 (freehand compose, no confirm) is untouched by all three — tied, and the single worst defect regardless of winner. U1 (stale-approve reviving a discarded draft) is different: v2b's brief states an actual DB-level guard (`approveDraft` now requires `.is('send_blocked_reason', null)`) — a real fix, not just a UI convention, and the only one of the three that touches this landmine at all. v2a and v2c both explicitly left U1 unfixed. I cannot screenshot a guard clause, so this is a code-level claim, but it is the one substantive difference in outbound-send safety between the three candidates.

## Ranking

**1. v2b "cockpit + command bar."** Wins the one Job-C tap count that matters most to the daily "is anything stuck" ritual (0 taps vs 2, `crops/v2b/home-desktop.png`), is the only candidate with visible "not here" single-ownership language (`crops/v2b/home-mobile.png`), the only one whose command bar doesn't fully hide the surface on mobile, and the only one that touches the U1 send-safety landmine. Its cost is the weakest visual evidence for the inbox/ops/content failed-state (§3) and one extra tap to browse the raw, unfiltered inbox.

**2. v2c "workbench."** Best-proven data-state legibility of the three, by far (6 dedicated failed-state crops), and the strongest desktop Claude-reachability result (`peers-thread-chat-desktop.png` keeps the item, the thread, and Claude on screen together with a named pairing). Loses to v2b on Job C (no aggregation, still 2 taps) and carries the same unfixed U1 gap as v2a.

**3. v2a "chat as shell."** A clean, low-risk restructure that preserves baseline tap counts and gives desktop a genuine dock mode, but it is the candidate that moves the fewest of the audit's actual ergonomics needles: Job C is unchanged (2 unconnected taps), U1 is unfixed, U11's ambiguity is unaddressed, and its failed-state proof rests on an off-brief instrument run rather than its own screenshots.

## Graft

Take v2b's Home zone 01/02 pattern — pre-filtered "waiting on you" rows plus explicit "approved elsewhere, not here" labelling — and graft it onto v2c's rail-and-peer shell: v2c already has the best context-preserving surface (`peers-thread-chat-desktop.png`); pairing it with v2b's "one line, no ambiguity about ownership" copy would fix v2c's only real single-source-of-truth gap without touching its stronger IA.

## Must-fix

U4 — freehand `composeReply` still sends with zero confirmation in all three candidates, on the single riskiest, least-reviewed action in the whole outbound surface. Whoever wins, this ships broken unless it's pulled into the winner-apply diff explicitly, since none of the three tournament candidates treated it as in scope.
