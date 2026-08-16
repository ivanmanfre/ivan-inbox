# Phase 0 — Console errors + hover/press/focus coverage (v2c Workbench, exp/vis-faithful)

Scout run 2026-08-02. Worktree `wt-faithful`, dev server `localhost:5431`, auth via `.session.json` (valid at time of run, expires 19:21:41Z). Routes enumerated from `src/exp/v2c/Shell.tsx` / `layout.ts` (`JOBS`): **today, inbox, drafts, content, sends, ops, settings** — reached at `#exp/v2/<job>`. All 7 tested at 1440×900 and 390×844, dark theme (default).

Screenshots: `phase0-shots/errhover-console-<route>-<viewport>.png` (load+settle+interaction, all 14 combos), `errhover-chatsend2-<viewport>.png` (chat-send interaction), `errhover-livecensus-settings.png`.

---

## TASK A — Console sweep

### Result: 0 console errors/warnings from page load through settle + interaction pass, on all 7 routes × 2 viewports (14/14 clean), EXCEPT when the chat composer is actually used.

**Pre-existing, not treatment (14 occurrences of 1 class, harmless):**
`net::ERR_ABORTED` on `HEAD .../rest/v1/carousel_drafts?select=id&client_id=is.null&status=eq.review` — fires **exactly twice** on every single route (2×7=14 total across the 1440 sweep, same again at 390). Root cause: `useContentBadge.ts` (mounted once in `Shell.tsx`, badge count for the rail's Content row) runs its effect under React 18 `<StrictMode>` (`main.tsx:11`), which double-invokes effects in dev — first invocation's request is aborted, second completes normally and resolves the count correctly. Confirmed by direct inspection of `useContentBadge.ts:24-33` (no unusual logic) and by the resolved rail badge always showing a correct, non-zero count in screenshots. **Not a real bug, not caused by faithful.css/v2c** — it is a dev-mode StrictMode artifact of a hook that predates this candidate. On the `content` route specifically this multiplies to **14 aborted requests** (2 badge + 12 facet-count HEADs from `ContentBits`/`ContentSections`' own status-count queries), same root cause, same harmlessness.

**The known "unarmed inbox-claude broker CORS" class — precisely counted:**
Zero console errors appear from load/settle/row-open/lane-switch/section-toggle alone (chat is docked but idle). The class only fires **when a chat turn is actually sent** (composer Enter). Reproduced cleanly on both viewports (inbox route, chat docked at 1440; toggled open via the Claude tab at 390):

```
error: Access to fetch at 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-claude'
  from origin 'http://localhost:5431' has been blocked by CORS policy: Response to
  preflight request doesn't pass access control check: The 'Access-Control-Allow-Origin'
  header has a value 'https://ivanmanfre.github.io' that is not equal to the supplied origin.
error: Failed to load resource: net::ERR_FAILED   (the actual POST to /functions/v1/inbox-claude)
```
= **exactly 2 console errors + 1 failed network request per chat-send attempt**, identical on both viewports. Root cause confirmed in code: `chat/transport.ts:14-18` documents the broker ships with `RAILWAY_CLAUDE_API_KEY` unset ("ships UNARMED on purpose"); separately, the Supabase edge function's CORS allow-list is hardcoded to the production origin `https://ivanmanfre.github.io` and doesn't include `localhost:5431` (dev) — so **any local dev session that sends a chat turn gets this CORS error before ever reaching the "unarmed" application-level error state**. This is the exact class the run will fix "via arming" — count it as: **2 console errors + 1 failed request, once per send attempt, both viewports, dev-origin-only** (production origin is presumably allow-listed and would surface the clean `upstream_not_armed` copy instead).

**Test-script caveat (not an app bug):** an early naive "wait until `.sk-av` count is 0" settle-check falsely reported the inbox as permanently stuck loading. Root-caused: the check could exit before the skeleton ever mounted. A corrected settle (`.r:not(.sk-r)` count > 0 OR `.wb-failed-t` present) shows inbox actually settles at **~4.2s** (2 sequential 1000-row pages via `fetchMessages()` in `src/lib/inbox.ts:140-148`, doubled again by StrictMode — 4 total `inbox_messages_v` requests, all 200). No hang, no bug.

### Route-by-route summary (1440×900 and 390×844 identical except where noted)
| Route | Console errors | Failed reqs | Interaction performed |
|---|---|---|---|
| today | 0 | 2 (badge, pre-existing) | none (aggregate surface) |
| inbox | 0 | 2 | opened first row |
| drafts | 0 | 2 | opened first row |
| content | 0 | 14 (badge + facet counts, pre-existing) | switched lane + opened row |
| sends | 0 | 2 | switched client/lane segment |
| ops | 0 | 2 | toggled a section |
| settings | 0 | 2 | (no interactive list) |
| inbox (chat-send) | **2** (CORS + ERR_FAILED) | +1 (`inbox-claude` ERR_FAILED) | sent a chat turn |

---

## TASK B — Hover / press / focus census

Full static pass over `faithful.css` (1549 lines) + `styles.css` (698 lines, v2c-local) + root `src/styles.css` (738 lines, shared/reused), cross-referenced against every `onClick` in `src/exp/v2c/*.tsx` (grep confirmed **zero** `tabIndex`, **zero** `role=`, **one** `onKeyDown` in the whole v2c surface — the composer's arrow-key/Enter handler for the slash-palette). Representative sample live-verified in Playwright via `.hover()` + `el.matches(':hover')` (real browser hover, not just CSS-reading) and `el.focus()` + `document.activeElement` check (real focus reachability, not just CSS reading).

### Global mechanism found
`faithful.css:348` declares one blanket rule: `.wb.wb.wb :focus-visible{ outline:2px solid var(--accent); outline-offset:2px }` — correct, and it DOES render (live-verified on `.wb-ask` and `.wb-modelbtn`: `outline: solid rgb(16,163,127) 2px`). **The problem is reach, not the ring.** `faithful.css:1061` also declares a blanket `.wb.wb.wb *{ transition:none }`, then selectively re-enables `background-color` transitions on 9 selectors only (`.ct-card, .r, .td-r.tap, .ov-tr, .wb-rj:hover, .ct-f, .wb-fpill, .btn, .chip`) — everything else that still has a *background* hover rule snaps instantly instead of fading.

### Live-verified table (19 classes tested)
| Element class | file:line (rest/hover CSS) | tag | hover? | press/active? | focus? | cursor | verified |
|---|---|---|---|---|---|---|---|
| `.wb-rj` (rail nav item) | styles.css:62-65 base; faithful.css:1024 hover | DIV | ✅ bg shift (surface2) | — (no `:active`) | ❌ not focusable | pointer | live |
| `.wb-rj-peer` (Claude rail item) | styles.css:79-81 | DIV | untestable (already "on") | — | ❌ | pointer | live |
| `.wb-rail-sync` (refresh) | styles.css:87-89 | DIV | ✅ bg shift | — | ❌ | pointer | live |
| `.r` (inbox/draft row) | faithful.css:564-565 hover; styles.css root :active:190 | DIV | ✅ bg shift, has transition | ✅ (`:active` bg, root styles.css:190) | ❌ | pointer | live |
| `.chip` (filter tabs / lane switch) | styles.css:1004-1009 (no `:hover` anywhere) | SPAN | ❌ **none** | — | ❌ | **auto** (not even pointer) | live |
| `.wb-pane-x` (pane close ✕) | styles.css:137-138 | SPAN | ✅ color shift | — | ❌ | pointer | live |
| `.wb-ask` (Ask Claude) | styles.css:139-141 (only `:active` scale) | **BUTTON** | ❌ **none** | ✅ scale(.97) | ✅ native, ring renders | pointer | live |
| `.wb-modelbtn` | styles.css:669-672 | **BUTTON** | ✅ color shift | — | ✅ native, ring renders | pointer | live |
| `.csend` (composer send ↑) | ChatPane.tsx:436-445 (no CSS hover at all) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.ct-card` (content row) | faithful.css:564 hover, :1062 transition | DIV | ✅ bg shift, has transition | box-shadow `.wb-card-on` on select | ❌ | pointer | live |
| `.ct-f` (content facet chip, ×105 on Content) | styles.css:553-558 (no `:hover`) | SPAN | ❌ **none** | — | ❌ | pointer | live |
| `.ct-ac .btn` (Skip/Approve, ×38) | ReviewActions.tsx:53-54 — **`<div className="btn …">`, not `<button>`** | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.wb-sech.tap` (section toggle, ×14) | styles.css:170 (no `:hover`) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.ct-alert` (alert strip toggle) | styles.css:217-219 (no `:hover`) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.wb-ofresh` (Ops refresh row) | styles.css:467-468 (no `:hover`) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.sw` (settings toggle switch) | faithful.css:1445-1446 (no `:hover`) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.seg .sg` (Sends segmented control) | faithful.css:789-794 (no `:hover`) | DIV | ❌ **none** | — | ❌ | pointer | live |
| `.wb-fopt` (filter-pill dropdown option) | faithful.css:938-944 | BUTTON-ish markup, actual tag not confirmed live | ✅ CSS declares `:hover` bg (not in transition re-enable list → snaps) | — | not tested | pointer | CSS-only |
| `a` / `.ct-ref-l` / `.dd-link` | faithful.css:1393-1394 (underline, no hover) | A | native browser default only | — | ✅ native | — | CSS-only |

### The headline finding
**Focus is real but almost entirely unreachable.** Of the 17 non-native-button/link classes tested, **0 of 17 are keyboard-focusable** — every row, chip, nav item, section toggle, close button, switch, and the composer's own send button is a `<div>`/`<span>` with an `onClick` and no `tabIndex`/`role`/keyboard handler (confirmed by exhaustive grep: 0 `tabIndex`, 0 `role=` in all of `src/exp/v2c/*.tsx`). Tab key cannot reach the nav rail, cannot reach a single inbox/content row, cannot flip the Settings switch, cannot reach the message-send button. Only **2 real `<button>` elements** in the whole sample (`Ask Claude`, the model picker) get the correctly-implemented `:focus-visible` ring — everything else the global CSS rule was written for is structurally unreachable. This is a markup/semantics gap, not a CSS gap; the CSS focus ring itself is correct and matches the AA-verified 100% opacity call in the spine comment (faithful.css:345-347).

### Top 10 interactive classes missing hover feedback (mouse-visible, live-confirmed)
1. `.chip` — filter tabs (All/Ivan/Rise/Email) **and** the Content lane switch (Ivan/Mattan) — no hover, cursor is `auto` not `pointer` (worst offender: two different roles share this class)
2. `.ct-f` — content facet filter chips, **105 instances** on the Content route alone
3. `.ct-ac .btn` — Skip/Approve review-action buttons, **38 instances**, also not real `<button>`s
4. `.wb-ask` — the Ask Claude button (real `<button>`, has `:active` but no `:hover`)
5. `.csend` — composer send arrow (the primary send affordance in every chat turn)
6. `.wb-sech.tap` — collapsible section headers, **14 instances**
7. `.sw` — Settings toggle switch (a control class that especially wants hover/press feedback)
8. `.seg .sg` — Sends segmented control
9. `.ct-alert` — the alert-strip toggle (rare but high-attention surface)
10. `.wb-ofresh` — Ops board refresh row

---

## TASK C — Animation/transition inventory

| Selector | Property | Duration/easing | Note |
|---|---|---|---|
| `.wb.wb.wb *` (faithful.css:1061) | `transition` | `none` (blanket kill) | Base rule; everything below is a re-enable or an untouched pre-existing rule that is now dead. |
| `.ct-card, .r, .td-r.tap, .ov-tr, .wb-rj:hover, .ct-f, .wb-fpill, .btn, .chip` (faithful.css:1063-1066) | `background-color` | **100ms `cubic-bezier(.25,1,.5,1)`** (`--dur-hover`/`--ease`) | ✅ compliant, the approved token pair. Note `.wb-rj:hover` (not base `.wb-rj`) and `.ct-f`/`.chip` have no matching `:hover` background rule at all, so the re-enabled transition is dead weight for those two. |
| `.ov-gauge-fill, .ov-bar-fill, .td-bar-f` (faithful.css:1067-1069) | `transition:none` (explicit) | — | ✅ intentional, "animated width is banned (10.3)" comment. |
| `.ct-tap:active, .wb-ask:active, .wb-retry:active` (faithful.css:1070-1072) | `transform:none` (explicit) | — | Deletes the base app's press-squish (`scale(.97)`/`.99`) for exactly these 3 — but **not** `.wb-starter`, `.wb-mic`, `.wb-hf-orb`, `.wb-about-card.tap` (styles.css root/v2c), which still scale on `:active` (inconsistent — some press-squish survives, some doesn't, no stated rule for which). |
| `@keyframes wb-approve` / `wb-count-tick` (faithful.css:1079-1093) | `transform, opacity` | 200ms `--ease` | ✅ compliant shape (transform+opacity only, ≤250ms, one easing) **but DEAD CODE** — grepped all of `src/exp/v2c/*.tsx` and `src/screens/*.tsx`: no component ever applies `.wb-approving` or `.wb-ticked`. The one licensed choreographed beat in the whole spec is not wired to any interaction. |
| `@media (prefers-reduced-motion: reduce)` (faithful.css:1097-1101) | `transition/animation/transform: none!important`, then opacity-only fallback `linear` | 100ms | ✅ correct intent; fallback easing is `linear` (only exempted because it's the reduced-motion branch). |
| `.wb-rj{transition:background-color .14s ease,color .14s ease}` (styles.css:64) | dead — overridden by the blanket kill, never restored for base `.wb-rj` (only `.wb-rj:hover` got the re-enable, and per CSS transition rules that mostly animates the entry, not necessarily the exit) | — | asymmetric enter/exit fade risk, see census note above. |
| `.sw{transition:background .2s ease}`, `.sw-knob{transition:transform .2s ease}` (styles.css:248,251) | dead, not re-enabled | — | Settings switch now **snaps** on toggle instead of sliding — a likely unintended collateral loss from the blanket rule, not a documented decision. |
| `.wb-mic{transition:background-color .15s ease, box-shadow .1s linear, width .18s ease}` (v2c styles.css:370) | dead, not re-enabled | — | Losing the `width` animation is arguably correct per 10.3 (animating layout is banned); losing background/box-shadow alongside it looks incidental. |
| `.wb-meter-b{transition:background-color .08s linear}` (v2c styles.css:377) | dead | — | Voice meter bars now snap; likely harmless/even better for audio-reactive feedback. |
| `.wb-hf-orb{transition:box-shadow .1s linear, background-color .18s ease}` (v2c styles.css:398) | dead | — | Hands-free orb state now snaps. |
| **`.wb-th-dot{animation:sk-sh 1.3s ease-in-out infinite}`** (v2c styles.css:342-344) | `animation`, not `transition` — **survives** the blanket kill entirely | **1.3s, `ease-in-out`** | 🔴 **Standing, live violation**: exceeds the 250ms cap by ~5×, and uses a second easing curve (`ease-in-out`, not the approved cubic-bezier). This is the chat "thinking…" indicator, shown on every streaming turn — a genuinely frequent surface, not an edge case. Untouched by faithful.css. |
| `.sk::after{animation:sk-sh 1.3s ease-in-out infinite}` (root src/styles.css:231-232) | same keyframe, loading-skeleton shimmer | 1.3s, `ease-in-out` | Same violation, different surface (any loading list). Arguably a different category (indeterminate-loading affordance vs. interaction motion) but technically the same contract breach if read literally. |
| `.sheet-scrim{animation:scrim-in .18s ease}`, `.sheet{animation:sheet-up .24s cubic-bezier(.2,.85,.25,1)}` (root src/styles.css:207-210) | `opacity`/`transform` | 180-240ms, but **two different easing curves**, neither is `--ease` | Reached from v2c via `VoiceControl.tsx`'s hands-free sheet — pre-existing shared-app animation, unscoped to `.wb`, so faithful.css's reset cannot and does not touch it. A second/third easing curve is live in a real v2c-reachable surface. |
| `.ptr-spin.spinning{animation:ptr-rot .7s linear infinite}` (root src/styles.css:226-227) | `transform:rotate` | 700ms `linear`, infinite | Pull-to-refresh spinner; loading-indicator category, `linear` is a 4th easing keyword in play app-wide, unscoped. |

**Summary:** the *transition* half of the contract is mostly enforced correctly by the blanket-kill-then-allowlist pattern (dur/ease compliant where re-enabled). The *animation* half has 3 live, uncontained loops (`wb-th-dot`, `.sk::after`, `.ptr-spin`) that the blanket rule structurally cannot reach (it only zeroes `transition`, not `animation`), plus one dead licensed beat (`wb-approve`/`wb-count-tick`, never triggered), plus a hands-free voice sheet that imports two more easing curves wholesale from the un-scoped shared stylesheet.

---

## Files referenced
- Routes/layout: `/private/tmp/.../wt-faithful/src/exp/v2c/Shell.tsx`, `route.ts`, `layout.ts`
- CSS: `/private/tmp/.../wt-faithful/src/exp/v2c/faithful.css` (1549 lines), `styles.css` (698 lines), `/private/tmp/.../wt-faithful/src/styles.css` (738 lines, shared)
- Components checked for onClick/tabIndex/role: all of `src/exp/v2c/*.tsx`
- Hooks: `src/exp/v2c/useContentBadge.ts`, `src/hooks/useInbox.ts`, `src/lib/inbox.ts`, `src/exp/v2c/chat/transport.ts`
- Scout scripts (untracked, worktree-local): `scripts/_scout-errhover-console.mjs`, `_scout-errhover-chatsend.mjs`, `_scout-errhover-livecensus.mjs`, `_scout-errhover-livecensus2.mjs` + their `*-results.json`
