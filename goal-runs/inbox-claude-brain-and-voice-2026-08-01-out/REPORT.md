# REPORT — inbox-claude-brain-and-voice-2026-08-01

Run executed 2026-08-01. Branch **`exp/brain`** off `exp/v2`, 9 commits, nothing pushed, `main` untouched at `7c9ea96` (origin/main at `f339290`, never moved). Three design candidates on `exp/brain-2b-{paper,inkline,instrument}`. One Railway commit `82e4ab1` in `claude-code-railway`. Ballot: `BALLOT.html`.

---

## The headline

Four things were asked for. Three are built, verified and live behind their gates; the fourth ends at your ballot, as designed.

But the finding that outranks all four: **`/chat/stream` has been dead for every client of the Railway service since 2026-02-24.** It builds `claude -p --output-format stream-json` without `--verbose`, and the CLI refuses. It returns `{"type":"done","returncode":1}` and nothing else — on model A, on model B, and on the no-model default, which is what proves it predates this run's change. It is the broker's only transport. **So the inbox Claude surface could never have completed a turn, even if you had armed it.** The arming gap everyone was waiting on was hiding a hard failure behind it. The fix is one token; it is written, tested and deliberately NOT applied, because the grant said the model passthrough and nothing else on that service. It is decision 3 on the ballot.

---

## Two-column definition of done

| DoD row | Verdict + evidence |
|---|---|
| Phase 0 inventory lists every surface with its Phase 5 row filled | **PASS** — `phase0-scope.md` §4, S1-S12, each with its verification row; §2 records 7 corrections where live state contradicted the briefing (`claude_memory` is 1883 rows not ~400; `lm_drafts_v2` 127 not 121; `content.ts` UI consumes 19 not 11; `structure_used`/`image_style` are not columns at all) |
| Parity mapping covers every injector block with an inject/adapt/drop decision + reason | **PASS** — `phase1-parity/PARITY-SPEC.md` §5: **16 blocks, 1 verbatim / 11 adapt / 4 drop**, each with its container-side source, freshness and measured size; §6 states what parity cannot include and why |
| A real turn's injected context captured and shown to contain the parity blocks | **BLOCKED** — by the `/chat/stream` P0 above. The assembled payload itself is captured and measured (35,949-35,971 chars, ~17,100 tokens, all blocks present with headers), and both candidates' harnesses render it, but no turn can traverse the deployed transport. Unblocks the moment ballot decision 3 lands |
| Cross-tenant proof: no other client's memory row can enter Ivan's context | **PASS** — `phase5-verify-part1.md`: all three tier queries run live, every returned `client_id` inside {ivan, global, shared-tech}; plus both adversarial controls reproduced — the unpinned `file_path` query returns `ivan` AND `proswppp` (the pin is load-bearing), and one `in.()` page silently drops all 29 `shared-tech` rows at the 1000-row server cap; `claude-brain-query` shown leaking unscoped and clean scoped |
| Injection-safety: skeptic's crafted row failed to act as an instruction, transcript included | **PASS** — `phase1-parity/SKEPTIC-INJECTION.md`: **27 real `claude -p --append-system-prompt` turns, 0 behavioural defeats**, full transcripts in §11. Also **0 over-refusals** — the model still applied Ivan's genuine imperative rules without hedging, which was the case worth being wrong about |
| On-demand depth proven by a real turn that reaches memory/brain and cites it | **BLOCKED** — same P0. The depth block ships (`depth-block.ts`, 5 recipes, allowlist baked into every URL, graph modes named unsafe), and the recipes were contract-verified live against the deployed `claude-brain-query`, but no turn can run |
| Per-turn cost stated as a token count and a dollar figure | **PASS** — **~17,100 tokens, $0.1711/turn injection-alone** at `claude-opus-4-7`; realistic turn ≈$0.3365, injection = 51%. Measured by differential CLI usage and independently reproduced by the measurement judge (17,094) |
| Model passthrough: a turn on model A and a turn on model B, read back | **PARTIAL** — proven on `/chat`: invalid model → **400**, `claude-haiku-4-5` → **200**, `claude-sonnet-4-6` → **200**, no-model default → **200**. Read-back **from the stream** is blocked by the P0. Nothing else on the service changed: `git diff 2b1054f..HEAD --stat` = `main.py` only, +21/-2 |
| Broker controls re-proven post-change | **PASS** — anon → 401; anon-key-as-bearer → **401 `invalid_token`** (the function's own check, so platform `verify_jwt` is not being relied on); CORS source-fixed, not reflected, for a disallowed origin; `working_directory`/`client_id` absent as request fields. Oversize → 413 is **unverified end-to-end** because auth precedes size and no real session was minted |
| Voice: measured latency and WER per fixture, explicit met/not-met | **PASS** — `phase4-voice.md`: WER **38.6%**, utterance-end→first-audible **952ms median**, 6 of 36 turns over 1.2s (max 1793ms). **MET at the median, NOT met as a bound**, local-only with the broker stubbed |
| Content: both lanes as separate views, verified by a live render per lane | **PASS** — `phase5-verify-part2.md` row 1: lane chips `["Ivan","Mattan Danino"]`, zero "Rise" strings across 4 renders |
| Content: 29 exports + 4 row sets each carry a surface-or-drop decision | **PASS** — `phase1b-content/DECISION-TABLE.md`: 33 required decisions = 23 surface / 10 engine-only / 1 sub-row drop, no gaps |
| Content: scheduled queue, per-draft detail, style roster both families, resources render real rows | **PASS** — row 6: queue **152**, styles **17 (11+6)** across both families, resources **121 Ivan / 5 Mattan** — DOM counts match DB counts exactly |
| Content: `isStuckScheduled` and approved-but-undated visible, proven on a real row | **PASS** — row 5, the stuck Shopify Report Card resource renders on Mattan's lane. Caveat recorded honestly: the screen shows "6d ago" from `updated_at`, not a verified nine-days-since-approved |
| Content: exactly two lanes, no AgentOps destination, proven by grep | **PASS** — row 2: 0 grep hits and the rendered rail confirmed (Today/Inbox/DMs/Content/Sends/Ops/Claude/Settings) |
| Content: agent log renders in full, proven on a multi-regeneration row | **PASS** — row 3, proof row `792ee91c…`: **37 entries, 11 distinct agents, 37/37 attributed, 0 clamp, 0 "Show more"**, confirmed by network request and an independently-scoped DOM query (the verifier rewrote the builder's own selector because it ambiguously also matched the QA block) |
| Content: full tag set renders and is filterable, proven by filtering to a known row | **PASS** — row 4: "39 of 171 drafts shown", both numbers on screen |
| Content: field-by-field diff vs the five dashboard sources, every gap carried or dropped | **PASS** — `phase1b-content/FIELD-DIFF.md`: 9 gap classes closed, 0 unaccounted |
| Content: write-affordance matrix matches what ships; grep proves no publish/schedule/delete added; `lm_drafts_v2` read-only | **PASS** — row 7: exactly 2 writes in the whole content surface, both pre-existing (`approveDraft`/`skipDraft`), both `.is('client_id', null)`-scoped |
| Design: the "meh" diagnosis stated and backed by the prior run's artifacts | **PASS** — `phase2b-design/DIAGNOSIS.md`: **CONFIRMED** on four pieces of the prior run's own evidence, chiefly `CONTRACT.md:5-7` ("any candidate that invents a new aesthetic loses on craft-fidelity before it is scored") and `judge-craft.md:43` scoring sameness-with-baseline as the top virtue. Plus a live capture of `ivanmanfredi.com` showing what the brand actually is |
| Design: 3 directions BUILT and rendered at both viewports, differing in look not layout, citing fetched references | **PASS with one gap** — three treatments built and committed; crops at 390 and 1440. `inkline` and `instrument` cite live-fetched references with measured values (node counts, exact alphas, exact tracking); **`paper` records only one verified live fetch where the contract required two**, and the top-studio seat marked it down for exactly that rather than having it papered over |
| Design: panel calibrated on controls before voting, incl. the top-studio seat, finalists staged, no autonomous convergence | **PASS** — `PANEL.md` calibration separated cleanly (site 10 / baseline 3 / generic template 1) before any candidate was opened; four seats incl. top-studio and felt-difference. **Nothing converged** — the ballot carries three rendered finalists |
| Zero overflow at 390 and zero console errors everywhere; secret grep clean; default routes diffed | **PASS, with one honest limit** — sweep 14/14 workbench + 12/12 default routes clean: zero overflow, zero login leaks, zero console errors. Secret grep clean (dist holds exactly one JWT, decoded `role=anon`; 0 hits in `exp/v2..exp/brain` history). Diffshots run and written up in `phase5-diffshots.md`: 4 routes pixels-differ-geometry-same, 8 geometry-moved, **none attributable to this run** — all 8 are live data drift or `exp/v2`'s already-known shared-file changes. Limit stated: the comparison is against a pre-`exp/v2` baseline, so it cannot isolate this run's contribution from the pending ballot's |
| `npm run build` clean, tests green with counts, lint 0 errors, no new dependency | **PASS** — **378 tests / 22 files**, lint **0 errors** (17 pre-existing warnings), build clean, `package.json` diff empty |

**Totals: 22 PASS · 1 PARTIAL · 2 BLOCKED.** Both BLOCKED rows have the same single cause, and that cause is decision 3 on your ballot.

---

## What is live right now

- **Content surface**, both lanes, on `exp/brain` behind `#exp/` — 198 Ivan rows by pipeline stage, 84 of Mattan's by promotion state, the 152-row publish queue (previously read by nothing in the app), 17 styles across both colliding families, resources per lane, the full agent register with attribution, and a filterable tag set.
- **Broker + assembler + depth block**, deployed to `bjbvqvzbzczjbatgmccb`. Fails closed on missing config, JWT verified by `getUser`, single-user allowlist, CORS allowlisted, no `working_directory`/`client_id` anywhere in the request path.
- **Railway model passthrough**, live and working on `/chat`. Restore is one line: `git revert 82e4ab1 && railway up --detach`.
- **Injection hardening**, deployed — every evasion the skeptic found is now neutralised *and counted*, and header fields are shape-validated instead of trusted.

## Three bugs this run fixed that nobody was looking for

1. `normalizeAgentLog` discarded the `agent` field on **2999 of 2999** live log entries, so the whole generation register rendered anonymous.
2. `source_detail` is an object on **71 rows (63 of them Mattan's)** while typed as a string and pushed into an unguarded JSX child — a live crash class on the client lane.
3. The deployed broker source existed on **no branch at all** — untracked working-tree files, one `git clean` from gone. Archived verbatim as `d1b4f33` before anything else happened.

## Deviations from the spec, and why

- **The Railway `--verbose` fix was withheld.** The grant read "an allowlisted model passthrough ONLY. Nothing else on that service may change." Applying a second change to a multi-client service without authority is exactly what that sentence forbids, even though this one cannot regress behaviour that does not exist. It goes to you instead.
- **Two blocking injection amendments were applied by me, not by an agent.** Four subagents died to the harness watchdog mid-task; rather than lose the work I finished A1/A2 directly, with a test file (`phase3-build/escaper-evasion-test.mjs`) that runs every row of the skeptic's evasion table.
- **The cap was raised 36,000 → 46,000.** Measured, the combined artifact is 41,275 chars, so the specified cap would have shed on turn one, every turn. Cost is unchanged (a cap is a ceiling). Tiering stayed a ballot item, as instructed.
- **`paper` cites one live reference, not two**, and its first crop set was a failed capture (expired session → skeletons) that the panel correctly refused to score. Re-captured, re-scored on real pixels: craft 2 → 7, and it now ties `instrument` at 7.50.
- **Diffshots' first run was a failed capture** (session-less shots, 14 words each, which the tool duly called a 12/12 regression). Re-captured and re-run; the write-up in `phase5-diffshots.md` names what the check cannot isolate rather than overclaiming.

## Watch-first — what to look at, and what would tell you something

1. **Does an injected brain make the answers better, or just longer?** You cannot see this until decision 3 lands. When it does, the tell is whether it cites `file (date)` and declines on low confidence, or whether it name-drops memory without using it.
2. **Per-turn cost in practice against the $0.1711 estimate.** Telemetry lands in `client_api_usage`. If daily use makes that number annoying, the 13× cache fix is the lever, not tiering the brain.
3. **Real dictation on your actual iPhone over cell.** Every voice number here comes from desktop Chrome with a loopback device. WER 38.6% is the blocker, not latency — every product noun fails ("Supabase" → "super base", "UniPile" → "you need Kyle"). And check `useVoice.ts:118`'s `continuous=false` on a real mic before trusting the one-line finding.
4. **iOS PWA microphone permission and service-worker behaviour** on your phone — untested here.
5. **The Railway model passthrough under real load**, and whether any other client's workflow calling `/chat` is affected. It shouldn't be: `model=None` returns the same `CLAUDE_MODEL` string the old code passed.
6. **Whether a memory row written later contains instruction-shaped text that defeats the framing.** 27 attacks held, but that is 0 of 27, not 0%. The escaper now counts what it neutralises, so the telemetry will tell you.
7. **The voice privacy claim.** `useVoice.ts:11-13` says "nothing leaves the browser". That is false — audio goes to `google.com/speech-api`, proven by netlog and by killing DNS. Operator commands naming clients are leaving the device. Either fix the comment or fix the pipeline.

## Resume commands

```bash
cd ~/Desktop/ivan-inbox && git checkout exp/brain            # the run's branch, 9 commits
open goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/BALLOT.html

# see the three visual directions live (each needs its own dev server)
git worktree list                                            # wt-paper / wt-inkline / wt-instrument
# rebase a direction onto the current tip before any apply:
git rebase exp/brain exp/brain-2b-<paper|inkline|instrument> # inkline+instrument will conflict on shared sheets

# the Railway P0 fix, if you decide to take it (ballot decision 3):
cd ~/Desktop/claude-code-railway                             # add "--verbose" at main.py:808, then:
railway up --detach
# restore the model passthrough instead:
git revert 82e4ab1 && railway up --detach

# arm the broker (pointless until decision 3):
supabase secrets set RAILWAY_CLAUDE_API_KEY=<Railway API_KEY> --project-ref bjbvqvzbzczjbatgmccb
```

## Artifact index

`phase0-scope.md` · `phase0-research-{injector,db,railway,inbox,dashboards}.md` · `phase1-parity/{PARITY-SPEC,DEPTH-SPEC,INJECTION-SAFETY,AMENDMENTS,SKEPTIC-CROSS-TENANT,SKEPTIC-INJECTION}.md` · `phase1b-content/{IA,DECISION-TABLE,FIELD-DIFF,AFFORDANCES,SKEPTIC-FALSE-VERIFICATION}.md` · `phase2-tournament/{CONTRACT,VERDICT,judge-spec-fidelity,judge-measurement,judge-operational}.md` + `cand-{live,memo}/` · `phase2b-design/{DIAGNOSIS,CONTRACT-2B,PANEL,PANEL-PAPER-RESCORE}.md` + `brief-{paper,inkline,instrument}.md` + `crops/` + `brand-refs/` · `phase3-build/LEDGER.md` (6 sections) + `railway-snapshot/` + `railway-env-before.md` + `escaper-evasion-test.mjs` · `phase4-voice.md` + `phase4-fixtures/` + `phase4-harness/` · `phase5-verify-part1.md` · `phase5-verify-part2.md` + `phase5-shots/` · `BALLOT.html`
