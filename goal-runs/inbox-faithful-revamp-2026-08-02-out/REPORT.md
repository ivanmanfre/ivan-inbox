# inbox-faithful-revamp-2026-08-02 — final report

Executed 2026-08-02, same day as the vote. Branch `exp/vis-faithful`, 19 new commits on top of the
parity state `2b8554a`; `main` untouched; :5431 serves the final commit. Mid-run the account session
limit killed four agents — the recovery discipline (commit early, read on-disk state, finish in the main
loop) carried Phases 3-6; every number below was still measured, never assumed.

## Ivan's complaints, before → after

| complaint (verbatim) | before (measured) | after (measured) |
|---|---|---|
| "super mess with the sources and tag search... wtf is this" | 18 facet groups / 105 always-on chips; 1,068px of filter wall; first draft row at y=1439 → **0 rows in the first screen**; at 390 the wall was 152% of the viewport; nothing persisted | Search + `label: value ⌄` pills with counts in panels; demoted facets behind one `Filters ⌄`; **168px total**, first row **y=797**, rows in first screen; 390 = 76px chrome + real bottom sheets (44px rows); filter + search **persist per section** (allowlisted, versioned localStorage). Independently re-measured: phase1-review.md |
| "in today i see old stuff... the approve dm draft is old asf" | The shown draft was a **superseded orphan** (a later message to that prospect sent 07-30); 3 more drafts 13-16d old with no age signal; root = no supersession/age logic in `get-morning-brief`'s two approval queues | Orphan **gone** (supersession drop, strictly-later rule); still-owed drafts stay and say so: "3 waiting · oldest drafted 15d ago · **3 owed >7d**"; arrays oldest-first server-side. Edge fn `ivan-listener` `68ba5ce`, client `3b02365`, verified by independent probe |
| "with errors" | 2 console errors + 1 failed request per chat send (broker CORS hardcoded to prod origin) | **0 console errors on all 7 routes × 2 viewports** including full send + interaction passes (census + live turn both measured 0) |
| "lack of hover, animations" | 10 classes no hover, `.chip` not even `cursor:pointer`; **0 of 17 custom controls keyboard-reachable**; the one licensed beat was dead code; 2 loops on a second easing | Real `<button>`s everywhere (70 on Content), §7.4 hover + press on all, focus ring reaches everything; **the approve beat plays** (row lifts, count ticks, refetch on movement-end); loops on the one easing |
| "proper readability" | Legend clipped to "PUBLIS" on every state; titles crushed to ~20ch; 111-180ch unbroken lines; `#null` labels; quotes indistinguishable from captions | Axis short-codes + 460px chart; crush-only 2-line wrap (container query — the unconditional version broke the density band and the census caught it); 72ch measure; engine-label fallback; quote-rule + clamps. §3.5 token misuse was already clean and stayed clean |
| "the claude tab doesnt even work" | FOUR stacked breakages: Railway `--verbose` missing since Feb (returncode 1), broker unarmed, dev origin CORS-blocked, and a client that had never parsed a real stream (StrictMode alive-flag bug + wrong assistant-frame shape) | **A real turn completes in the pane in 7s** ("PANE OK" rendered, `claude_usage_sessions` telemetry row written). Railway fix = ONE token (`3ea8208`), rollback recorded; broker armed server-side; `/model` `/retry` `/stop` `/clear` all work (token-wise matching — "/model haiku" used to fall through as a literal send); step-captures in phase4-shots/ |
| "the voice part its not there" | Browser API measured 38.6% WER — mic hidden by standing decision | **Server-side rebuild passed its gate decisively: WER 1.11% (bar 15), p50 957ms (bar 2s)** — ElevenLabs scribe_v2 + keyterm biasing behind new edge fn `inbox-stt` (key never in the bundle). Push-to-talk mic back in the composer; silence → "Didn't catch that.", never a blank insert; $0.90/mo at 50 utt/day. The OpenAI alternate echoed its vocabulary prompt as speech on silence — disqualified on that hazard, guard documented |
| "i havent even tested mobile i hope its perfect" | Only exit from takeovers = 6×20px; log chips started at x=−5.6px; Approve 48×28; content buried under 2.2 screens of chrome | 44px back button + padded targets; chips clip in-column; ≥44px review buttons; the wall kill freed the viewport. Zero horizontal overflow all routes (was already true, stayed true) |
| LM `live` semantics ("solvable by seeing the old content panel") | Unfolded, rendered as its own phantom status | **Verdict (code-grounded; the live panel is OTP-gated — memory's "ungated" note is stale): `live` = the LM's own landing page is live on the web, same tier as `published`, NOT a LinkedIn-posted signal.** Folded accordingly in the LM lane, raw value auditable on the chip title |

## Decisions locked this run

Triad is the boot default (mono reachable via `?cat=mono`, undocumented). Triad's own `--cat-4` =
`#6C716F` (white ink 4.97:1; the published mono hexes untouched). `/clear` ships on `useChat.reset()`.
The filtered-render rule: an active stage filter opens its own section (156 cards both sides of a
reload; was 4 vs 47).

## Verification (phase6-instrument/, all measured on the final commit)

- Censuses, 6 routes × 2 viewports: ≤7 font sizes, 0 fractional, ≤1 weight ≥700, accent ≤27 (cap 30),
  **contrast fails 0 everywhere** (including the two wb-cap badges, now green in triad), overflow 0,
  console errors 0, tabular-nums clean, `data-cat=triad` everywhere.
- Rail variance **0** (Content 66 rows, Inbox 15) at both widths; density 40-60 content-box at 1440
  (direct histogram 40/46/60), ≤72 at 390.
- `npm test` **421/421** (27 new this run) · `npm run build` clean · lint: no new warnings ·
  `tsc --noEmit` clean.
- `dist/` secret sweep: the anon-role JWT only.
- Stock app: all 6 routes × 2 viewports, 0 errors, 0 overflow, converted controls render identically
  (screenshot-verified).
- The census caught TWO of my own fixes over-reaching (td-qown at text4 = 4.15:1; unconditional title
  clamp = 61px rows) — both corrected and re-measured. The instrument earns its keep against the
  orchestrator too.

## External changes (with rollbacks)

| system | change | rollback |
|---|---|---|
| Railway claude-code (multi-client, T3) | `main.py` +1 line `--verbose` (`3ea8208`) | `git revert --no-edit 3ea8208 && git push origin main` |
| Supabase edge fn secrets | `RAILWAY_CLAUDE_API_KEY` set (existing key, server-side copy); `OPENAI_API_KEY` set (existing key, for STT alternates) | `supabase secrets unset <name>` |
| `inbox-claude` fn | CORS + `http://localhost:5431` (`25abe31`), deployed | redeploy prior commit |
| `inbox-stt` fn | NEW, deployed (scribe_v2 + keyterms) | `supabase functions delete inbox-stt` |
| `get-morning-brief` fn (`ivan-listener` repo) | supersession + aging stamps (`68ba5ce`), deployed | revert + redeploy |

⚠ Standing cost flag: every pane turn writes a ~62k-token cache (~$1.17) it never reads — the measured
`--resume` fix from the 08-01 run is now live per-turn economics and deserves its own decision.

## Open / residual

- The comment-drafts backlog Today now surfaces honestly (6 targets, oldest 35d) is a real ops queue,
  not a rendering bug.
- Calendar view and performance-based pillar analytics: still absent, still a deliberate
  build-vs-park call for another day (parity map Part C).
- The old browser-API voice stack is still in the tree, unmounted (deletion left for a cleanup pass).
- `_scout-*/_orch-*/_rev1-*` scripts in `scripts/` are untracked probe tooling — cleaned before handoff.

## Where everything is

Phase files: phase0-triage.md (+6 scout files) · phase1-filters.md + phase1-review.md · phase2-today.md
· phase3-polish.md · phase4-claude.md · phase5-voice.md · this file. Shots: phase0-shots/,
phase1-shots/, phase4-shots/, phase5-shots/, phase6-instrument/. Every number traces to a file here.

---

## Blind seats (phase6-blind/), fix loops, and what stays open

Three fresh agents judged the build cold — zero build context, pixels only. Verdicts + all screenshots
in `phase6-blind/`.

**Row-find (§7.9).** First run FAILED both widths — my brief's fault: it set "a failing-QA row in
review" as the target and the live data has none (12 PASS / 7 ungraded, 0 fails — the amber fail path
exists in code and unit tests but no live row exercises it today). The run still surfaced a real defect:
the PASS chip's outline used `--cat-2`, which the triad default had turned BLUE against the green corner
dot — a status wearing a categorical token. Fixed to severity green (`b86b607`). **Re-run with an
existing target ("a draft QA has not judged yet"): PASS 1440 / PASS 390**, "well under 3 seconds, no
title-reading required", and the judge's zoomed crop confirms dot + chip now share one green.

**Cold screenshot seat.** "NOT clean enough" on 5 items → fix loop 1 (`b86b607`): zero-capsules now
print their 0 (they read as "unrendered"), section headers shift background on hover, the ClickUp-era
alert caption stops wearing warn styling it then disclaims. Left as data/report items: the QA card that
says PASS 79/100 above a body reading "Fact Check: FAIL" — that contradiction is IN the engine's stored
verdict vs its own notes (the known "LLM judges can't catch engine output" class; the UI renders both
honestly); and the Drafts-row → Ops navigation, which is the existing "feed drafts are approved in Ops"
routing — real, but a behaviour decision, not a defect this run invented.

**Mobile polish seat.** FAIL on 5 → fix loop 2 (`c7474fa`): the filter pill row now wears a right-edge
fade (measured live: the builder's claimed fade had never rendered — mask was `none`), Ops textareas
stop cutting a line mid-glyph (5 full lines minimum), Inbox names hold one line so row rhythm survives
"Muhammad Huzaifa". The 6×20px back-button finding was **already closed** by `1b07a38` — re-measured
live at 44×44; the judge's long sweep predated the hot reload. Left open, named honestly: the takeover
still hides the tab bar (the 44px back is the sole exit — a taste call to revisit if Ivan trips on it),
Sends stat-tile headers truncate to "ACC…/GOV…/RUN…" at 390, and the Drafts-row teleport above.

**Final state:** `exp/vis-faithful` @ `c7474fa` (19 commits this run), tree clean, :5431 serving it,
tests 421/421, censuses green on the final commit, zero console errors. The two fix loops per gate are
spent; everything else lands here as residuals with owners' reasons attached.
