# Phase 1 — independent review (orchestrator, after the reviewer agent died to the session limit)

The dispatched reviewer was killed by the account session limit before writing anything. Per the run's
recovery rule the verification ran in the main loop instead, with fresh scripts
(`scripts/_orch-p1verify.mjs`, `_orch-p1verify2.mjs` — not the builder's own instruments). Verified
against `exp/vis-faithful` @ `476a5a1` (includes the four Phase 1 commits), live :5431, fresh session,
settled captures.

## Claims vs measured

| claim (builder) | measured (orchestrator) | verdict |
|---|---|---|
| first `.ct-card` y = 797 @1440 peer docked | **797** | CONFIRMED |
| always-rendered chips 105 → 0 | `.ct-f` count **0** | CONFIRMED |
| filter block ~100px @1440 | `.ct-fr` rows 58 + 26 = **84px** measured on the post lane | CONFIRMED (≤ claim) |
| pills present | **9** `.ct-fpill` | CONFIRMED |
| panel options carry counts | "Published 109 · Archived 39 · Needs review 19 · Errors 4 · Scheduled 2" | CONFIRMED |
| filtering works | Stage: Published → cards 23 → 4, pill reads `Stage: Published ⌄` | CONFIRMED |
| persistence survives reload | pill still `Stage: Published ⌄` after reload; `localStorage["wb-section:content.posts.ivan"] = {"v":1,"filters":{"stage":"published"},"q":""}` — allowlisted fields ONLY, versioned | CONFIRMED |
| Clear all removes the key | key gone after Clear all | CONFIRMED |
| 390 collapsed chrome ≤120px | `.ct-fr` **76px** per lane | CONFIRMED |
| 390 bottom sheet, rows ≥44px | `.ct-fsheet` height 333, bottom = 844 (true sheet), min row **44px**, tap-out closes | CONFIRMED |
| zero horizontal overflow @390 | scrollWidth 390 | CONFIRMED |

DQ spot-checks: `git diff 2b8554a..HEAD -- src/styles.css` empty (D1 clean); `package.json`/lock
untouched (D3 clean); diffstat touches only expected files.

## Residual routed to Phase 3

- **Filtered-render count differs across reload** (4 rendered cards pre-reload vs 47 post-reload under
  the same `stage=published` filter). The filter state itself is correct both times; the difference is
  section open/collapse interplay with an active stage filter. Phase 3 should make the filtered render
  deterministic (an active stage filter should probably force that stage's section open and others
  hidden, or state the rule).
- Full censuses + Sends `Range:` pill regression + default-app regression intentionally deferred to
  Phase 6's instrument pass (they run there regardless).

Verdict: **Phase 1 stands.** The wall is dead at both widths, the grammar conforms to §11, persistence
is real and allowlisted.
