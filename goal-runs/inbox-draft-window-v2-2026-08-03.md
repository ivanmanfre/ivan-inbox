# inbox-draft-window-v2 — make the post window as good as dashboard-v2

Authored 2026-08-03 ~15:00 from Ivan's live use, right after the density run deployed.

## What Ivan said

"the content window when open each post to see is nothing like
https://ivanmanfredi.com/dashboard-v2/?section=posts&sub=pipeline with the html preview editable and
way better horizontal organization.. make it much better"

So: the inbox app's draft takeover window (`.wb-tk`, `DraftPane.tsx` / `DraftWindow`) is thin compared
to the surface he already owns. Rebuild it to that standard. Two things he named explicitly —
**an EDITABLE html preview** and **horizontal organisation** — plus "much better" overall, which the
reference defines.

## The reference is LOCAL — read the code, do not fight the login

`ivanmanfredi.com/dashboard-v2` is OTP-gated. The source is in `~/Desktop/personal-site`:

- `components/dashboard-v2/review/PostWorkSurface.tsx` (588 lines) — the posts pipeline surface:
  split lanes (ideas table on top, one-at-a-time review reader below), LinkedIn-faithful preview,
  Approve/Reject/Edit/Skip with j/k, a shared full-depth slide-over opened from either lane.
- `components/dashboard-v2/review/reviewShared.tsx` — `LinkedInPost`, `ageLabel`, the fade CSS.
- `components/dashboard-v2/review/worksurface.css` + `editorial-cockpit.css` + `dashboard-v2.css` —
  the layout and type decisions.
- `components/dashboard/CarouselEditor.tsx` — the full-depth editor the slide-over mounts:
  QA verdict panel, agent log feed, source briefing, retry/regenerate, schedule, publish.
- `components/dashboard/QAVerdictPanel.tsx`, `AgentLogFeed.tsx`, `SourceBriefing.tsx`,
  `PostStudioPanel.tsx`, `LeadMagnetEditor.tsx`, `ImageEditor/`, `lib/studioActions.ts`
  (`setStatus`, `saveDraft`, `buildLMAssets`, `replaceAt`).
- Run it locally if you want the visual truth (`npm run dev` in personal-site) — that is a legitimate
  substitute for the gated screenshot, and better than guessing.

Do NOT modify personal-site. It is a live-deploy repo on `main`. Read only.

## Mission

The draft window in the inbox app becomes a working surface, not a reading pane: the post renders as
it will look, the copy is editable in place, and everything that decides the draft's fate (QA verdict,
agent log, source, actions) is reachable without a long vertical scroll.

## What "much better" means concretely (build all of it)

1. **Editable preview.** The LinkedIn-faithful render IS the editor — edit the copy where it is
   displayed, not in a separate textarea below a picture of it. Save is explicit; the regen-clobber
   guard (db 025) stays respected; a save conflict surfaces rather than picking a winner.
2. **Horizontal organisation.** Preview on one side, decision material on the other (QA verdict,
   agent log, source briefing, meta), so the eye moves across rather than down. At 390 it collapses
   to a deliberate order, not a random stack — state that order in the ledger.
3. **The full action set**, already ported once but verify each still fires: regen copy, regen cover,
   regen from idea, per-image regen, schedule, approve, skip, delete. Anything the reference has that
   the inbox window lacks gets added or explicitly declined in the report with a reason.
4. **Keyboard**: j/k between drafts and the reference's action keys, since the reference has them and
   a review lane without them is slower than the thing it replaced.
5. **Lead magnets** get the same treatment from `LmWorkSurface.tsx` + `LeadMagnetEditor.tsx`.

## Non-negotiables

- Repo `~/Desktop/ivan-inbox`, branch off `main`, merge+push at the gate. NEVER `git add -A`.
- The shipped Nixtio skin is law (`goal-runs/inbox-usability-and-voice-live-2026-08-03-out/
  reference-nixtio-full.png` + `phase2-style-delta.md`). Port the reference's STRUCTURE and
  AFFORDANCES; do not import its skin, its fonts, or `lucide-react`/`sonner` (no new dependency).
- Mechanical floors: WCAG contrast, 44px targets at 390, zero horizontal overflow, zero console
  errors, `npm run build` clean (it catches what `tsc --noEmit` misses), tests green (522/522 now).
- Destructive/paid actions (regen replaces live copy, image gen costs money) keep a confirm. Ivan has
  never fired the regen buttons at a real row — if you can verify one safely, do it and say which;
  otherwise verify to the dispatch boundary and NAME that in the report.
- Deploy at the gate and live-verify authenticated (`.session.json`, playwright via
  `NODE_PATH=$HOME/.claude/skills/playwright-driver/node_modules`).
- 🔴 The service worker now calls `skipWaiting` (commit `13844f7`) — before this, deploys were
  invisible to Ivan's open tabs for a whole day. Do not remove it, and verify the live bundle hash
  changes after your deploy.
- Never ask Ivan questions mid-run. Do not report until done.

## Gate

Before/after screenshots of the window at 1440 and 390; a feature-parity table (reference affordance →
present / added / declined-with-reason); an edit round-trip verified against the database; censuses
clean; tests + build green; deployed and live-verified; REPORT.md in
`goal-runs/inbox-draft-window-v2-2026-08-03-out/`; memory writeback.

## Resume rule

On death: read this file + the -out dir + `git log`, trust only committed state, re-measure any
uncommitted claim, continue from the first unmet gate. Commit every few minutes.
