# Tournament build contract — every candidate obeys this

Written before any candidate agent was dispatched (goal-run discipline: specs to disk first, so a session limit cannot cost the judge panel). Candidate-specific direction briefs live beside this file as `brief-<id>.md`.

## Mode: ELEVATE, not replace

The current app's visual language is the **floor**. You are competing on hierarchy, density, composition and flow *within* that canon. Any candidate that invents a new aesthetic loses on craft-fidelity before it is scored.

**Locked and non-negotiable** (all from `src/styles.css:1-16` and the house rules):
- Tokens: `--bg:#000`, `--surface:#1C1C1E`, `--surface2:#2C2C2E`, `--surface3:#3A3A3C`, `--text/-2/-3`, `--accent:#10A37F`, `--blue:#0A84FF`, `--sep`. Light theme via `:root[data-theme='light']` must keep working.
- System font stack only. **No monospace anywhere** (house rule, `src/styles.css:471`). No webfont, no `@font-face`.
- Severity stays a 3-tier system: `#10A37F` clear / `#FF9F0A` attention / `#FF453A` urgent (`src/styles.css:468-471`). Do not add a 4th severity colour. Taxonomy accents (`#BF5AF2` InMail etc.) may stay as-is.
- Icons are Unicode glyphs (`src/components/TabBar.tsx:9-30`). No icon library, no SVG icon set.
- No new npm dependencies. Deps are `react` + `@supabase/supabase-js`, full stop. No animation library, no markdown stack, no virtualization library unless you implement it in ~40 lines yourself and justify it.
- Motion budget: the app has 6 keyframes total. You may add at most 2, each earning its place.
- Radii: consolidate toward 2-3 tokens (the audit found 6 different card radii: 13/14/15/16/18/20px). Do not add a 7th.

## What every candidate must deliver

All eight surfaces reachable and coherent: **today, inbox+thread, drafts, sends(+overview), ops, settings, CONTENT, CHAT**. Content and Chat are new; the other six are being elevated. A candidate that only redesigns navigation and leaves screens untouched does not qualify.

- **Content** consumes the existing shipped data layer: `src/lib/content.ts`, `styles.ts` (+ `useContent`, `useStyles`). **Do not rebuild or fork it.** Reuse `src/exp/cand-a/*` or `cand-b/*` components freely as raw material.
- **Chat** is the Claude Code surface. In this phase it renders against a **mock transport** (a local stub that emits the same SSE-ish frame sequence) so composition can be judged without the broker existing. Do not call Railway or any edge function from a tournament candidate.
- Every screen works at **390×852** and **1440×900**.

## Hard gates — measured, not eyeballed

> **AMENDED 2026-08-01 after calibration — see `CALIBRATION.md`.** Two gates below were withdrawn because they failed their controls: `≤140 words/1000px` (a prose strawman scored 169 while the app's best screen scored 142.5) and `primary number ≥40px` (contradicts the locked type scale, whose real ceiling is 26-38px). They are now reported metrics, not pass/fail. The gate that replaced them: **any content-bearing surface (>100 words) must carry ≥1 visual encoding** — the one threshold that cleanly separated every control. Prose ceiling relaxed 30% → 80%. Gate list as actually run is at the end of `CALIBRATION.md`.

A candidate failing any gate is fixed or dropped before judging; these are instrument checks, not opinions.

1. **Zero horizontal overflow at 390px** on every surface: `document.documentElement.scrollWidth === clientWidth`. Also no internal clipping of a text pill (the live bug this run found: `.ov-over-lbl` is `white-space:nowrap` inside a flex parent, `src/styles.css:402` — fix it, don't reproduce it).
2. **Density**: ≤140 words per 1000px of rendered height, ≤30% prose share, every KPI/stat panel has a primary number ≥40px, per-row metrics ≥18px, and **every section encodes something visually** (a section that is only text and lists fails the build).
3. **No empty-vs-broken ambiguity**: every data surface distinguishes "genuinely empty" from "fetch failed" from "still loading". Three visibly different states. This is the audit's P1 U2/U3 and it is a build requirement, not a nice-to-have.
4. **No ghost panes**: the desktop split must not show "Select a conversation" on a tab that has no conversation (currently broken for Drafts and Settings, `src/App.tsx:148-158`).
5. **Zero console errors** on load of every surface.
6. `npm test` green and `npm run lint` clean. Tests are pure-function only in this repo; if you change a pure helper, update its test.

## Load-bearing traps — violating any of these is an automatic loss

- **`useInbox` hardcodes its realtime topic** `supabase.channel('inbox')` (`src/hooks/useInbox.ts:26`), while every other hook namespaces with `useId()` (`useOps.ts:8-15`, `useContent.ts:28-35`, `useAgent.ts:21-26`) because `supabase.channel()` returns the *existing* channel for a topic. If your design mounts `useInbox` from more than one place, **namespace it first**.
- **Ivan's content rows have `client_id` NULL**, not `'ivan'` (`src/lib/content.ts:56-60`). `.eq('client_id','ivan')` renders a calm, wrong, empty board. Use the existing `laneFilter()`.
- **Two style families collide on `before-after`** (`src/lib/styles.ts:11-19`); preview joins must stay family-keyed via `previewKeyFor` (`:165-172`). An empty preview is a designed state; a wrong preview is a lie.
- **Resources (`lm_drafts_v2`) are read-only on purpose** (`styles.ts:218-221`) — approving may trip a publish watcher. No write affordance.
- **`sendChat` is RPC-only** via `n8nclaw_dashboard_send` (`src/lib/agent.ts:157-162`). The n8nClaw dashboard's unauthenticated `webhook/n8nclaw-whatsapp` fallback spoofs an inbound WhatsApp message on any RPC error — it is deliberately absent here. **Never port it.**
- **`dashboard_action`** (`src/lib/agent.ts:174-197`) is a SECURITY DEFINER RPC whose allowlist reaches `outreach_campaigns.is_active` and `outreach_prospects.stage`. Wrappers hard-code table+field. Never expose table/field to a caller, never add a wrapper that takes them as arguments.
- **Edge functions are called with bare `fetch()`, never `supabase.functions.invoke()`** (`src/lib/today.ts:6-8` — invoke's `X-Client-Info` header dies in that function's CORS preflight).
- **Nothing publishes.** `approveDraft` in the content layer sets status only (`content.ts:233-238`). Do not add schedule, publish, or delete affordances to Content.
- **The `#exp/` hash is read at mount only** (`src/exp/index.tsx:14`). Every verification needs a fresh page load, never an in-page hash nav.

## Known defects you may fix (credit for fixing, no penalty for scoping out)

| id | Defect | Where |
|---|---|---|
| U1 | `approveDraft` never checks `send_blocked_reason`, so a stale view can re-approve a discarded draft | `src/lib/inbox.ts:160-169` |
| U2/U3 | `useInbox`/`useOps` swallow fetch errors — no error state exists | `useInbox.ts:22`, `useOps.ts:19` |
| U4 | Freehand compose has no confirmation while approving a reviewed draft does | `ThreadScreen.tsx:117-124` |
| U6 | `useInbox` pages up to 20k rows on every mount/realtime event/focus; inbox renders 49,558 words at 390px | `src/lib/inbox.ts:135-150` |
| A1 | Ghost "Select a conversation" pane on Drafts/Settings desktop | `src/App.tsx:148-158` |
| A2 | `% of cap` pill clipped at 390px | `src/styles.css:402` |
| A3 | 6 card radii + 3 pill radii; 4 different section-header patterns | across screens |

## Deliverables per candidate

1. Working code on your own branch in your own git worktree, reachable at a distinct `#exp/` route.
2. `phase2-tournament/brief-<id>.md` updated with: your nav skeleton, what you made primary and why, how you handled the 4×-duplicated desktop/mobile fork (`App.tsx:148-192` + 3 candidate shells), which content grouping you chose as primary (triage `bucketDrafts` vs lifecycle `groupByStage`, `content.ts:264-277`), and your self-measured gate numbers.
3. Screenshots of all 8 surfaces × 2 viewports into `phase2-tournament/crops/<id>/`, captured with `node scripts/sweep.mjs` (it injects the session, measures overflow, and counts words — use it rather than a hand-rolled screenshot).
