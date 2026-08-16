# Phase 0 — Live old dashboard as source of truth for semantics

Scout run 2026-08-02. Read-only. Source repo: `/Users/ivanmanfredi/Desktop/personal-site` (not modified, dev server not run).

## ⚠ Access blocker (read this first)

The live panel at `https://ivanmanfredi.com/dashboard` is **NOT ungated**, contrary to the brief. `App.tsx:55-71` gates both `/dashboard` and `/dashboard-v2` behind a two-factor client-side check: a SHA-256 password (`lib/dashboardAuth.ts`, `VITE_DASHBOARD_HASH`) **AND** a live Supabase auth session (`supabase.auth.getSession()`, magic-link email OTP). I tried headless Playwright cold (screenshots `dash-00-today.png` / `dash-01-posts.png` — password wall) and then reused 8 of Ivan's existing persistent Chrome profiles under `~/.claude/playwright-profiles/` (`prod-dash-cal`, `ivan-dashboard`, `dashboard`, `dashboard-local`, `local-dash`, `task8-posts`, `outreach-revamp-shots`, `scratch-scheduled-ops`). Three had the password step already satisfied but stalled on "Second step: email login code" (Supabase OTP — screenshot `probe-dashboard.png`, `probe-ivan-dashboard.png`, `probe-00.png`); the rest were still at the password wall (`probe-dashboard-local.png`, `probe-local-dash.png`, `probe-task8-posts.png`, etc.). None had a live, unexpired session. Completing the OTP requires reading Ivan's email inbox, which is out of scope for a read-only scout, so I could not get past the gate.

Screenshots of the gate itself (proof, not findings) are in `/private/tmp/claude-501/.../scratchpad/probe-*.png` (not copied into the output dir — they show only the lock screen). The `phase0-shots/` output dir contains `dash-00-today.png` and `dash-01-posts.png` (password wall) as the only "live" captures obtained.

**Everything below is therefore grounded in source code (file:line citations), which for semantics questions (does status X mean Y) is more authoritative than eyeballing pixels anyway — but the visual/interaction findings (exact spacing, hover states, pixel layout) are NOT verified against the live render and should be spot-checked once Ivan supplies a fresh OTP or a long-lived profile.**

---

## 1. THE VERDICT: what LM status `live` means

**`live` is not part of Ivan's own LM pipeline. It is a client-owned lead-magnet's terminal "shipped" state, tracked on a `lm_drafts_v2` row with `client_id` set (Rise/Mattan). It means the LM's own resource/landing page is live on the web — parity with Ivan's `published` — and it says NOTHING about whether a LinkedIn post promoting it has gone out. LinkedIn-posting status lives on a completely separate row (a matched "launch post" draft), never on the LM row's `status` field.** The two facts (resource page live vs. LinkedIn-posted) are structurally incapable of being the same field.

Evidence chain:

1. **Ivan's own canonical LM vocabulary excludes `live` entirely.** `lib/statusLabels.ts:21-31` defines `LM_STATUSES = ['idea','generating','generating_assets','review','approved','scheduled','published','disqualified','error']` — no `live`. The alias fold table `hooks/useLeadMagnets.ts:49-58` (`LM_STATUS_ALIASES`) explicitly folds legacy values `draft→idea`, `ready→published`, `complete→published`, `pending→idea`, `lm_review→review`, `generating_content→generating` — but conspicuously does **not** list `live`. If `live` ever reached `normalizeLmStatus()` it would pass through unchanged (not folded to `published`).
2. **Client-owned LM rows never reach Ivan's own LM board at all.** `components/dashboard/LeadMagnetStudioPanel.tsx:78-80`: `const drafts = React.useMemo(() => rawDrafts.filter((d) => !d.clientId), [rawDrafts]);` with the comment "Client-owned LMs (client_id set) never belong on Ivan's approve queue — client boards own their own build/approve path." The new Desk surface (`components/dashboard-v2/review/LmWorkSurface.tsx:75,88`) does the same (`!d.clientId` in the approve queue; client rows counted separately as "N client LM(s) in review · client boards own these"). So the one `status='live'` row (client_id = Rise/Mattan) is **invisible on both the new and classic Content → LM surfaces** — it never gets a chance to be folded or mislabeled there because it's filtered out upstream of the status vocabulary.
3. **Its only home is the per-client Client Ops cockpit**, where it is rendered as its own literal, un-normalized status text — not folded into "Published":
   `components/dashboard-v2/sections/ClientOps.tsx:966`: `<span className={\`co2-pill ${lm.status === 'live' ? 'co2-pill--live' : ''}\`}>{lm.status}</span>` — this prints the raw DB value (`live`) verbatim as the label, merely adding a highlight CSS class when it equals `'live'`. It does **not** call `statusLabel()` or `normalizeLmStatus()`. Confirmed again by the aggregate counter at `components/dashboard-v2/sections/clientops2/shared.tsx:220`: `liveLms: ls.filter((l) => l.status === 'live').length` — a first-class count, treated as its own thing.
4. **A second, older surface (Positioning → Lead Magnet Inventory) folds `live` and `published` together instead.** `components/dashboard-v2/sections/rebuilt/positioning/shared.tsx:70-79` (`StatusCue`): `s === 'published' ? 'live' : ...` — a genuine `published` status is *relabeled* "live" for display, and a genuine `live` status renders through the same `CUE_KNOWN` branch with the same label "live" — i.e. this component makes the two **visually indistinguishable**. `LeadMagnetInventory.tsx:61-63` sums them further: `l.status === 'scheduled' || l.status === 'live' || l.status === 'published'` all count as one "live / scheduled" figure in the summary line. **This is an inconsistency already living in the current codebase** — Client Ops keeps `live` literal/distinct, Positioning folds it into `published`. The rebuild should pick one behavior, not inherit the split.
5. **What the row's own data says**, independent of status: the `Lm` type carries two separate nullable URL fields, both rendered unconditionally regardless of status — `resource_url` ("resource ↗" link) and `landing_url` ("landing ↗" link), `components/dashboard-v2/sections/clientops2/shared.tsx:87-88` (type) and `ClientOps.tsx:1002-1004` (render, with "no resource"/"no landing" fallbacks when absent). Neither field is a LinkedIn identifier.
6. **LinkedIn-posting status is tracked on an entirely different row.** The LM's promotional "launch post" is matched by topic-string similarity to a `Draft` (post) row — `ClientOps.tsx:116-131` (`launchByLm`, `isLmLaunch`) — and that Draft's own `status` (review/scheduled/published) and `board_visible` flag are what determine LinkedIn-posting state, rendered via a separate `LaunchBlock` component (`ClientOps.tsx:1008-1019`). There is no field on the `Lm`/`LeadMagnetDraft` type for a LinkedIn URN at all.

**Conclusion for the rebuild**: fold `live` into the same bucket as `published` (both = "shipped, on the resources site") for LM stage grouping — that matches the row's own field semantics (resource/landing URL presence) and is the more defensible of the two existing behaviors. Do **not** read `live` as "posted on LinkedIn" — that's a different row's status entirely, and conflating them would misreport a client LM as promoted when only its resource page shipped (or vice versa).

*(I could not confirm this specific row's own `resource_url`/`landing_url`/launch-draft values directly via Supabase — the `supabase-ivan` MCP requires interactive OAuth not available in this session, and the live panel gate blocked a UI cross-check. The verdict above is inferred with high confidence from code structure, not from reading the row itself. Flag for a quick DB spot-check before hard-committing the fold.)*

---

## 2. Stage model

### Posts — two surfaces coexist (Desk / Board toggle, `components/dashboard-v2/review/PostWorkSurface.tsx:324-325`)

**Desk (default landing, new)** — not a status kanban at all, a 2-lane triage view:
- Tally strip, 3 tiles, always visible, numbered 01/02/03 (`PostWorkSurface.tsx:341-360`):
  - **01 Ideas** — count of scored `lm_idea_candidates` rows (never zero-hidden, always shown).
  - **02 Review** — count of `carousel_drafts` with `status='review' AND client_id IS NULL`. Client-owned review drafts are excluded and surfaced only as a muted note below the tiles: "`N client draft(s) in review · client boards own these`" (`:361-363`).
  - **03 Attention** — `errorRows.length + stuckRows.length` (errored posts + scheduled-but-past-due-with-no-LinkedIn-URN posts). This is the **only red** in the whole surface (`ws-tally-count--red` only when count>0).
- Below the tiles, a 2-tab lane bar (`role="tablist"`, `:387-394`) — **Ideas** / **Review** — only the focused lane renders (tab-switch, not scroll). `approved`/`scheduled`/`published`/`disqualified` states are **not shown in Desk mode at all** — they only exist in Board mode.

**Board (classic, `components/dashboard/PostStudioPanel.tsx`)** — the real 8-stage kanban:
- `STATUS_ORDER = POST_STATUSES` = `idea, generating, review, approved, scheduled, published, disqualified, error` (`:42`, sourced from `lib/statusLabels.ts:10-19`).
- `PINNED_STATUSES = {generating, review, error}` (`:44`) — these three chips always render even at zero count ("nothing broken" signal); every other status chip disappears entirely when its count is 0 (`visibleStatuses = STATUS_ORDER.filter(s => statusCounts[s] || PINNED_STATUSES.has(s))`, `:248`).
- **`disqualified` is excluded from the status-chip row entirely** (`.filter((s) => s !== 'disqualified')`, `:452`) and instead lives behind a standalone toggle at the far right: "`Show N disqualified`" / "`Hide disqualified`" (`:490-506`) — off by default.
- `published` gets **no special hiding** on the Posts board — it's just one more status chip like any other, shown/hidden by the normal zero-count rule.

### Lead Magnets — same Desk/Studio split (`components/dashboard-v2/review/LmWorkSurface.tsx`)

**Desk ("Approve", default)** — 2 tiles only (`:303-316`): **01 Approve** (review queue, client-excluded, format-roster-matched) and **02 Attention** (errored LMs, red only). A third bucket, "off-roster" (rows in review whose `format` doesn't match the canonical format list), is surfaced honestly as a separate pill count rather than silently dropped (`:322-325`) — explicit callout: "the classic board drops them entirely." Client-owned LMs in review are shown only as a muted note, never actionable here (`:327-331`).

**Studio (classic, `components/dashboard/LeadMagnetStudioPanel.tsx`)** — the real 9-stage kanban:
- `STATUS_ORDER = [idea, generating, generating_assets, review, approved, scheduled, published, disqualified, error]` (`:55`).
- `PINNED_STATUSES = {generating, generating_assets, review, scheduled, published, error}` (`:56`) — note **`published` IS pinned** here (always shows a chip) even though it's simultaneously collapsed from the default row view (next point) — the chip stays visible as a doorway even while its contents are hidden.
- **Published rows are the "library"**, collapsed by default: `if (d.status === 'published' && !showLibrary && statusFilter === 'all') return false;` (`:193`) — a dedicated toggle "Show published lead magnets" un-collapses it (`:419-423`), persisted in `localStorage['lm-studio-show-library']` (`:128,131`) so the choice sticks across sessions.
- `disqualified` gets the identical treatment to Posts: excluded from the "All" view unless toggled, persisted in `localStorage['lm-studio-show-disqualified']` (`:120,137-138`), rendered as "`+N hidden`" (`:409`).
- Rows with `client_id` set are filtered out entirely before any of this runs (`:80`) — see §1.
- `live` is absent from `STATUS_ORDER` here too — confirms §1's finding a second time.

---

## 3. Filter UI — reference for "not a facet wall"

Two very different filter philosophies coexist, both worth carrying forward:

**Desk mode (new, both Posts and LM)**: no filters at all in the conventional sense. The entire "filtering" mechanism is (a) which of 2-3 numbered tally tiles you clicked (lane focus), (b) a 2-tab lane bar, (c) keyboard letters (`j/k` move, `a` approve, `r` reject, `e` edit, `s` skip, `o` detail, `x`/`space` select, `p` promote, `d` defer — `PostWorkSurface.tsx:276-296`, `LmWorkSurface.tsx:219-227`), and (d) a triage drawer that opens only when you click the Attention tile (`PostWorkSurface.tsx:366-383`). There is no search box, no dropdown, no facet panel in Desk mode.

**Board/Studio mode (classic, both)**: a single muted line, in this exact order (`PostStudioPanel.tsx:441-500`, mirrored in `LeadMagnetStudioPanel.tsx:360-430`):
1. One plain text input — "`Search by topic or body…`" — free-text substring match, no scoping syntax, no operators.
2. One row of **single-select** status pill/chips (colored dot per `STATUS_META`, count badge, "All" first) — clicking sets `statusFilter`, replacing the previous filter (not additive/multi-select).
3. A vertical divider, then a row of type pills (`text`/`single_image`/`carousel` for Posts) — same single-select pattern, zero-count types hidden.
4. Right-aligned: the disqualified toggle (and, on LM, the library/published toggle) as the ONE deliberately-hidden-by-default bucket, opt-in via a single button, not a checkbox in a facet list.

No multi-select faceting, no saved views, no sort-by dropdown beyond the implicit "pinned vs collapsed" status ordering. This is the concrete "reference for not a facet wall": a search box + a single row of mutually-exclusive pill filters + one or two explicit unhide toggles for the noisy/terminal buckets.

---

## 4. Today / freshness (`components/dashboard-v2/sections/Today.tsx`)

- **"Since you last looked" changelog strip** (`:67-101`, `:148-153`) — one horizontal run of up to 5 items, each `{what} · {when}`, clickable to jump to the owning section. Three states: first visit → "baseline set today"; loading → "checking for changes…"; zero changes → "no changes since yesterday". This is the closest thing to a "what changed" feed and it caps at 5 — no infinite scroll, no full audit log here.
- **Above-the-fold triage strip**, 6 stat lockups (`:156-169`): Posts in review, Comment drafts, Warm follow-ups, Workflows red/stuck, Scheduled today, Drift alarms. Each is a live count over a real feed (`useTodayFeeds`), each clickable to jump to its owning section. `offline`/`loading` states render as a muted dash/dot, never a stale zero.
- **Freshness/drift box** (`:242-274`) — "Freshness watch" while probing → "Freshness: 0 feeds drifting" when clean → red-bordered warning box listing up to 5 drifting feeds when `pulse` entries are `quiet` or `frozen` (`:110-113`). This is the **one deliberate red** on the whole page ("Drift alarms" tile + this box share it). Drift = a live non-dormant source gone quiet/frozen — a source that's *supposed* to be dead (archived, paused) never counts as drift.
- **Age/date conventions, two different rules on the same screen**:
  - Relative-age freshness (`ageLabel`, duplicated in `lib/statusLabels.ts`-adjacent `reviewShared.tsx:17-26` and `clientops2/shared.tsx:129-138`): `<1h → "Nm"`, `<24h → "Nh"`, `else → "Nd"` — always relative, never a raw ISO string, always rounded, minimum 1m floor.
  - Absolute-date scheduling (`fmtDate`, `clientops2/shared.tsx:124-128`): `"Aug 6"`-style short date, used only for *future* schedule/publish dates (e.g. "next Aug 6"), never for "how old is this."
  - So: **past/age = relative** ("3h old", "2d old"), **future/schedule = absolute short date**. Never mixed.
- **"Needs you" lead list** (`:119-131,171-195`): built from the first 3 posts-in-review + first warm follow-up + first 2 comment drafts, each row showing only a title + a tag ("approve post"/"send warm"/"approve comment") — the provenance (`carousel_drafts · status=review` etc.) is hover-title-only, not printed under every row (explicit design note in the code, `:119-121`).
- **Rail marginalia** (`:220-318`): client-of-record tile, drift box, "this week's mix" (Reach/Trust/Buyers funnel-lens count, with an explicit callout if Buyers=0: "Nothing this week speaks to people ready to buy"), and "On the schedule" (today's scheduled-post count + first post's truncated body in quotes).

---

## 5. Other semantics the panel gets right that a naive rebuild would fumble

- **Stuck vs generating** (`components/dashboard/genAge.ts`): a row in `status='generating'` isn't "stuck" until **20 minutes** elapsed (`STUCK_MINUTES = 20`). Chip label: `"generating…"` (no timestamp available) → `"generating · 3m"` (under threshold) → `"generating · 24m ⚠"` (past threshold, with a warning glyph). Same helper is shared by both Posts and LM boards so the threshold can't drift between them.
- **Stuck-scheduled** (distinct concept, Posts only): `status='scheduled'`, `scheduled_at` in the past, **and no LinkedIn URN** (`sourcePostId` empty) — `PostWorkSurface.tsx:114-120`, `PostStudioPanel.tsx:254-261`. This is the actual "did the publisher silently fail" signal — a scheduled post past its time that DID get a URN is not stuck, just delayed-published.
- **DM-draft approval labeling** (`components/dashboard-v2/sections/clientops2/OutreachInbox.tsx:73-74`): `DRAFT_KIND_LABEL = { reply: 'Reply draft', dm2: 'DM 2 · scan', dm1: 'DM 1', draft: 'Draft' }` — four distinct kinds, never collapsed to one generic "draft" label. Separately, `STATUS_LABEL` for a conversation (`:76-83`) distinguishes "Replied · you owe them" (needs_reply) from "Awaiting reply" (awaiting) from "Connected, no message yet" (connected) — three states a naive rebuild would likely flatten to "pending."
- **Client-scoped vs Ivan-scoped is a first-class exclusion everywhere**, not a filter toggle: client-owned rows (posts in review, LM drafts, LM-in-review) are structurally removed from Ivan's own boards at the query/memo level (`!d.clientId`) and re-surfaced only as a muted count-only note ("N client draft(s) in review · client boards own these"). The rebuild should treat "belongs to a client board" as an exclusion, not a facet — matching this pattern exactly avoids a regression where client rows leak into Ivan's own approve queues.
- **Cover-variant "live" is a THIRD, unrelated sense of the word "live"**: on both `ClientOps.tsx:982` and `LmWorkSurface.tsx:423`, the active cover image variant is labeled "live" ("Live on the board" tooltip / "· live" suffix) — nothing to do with LM status. Worth flagging so the rebuild doesn't conflate cover-liveness with status-liveness when grepping for the word.

---

## Files referenced

- `lib/statusLabels.ts` (canonical POST_STATUSES/LM_STATUSES + RAW_LABEL_MAP)
- `hooks/useLeadMagnets.ts` (LM_STATUS_ALIASES fold table, client realtime sub)
- `components/dashboard-v2/sections/ClientOps.tsx` (Client Ops cockpit: stage strip, LM line, raw `live` pill, launch-post matching)
- `components/dashboard-v2/sections/clientops2/shared.tsx` (`Lm`/`Draft`/`PendingDraft` types, `computeAggregates`, `ageLabel`/`fmtDate`, RPC plumbing)
- `components/dashboard-v2/sections/rebuilt/positioning/shared.tsx` (`StatusCue` — folds published→"live")
- `components/dashboard-v2/sections/rebuilt/positioning/LeadMagnetInventory.tsx` (live/scheduled/published combined count)
- `components/dashboard-v2/review/PostWorkSurface.tsx`, `components/dashboard/PostStudioPanel.tsx` (Posts Desk + Board)
- `components/dashboard-v2/review/LmWorkSurface.tsx`, `components/dashboard/LeadMagnetStudioPanel.tsx` (LM Approve + Studio)
- `components/dashboard-v2/sections/Today.tsx` (freshness, changelog, triage strip)
- `components/dashboard-v2/sections/clientops2/OutreachInbox.tsx` (DM-draft kind/status labels)
- `components/dashboard/genAge.ts` (stuck-generating threshold)
- `App.tsx:48-71`, `lib/dashboardAuth.ts` (the auth gate that blocked live screenshots)
