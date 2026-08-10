# Director-seat notes — orchestrator's own look at the pixels

Gate-trust rule 3: verification consumes the rendered artifact, never a description of it. Judges score dimensions; the arbiter still has to look. I opened two decisive 1440px frames, one per finished candidate, before reading any judge ballot. Candidate v2b was still building when these were written.

## v2c — `peers-draft-chat-desktop.png`

Four regions, all carrying content: 200px rail (Today · Inbox 56 · Drafts · Content 11 · Sends · Ops, rule, **Claude** with a live dot and the label "Docked beside your work", Settings, foot showing "just now" + refresh) → Content working list → draft-detail peer → Claude peer.

What works, specifically:
- **The dead canvas is gone.** The audit measured desktop Inbox spending ~66% of 1440px on a glyph and the words "Select a conversation". Here every column does work, because the default peer is Claude rather than a placeholder. That is a structural answer to the finding, not a cosmetic one.
- **The attachment is real.** The Claude peer carries an `ASKING ABOUT <draft title>` chip and the composer reads "Ask about The agency that could…". The pane-peer premise (talk to Claude about the thing you are looking at) is delivered, not gestured at.
- **It tells the truth about the upstream limitation.** In-surface copy: "Every turn starts a fresh Claude session — the transcript above is the continuity, not the model's memory." That is finding I1 (`/chat/stream` never passes `--resume`) surfaced to the operator instead of hidden. Rare and correct.
- Canon held: `#10A37F` on Approve and Claude, red for the `2 errored` strip, amber for `QA_BLOCKED` and the needs-review dot, glyph icons, system font, no monospace. The `MOCK` badge is visible and honest about the stub.
- Good number treatment: a proportion bar reading `11 needs review · 2 scheduled · 109 published` over `11 waiting on you / of 122 in flight`. The brief's reasoning is sound — 109 published against 13 in flight is a true number and a useless picture.

Weakness: the Claude peer's lower two-thirds is empty in the no-session state. Defensible as an empty state, and the three suggested questions occupy the top, but it is the one region not pulling its weight.

## v2a — `chat-dock-desktop.png`

ShellBar `[◉ Inbox | ✳ Chat]` + gear, icon rail, inbox list with chips and a `56 unread · 0 drafted · 1138 threads` strip, then a middle conversation pane, then the 440px Claude dock.

What works, specifically:
- **The chat surface itself is the better of the two.** Tool calls render as real cards (`RUN gh run list --workflow deploy.yml --limit 5`, `SEARCH src/lib`), and the turn carries a cost-and-latency line (`3.4s · $0.0091`). Neither candidate was asked for telemetry; A shipped it and it is exactly what a Claude Code surface should show.
- The answer models good judgment in the mock content: "Nothing broke - the lane is **throttled, not stalled**", then the governor at 103/100, 85 still sendable, no new `send_blocked_reason`. It also closes by naming the honest signal ("the amber dot on Sends"), which matches this app's severity language.
- `Hands-free` is present as a labelled affordance under the composer, so voice reads as a first-class mode.

Weakness, and it is the decisive one: **in the docked state the middle pane still reads "Select a conversation" with the ✦ glyph**, so roughly a third of the canvas idles while chat is compressed to 440px. This is not the A1 ghost-pane defect (Inbox genuinely can hold a conversation, so the copy is contextually correct, and A did kill the wrong-context case structurally). It is the softer version: A kept a placeholder where C replaced it with work. On the audit's specific complaint about wasted desktop canvas, C answers it and A partially inherits it.

## Provisional arbitration, to be tested against the judges

Structure: **v2c**. It uses the desktop canvas, it makes the attachment real, and its rail scales to a 9th surface without another restructure.
Graft from **v2a**: the chat internals wholesale — tool-call cards, the cost/latency line, the hands-free labelling, and A's `shellLayout.ts` naming if it reads better than C's `planWorkbench`.

Held open until the panel and the independent measurement report, and in any case the ballot ships both so Ivan decides. Recorded now because context degrades and this judgment should not be re-derived later from memory.

## v2b — `home-desktop.png` (added after v2b finished)

Masthead `23` / `THINGS NEED YOU` over a stacked bar segmented `3 urgent · 7 to approve · 13 content · 0 ops`, freshness `02:29 · now · live` with a refresh affordance. Then three columns: `01 WAITING ON YOU` (rows with per-row wait-age bars, amber as they age), `02 APPROVALS`, `03 CONTENT` (amber "stuck or errored - past their time with nothing published", stage rail, `109 published in the last 60 days`), `04 CAMPAIGN HEALTH` (`0` replies today, `29%` accept, `99/100` governor with gauge, then per-lane bars against cap), `05 OPS`.

What works, specifically:
- **The headline number cannot lie.** `23` is defined as the sum of the four zone loads and the stacked bar shows those same four counts. An aggregating home's central failure mode is a summary that drifts from its parts; this makes drift structurally impossible.
- **It answers empty-vs-broken in copy, not just in state.** Ops reads "Nothing waiting on you - and this is a live read, not a stall." That is the U3 ambiguity solved in language an operator actually trusts, and it is the best single line of copy any candidate produced.
- **The single-source-of-truth rule is visible on the surface.** Approvals rows carry their real owner: "posting is live on LinkedIn - approved in Ops" and "approved in the feed lane, not here". A cockpit that aggregates has to tell you where a thing truly lives, and this one does it inline.
- Zone numbering `01`-`05` with rule and count preserves Today's zone-header pattern (a must-not-lose decision) rather than replacing it.
- Density is real: wait-age bars, stage rail, governor gauge, lane bars against cap. Severity stays 3-tier plus the existing taxonomy blue.
- The command bar reads `Ask Claude about Home` and names the surface it was invoked from, so context is stated rather than assumed.

Weakness: the left and middle columns end well above the right one, leaving roughly 300px of black under Approvals and under Content. The brief's claim that the shortest column carries Health+Ops and is "never short" holds for the right column but not for the other two, so the two-column stranding the audit found on live Today is reduced here rather than eliminated.

## Revised provisional read, three strong candidates

No candidate is weak, and each wins a different thing: **v2b** the home surface and the honest-copy discipline, **v2c** the desktop structure and the ask-about-this-item attachment, **v2a** the chat internals (tool-call cards, cost/latency line). A synthesis is the genuinely best product, and also the exact shape of the "round N+1 came out worse" trap, so it is not attempted in this session. Winner plus named grafts goes to the ballot and Ivan decides.

## Confirmed defect, v2c `ops-desktop.png` (orchestrator verified the craft seat's claim)

I opened the crop rather than taking the judge's word. The claim holds and it is a functional bug, not a matter of taste:

- The title `Ops` renders **twice**, once from the workbench wrapper and once from the wrapped `OpsScreen`'s own nav, the second carrying the `IM` avatar.
- The empty-state line `Nothing waiting on you.` also renders **twice**; the first instance has its full supporting copy ("Comment replies, newsjacks, weekly reports and escalations all clear.") and the `Checked just now` freshness pill, the second is bare.
- The collapsed `DONE · 2` and `BLOCKED · 3` rows sit flush against the left column boundary and read as clipped, unlike every other row in the candidate.
- Below that, roughly 600px of dead black.

Cause is structural and cheap to fix: v2c mounts the existing `OpsScreen` inside its own titled region without suppressing that screen's internal header. The earlier tournament already hit this exact problem and solved it with a scoped `.oh-hide-nav .nav{display:none}` in `src/exp/cand-a/styles.css:126`. Any candidate that wraps a production screen inherits this hazard, so the winner-apply step must audit **every** wrapped screen for a doubled header, not just Ops.

Also confirmed: Ops at 1440px is genuinely unsolved by all three candidates. C shows the doubled render, B regresses it to near-total dead black, A leaves it close to the baseline's under-built state. The craft seat named this as the must-fix regardless of winner and I agree; it belongs in the winner's diff with a real design, not a wrapper tweak.
