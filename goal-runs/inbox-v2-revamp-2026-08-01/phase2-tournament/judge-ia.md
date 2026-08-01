# Judge Seat 3 — IA scalability

## Calibration: ranking the three PRIOR candidate shells

Read `src/exp/cand-a/Shell.tsx`, `cand-b/Shell.tsx`, `cand-c/Shell.tsx` directly (not the briefs).

1. **cand-b (Studio hub)** — best pure scalability. A new surface is a row in `StudioScreen`'s scroll or an internal push state (`Shell.tsx:163-167` lifts `studioPushed` just to hide the mobile bar), costing zero tab-bar slots. Structural ceiling: none. Semantic ceiling: real (junk-drawer risk), but that is a craft cost, not a growth-capacity one.
2. **cand-c (segmented, zero new tabs)** — also zero tab-bar cost, but the growth device (a segmented control) only fits surfaces that read as "alternate views of the same job." It also couples a second layout axis to segment state: `isDtFull = tab === 'sends' || tab === 'ops' || tab === 'today' || (tab === 'drafts' && workSeg !== 'dms')` (`Shell.tsx:139-140`) — one more branch to keep in sync per future segment.
3. **cand-a (new Content tab, Settings demoted)** — worst. Already spent its one free tab on Content (`Shell.tsx:34`); the next surface has no slot left and must demote something else — a linear, one-casualty-per-surface cost with no signal for which surface loses next.

This ranking is defensible and matches the independent phase1 IA audit's own reasoning (`phase1-audit/ia-and-chat-port.md` §1.1), derived here from the code, not the prose.

## The new candidates

**Surface 9/10.** v2c's desktop rail is explicitly unbounded (`Rail.tsx:6-11`, "seven jobs plus Claude fit without crowding") — a second client board or reports view is one more `JOBS` row, structurally free. But v2c's *mobile* bar is already full at 6 slots (`Rail.tsx:94-100`) and has no answer but to repeat cand-c's segmented-control device. v2b's Home cockpit absorbs growth as a numbered zone + `HandOff` queue (`Cockpit.tsx:230-246`, "one pending item, one owning zone") without ever spending a tab-bar slot on any viewport — the strongest answer to this question of the three. v2a has exactly one freed tab slot (`TabBar.tsx:11-13`, "freed slot is deliberately NOT refilled"); surface 9 fits, surface 10 forces cand-a's exact demotion bind or a segment bolt-on repeating cand-c's mismatch — v2a's growth model runs out first.

**The duplicated fork.** All three genuinely extracted their own layout branch into one tested pure function — v2a `lib/shellLayout.ts` `paneFor`/`chatLayoutFor` + `AppFrame.tsx` (12 tests, measured via `npx vitest run`, not the brief's claimed 26); v2c `exp/v2c/layout.ts` `planWorkbench` (17 tests measured in `layout.test.ts`, the most general of the three — models canvas/peers/capacity, not just desktop-vs-mobile); v2b `exp/v2b/layout.ts` `layoutFor` (thin, one ternary, fit-for-purpose for its 4-destination nav). **None of the three touched the pre-existing 4 duplicated copies** — `App.tsx` and `cand-a/Shell.tsx` are byte-identical to main in the v2c worktree, and v2a/v2b's `App.tsx` diffs are unrelated ghost-pane/error-prop fixes, not fork removal (confirmed by diff across all three worktrees). All three leave the same 4 pre-existing duplicates for the winner-apply step, plus one new non-duplicating utility each — this criterion doesn't separate them.

**Content grouping.** All three render `groupByStage` (lifecycle) as Content's primary board and keep `bucketDrafts` as the triage engine elsewhere (badges, Drafts' queue-card actions) — confirmed by code comments citing `content.ts:264-277` in `v2a/ContentPipeline.tsx:18`, `v2b/Content.tsx:16`, `v2c/ContentList.tsx:17`. No candidate renders both as competing boards on one screen. Tied, all compliant.

**Mobile vs desktop coherence.** v2a wins cleanly: `AppFrame.tsx` is one component consumed identically at both widths, zero divergence. v2b is consistent too — `Cockpit` renders the same zones responsively, no split model. **v2c fails this test on Content specifically**: desktop's rail gives Content its own full row, a peer of Inbox and Drafts (`Rail.tsx:58`), while mobile folds Content into a shared "Work" segment under Drafts (`Rail.tsx:94-100,109`, `Shell.tsx:372-380`) — two different mental models for the same job depending on viewport, the exact kind of gap this seat exists to catch.

**Cost of being wrong on Chat.** v2a is cheapest either direction: Chat is a true top-level sibling (`Shell.tsx:44`, `view: 'app'|'chat'`), delete `ShellBar`'s toggle + `ChatSurface` + `useChat` and the app half is untouched; promoting it to primary is a one-line default change. v2c is next: Chat is one variant of a generic `Peer` union (`layout.ts:23-29`), already docked open by default on desktop (`Shell.tsx:96`) — moderate cost to remove, near-zero to promote. v2b is costliest: the candidate's entire thesis is "Claude is never a destination" (`Shell.tsx:34-36`) — reversing that contradicts the architecture's premise, not just a config flag.

## Ranking

1. **v2c "workbench"** — best surface-9/10 growth on desktop (unbounded rail) and the most general, most rigorously tested fork extraction (17 tests, models canvas+peers, not just a viewport ternary). Loses points for a real, uncorrected mobile/desktop coherence gap on Content.
2. **v2b "cockpit + command bar"** — the single strongest growth mechanism of all six candidates examined (zone + `HandOff`, spends zero nav real estate ever, no viewport divergence), but the costliest to reverse if Chat's role changes, and its own fork extraction is the thinnest.
3. **v2a "chat as shell"** — the cleanest code and cheapest Chat reversal, but the weakest actual growth capacity: one freed tab slot, then the same demotion-or-mismatch bind the calibration controls already failed on.

## Strongest graft
v2b's `HandOff` pattern (`Cockpit.tsx:230-246`) — "one pending item, one owning zone, no mutating affordance" — is the cleanest fix for the U1-class hazard (a draft with three different action affordances across screens) and the most reusable growth primitive of the six candidates studied. Worth grafting onto whichever wins.

## Must-fix defect
v2c's Content job renders as a full peer of Inbox/Drafts on desktop (`Rail.tsx:58`) but as a subordinate segment of Drafts on mobile (`Rail.tsx:94-100`) — two incompatible mental models for the same job. Must be resolved (either give Content its own mobile tab or make desktop segment it too) before this candidate ships as the winner.
