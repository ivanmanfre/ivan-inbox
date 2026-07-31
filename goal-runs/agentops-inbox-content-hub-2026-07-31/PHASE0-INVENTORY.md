# Phase 0 — Scope, central risk, surface inventory

Run: agentops-inbox-content-hub-2026-07-31 · Orchestrator: Fable (main loop) · Started 2026-07-31

## Central risk and neutralization

**Risk:** anon-key/RLS gap — the inbox client can't read tables the dashboard panels read, shipping "authed-empty" blank surfaces.

**Phase-0 finding that reshapes the risk:** both apps hit the SAME Supabase project (`bjbvqvzbzczjbatgmccb`) with the SAME anon key (`personal-site/.env` and `ivan-inbox/.env.local` both carry `VITE_SUPABASE_ANON_KEY`; the dashboard has no Supabase auth session — it is hash-gated client-side only — so every dashboard read already succeeds under the plain `anon` role). Therefore any table the dashboard surface reads is by construction anon-readable, and the inbox (anon + authenticated magic-link JWT, `src/lib/supabase.ts:3-19`) can read at least as much. The risk narrows to: (1) tables where policies key on `authenticated` differently than `anon`, (2) writes, (3) inbox-side `db/` schema objects the dashboard never touches. Neutralized by the Phase 1e live probe: every table/RPC on the readers' exhaustive lists gets probed with the real anon key via PostgREST before any UI is built.

## Key/deploy facts (verified this session)

- ivan-inbox: Vite PWA → GitHub Pages via Actions on push to main (`.github/workflows/deploy.yml`, secrets `VITE_SUPABASE_URL/ANON_KEY/VAPID`). Login = Supabase magic link, implicit flow (`src/lib/supabase.ts`). Local `.env.local` present.
- personal-site: same Supabase project + anon key; `VITE_DASHBOARD_HASH` client-side gate. NOT deployed by this run (guardrail; unpushed commits exist).
- ivan-inbox owns its own SQL surface: `db/001…022` (inbox threads, push triggers, sends views, KPI views, governor, ops drafts `015`, newsjack cards `020`, weekly report cards `021`, comment reply cards `022`) + `supabase/functions/`.

## Surface inventory (each line = a place the change must land or be verified)

### Source surfaces (dashboard, personal-site — read-only this run)
| Surface | Files | Verification requirement |
|---|---|---|
| Agent section (v2 nav `system/agent`) | `components/dashboard-v2/DemoShell.tsx` NAV; `components/dashboard/AgentPanel.tsx`, `AgentReadyPanel.tsx`, `AgentLogFeed.tsx`; `components/dashboard-v2/sections/rebuilt/AgentRebuilt.tsx` + `rebuilt/agent/`; `hooks/useAgentData` | Phase 1a capability map → PARITY-LEDGER covers 100% |
| Content: posts board | `components/dashboard-v2/review/PostWorkSurface.tsx` | Phase 1b: status vocabulary incl. `scheduled`-hides trap verified in code |
| Content: calendar | `sections/Calendar.tsx`, `calendarItems.ts` | Phase 1b |
| Content: Rise lane | `components/ClientBoardPage.tsx` + client boards data | Phase 1b: tenancy scoping in SQL; logged-out leak probe in Phase 4 |
| Styles | `sections/StylesLive.tsx` | Phase 1c: canonical style list grounded in code/data, preview source per style |
| LM studio / resources | `components/dashboard/LeadMagnetStudioPanel.tsx`, `LeadMagnetEditor.tsx`, `review/LmWorkSurface.tsx` | Phase 1c: LM tables, ivan/client scoping, live URL pattern |

### Target surfaces (ivan-inbox — the build lands here)
| Surface | Files | Verification requirement |
|---|---|---|
| Tab/nav model | `src/App.tsx` (Tab union, layout branches ×2: mobile + desktop split), `src/components/TabBar.tsx`, `src/lib/route.ts` | New sections reachable in BOTH layout branches; deep links work |
| Ops tab (adjacent/merge target) | `src/screens/OpsScreen.tsx`, `src/hooks/useOps.ts`, `src/lib/ops.ts` | Existing cards unbroken (two-mount regression `754d32d` known); approve-publishes semantics preserved |
| Screens/design canon | `src/screens/*` (8 screens + kpi/), `src/styles.css`, `Skeleton/ConfirmSheet/ContextSheet/PullIndicator` | New screens pass native-ness judge vs TodayScreen/OpsScreen controls |
| Data layer | `src/hooks/*`, `src/lib/*` (+ `*.test.ts` vitest convention) | New lib code has tests in-style |
| PWA update path | `src/sw.ts`, `index.html`, `public/`, `registerSW` | New bundle reaches installed app; watch-first item for Ivan's device |
| Push deep links | `src/lib/push.ts`, `db/002_push_trigger.sql`, `db/016_morning_push.sql` | Notification deep links land on right tab after nav changes |
| Deploy | `.github/workflows/deploy.yml` | Live-URL render + served-bytes check (Phase 3/4) |
| DB surface | `db/0xx` numbered migrations | Any new SQL follows numbering; T1 snapshot+rollback |

### Data/infra surfaces
- Supabase project `bjbvqvzbzczjbatgmccb` — access matrix per table/RPC (Phase 1e), REST probes with the real anon key.
- resources.ivanmanfredi.com — LM/resource live URLs referenced by the Styles section (Phase 4: every link resolves).
- n8n — READ-ONLY, only if a status-flow question can't be answered from code/DB.

## Explicitly out of scope (locked)
- Deleting/hiding anything on the dashboard (LOCK 3). personal-site pushes. n8n edits. New external-publish paths. New secrets in the client bundle.
