# Phase 1(d) — ivan-inbox app architecture map

Read-only audit. Repo root: `~/Desktop/ivan-inbox`. All citations are `file:line` against the repo as read on 2026-07-31. Deploy target: `https://ivanmanfre.github.io/ivan-inbox`, built by `.github/workflows/deploy.yml`.

---

## 1. Tab/navigation model

**The `Tab` type is declared twice, independently** — `src/App.tsx:22` and `src/components/TabBar.tsx:1` both define `type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings' | 'today'` with no shared source. **A new tab requires editing both files in lockstep** plus `src/lib/route.ts:1-2` (`TABS` array), or the hash router silently no-ops on the new tab's hash and `parseHash` returns `null` (`src/lib/route.ts:26-31`).

Route scheme (`src/lib/route.ts`):
- Hash-only mini-router, no history library. `parseHash(hash)` (`route.ts:13-32`) returns `{ tab?: Tab; thread?: string } | null`.
- `#access_token...` is explicitly ignored (`route.ts:15`) — reserved for Supabase's implicit-flow auth fragment.
- `#thread/{prospect_id}` → `{ tab: 'inbox', thread: <decoded id> }` (`route.ts:17-23`); supports URL-encoded ids (`route.test.ts:47-50`, e.g. slashes/question-marks in an id).
- A bare `#<tabname>` → `{ tab }` only if `TABS.includes(t)` (`route.ts:25-28`); unknown hashes return `null` and are ignored, never crash.
- Consumed in `App.tsx:73-89` (`Shell`'s `useEffect`): on mount and on every `hashchange`, `applyHash()` sets `tab`/`openThread` state. Deep links (push notifications, morning-brief edge fn) point at `./#thread/<id>` or `./#today` (`supabase/functions/inbox-push/index.ts:28`, `supabase/functions/inbox-morning-push/index.ts:33`) — **relative, no leading slash**, because a leading `/` resolves to the GH Pages user-root and the app never loads (comment at `inbox-push/index.ts:26-27`).
- Outbound nav writes back via `history.replaceState(null, '', '#'+t)` (`App.tsx:94`), gated so it never stomps an in-flight `#access_token` fragment (`App.tsx:94`).

**Adding a tab, concretely:**
1. Add the tag to both `Tab` unions (`App.tsx:22`, `TabBar.tsx:1`) and to `TABS` in `route.ts:2`.
2. Add a `<TabBar>` entry (icon glyph + label) — see layout constraints below.
3. Add the screen's render branch in `App.tsx`'s `listScreen` JSX (`App.tsx:112-137`) **and** in the desktop `dt-full` branch if the new tab has no thread/conversation pane (`App.tsx:147-153`, currently `sends`/`ops`/`today`).
4. If badge-worthy, fold its pending-count into `draftCount` (`App.tsx:67`) — the single badge number is deliberately unified across DM drafts and Ops (comment at `App.tsx:65-66`).

**TabBar layout constraints** (`src/components/TabBar.tsx:6-34`, CSS `styles.css:84-91`):
- Fixed flex row, `flex:1` per item, no scroll — **6 tabs is the current count** (today, inbox, drafts, sends, ops, settings) and each gets equal width. There is no overflow/"more" affordance; a 7th tab visually shrinks all of them rather than scrolling.
- Icon system: single Unicode/glyph characters at 22px (`.tb .ic`, `styles.css:87`), not an icon library/SVG set — e.g. `☼` Today, `◉` Inbox, `✦` Drafts (also doubles as the "bubble" badge host), `↑` Sends, `◈` Ops, `⚙︎` Settings (`TabBar.tsx:9,13,17,21,25,29`). A new tab needs a glyph in this same register (no imported icon set exists in the repo — confirmed via `package.json:13-17`, no icon lib dependency).
- Desktop reflows the same `TabBar` into a vertical left rail via CSS only (`styles.css:284-288`, `.app.dt .tabbar{flex-direction:column;width:86px}`) — same component, same 6 items, just re-flowed; no separate desktop nav component.
- Badge: only `drafts` carries a numeric badge today (`TabBar.tsx:16-19`, `.cnt` pill, `styles.css:90-91`), sourced from `draftCount` in `App.tsx:67`.

---

## 2. Auth

**Provider:** Supabase Auth, email OTP (`src/screens/LoginScreen.tsx`). Two paths from one email field:
- 6-digit code: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` (`LoginScreen.tsx:11-15`) then `supabase.auth.verifyOtp({ email, token: code, type: 'email' })` (`LoginScreen.tsx:24-27`).
- Magic link: same `signInWithOtp` call with `emailRedirectTo` set to the app's own origin (`LoginScreen.tsx:16-23`) — lands back on the PWA via the `#access_token` fragment that `route.ts` explicitly skips.
- `shouldCreateUser: false` means **this is a closed allow-list** — only pre-existing Supabase auth users (i.e., Ivan) can ever get in; no self-signup path exists in this client.

**Session/client setup** (`src/lib/supabase.ts`):
- `flowType: 'implicit'` (not PKCE) specifically because a magic link opened in Safari must still work even though the installed PWA's storage is partitioned from Safari — PKCE's `code_verifier` would live in the wrong storage context and fail (`supabase.ts:10-14`).
- `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true` (`supabase.ts:7-16`).
- Calls `navigator.storage.persist()` proactively to fight iOS Safari's 7-day ITP storage-eviction cap (`supabase.ts:21-24`).

**Session gating in `App.tsx`:**
- Top-level `App()` blocks all render until `supabase.auth.getSession()` settles (`App.tsx:27-28,52`); renders `<LoginScreen/>` if no session, else mounts `<Shell/>`.
- On PWA resume (`visibilitychange` → `visible`), re-validates: restores the session if still live, else calls `refreshSession()`; **a failed/empty refresh explicitly nulls the session** rather than leaving stale truthy state that would silently degrade Supabase-js to the anon key under the hood (`App.tsx:32-44`, comment explains the trap).

**What session the data reads run under:** every `lib/*.ts` module reads through the same singleton `supabase` client (anon key + whatever JWT is attached from `persistSession`). There is **no separate service-role path in the client** — the anon key (`VITE_SUPABASE_ANON_KEY`, baked at build time by `.github/workflows/deploy.yml:13-15`) is the only key ever shipped to the browser. Two edge functions are called directly with `Authorization: Bearer <user JWT>` + `apikey: <anon key>`:
- `get-morning-brief` (`src/lib/today.ts:277-303`) — explicitly **never** via `supabase.functions.invoke()` because that helper attaches an `X-Client-Info` header the function's CORS policy rejects (comment `today.ts:6-8`); one `refreshSession()` retry on a 401 before falling back to cached data.
- `rise-comment-reply` (`src/lib/ops.ts:148-169`) — the one write path in the app that publishes externally (see §4).

**RLS / authenticated vs anon:** the brief edge function (`get-morning-brief`) **auth-gates its own response shape** — a call that resolves to an anon-equivalent session gets back the smaller "counts" shape instead of the full payload (`today.ts:126-139`, `isCountsShape`), and the UI renders this as a `degraded` banner rather than crashing (`today.ts:81-94`, `TodayScreen.tsx:583-587`). This is the one place in the app where the *shape of the response* — not an HTTP error — signals an authorization boundary. All other tables/views (`outreach_messages`/`inbox_messages_v`, `ops_drafts`, `outreach_prospects`, `scans`, KPI views, `integration_config`) are read straight through PostgREST with no equivalent degraded-shape handling visible in the client code — meaning their RLS posture (if any) is opaque to this audit from the client alone; a live per-table probe (Phase 1e / access matrix) is the only way to know whether they're readable to `anon` or require the authenticated JWT.

---

## 3. Data layer conventions

**Hook pattern** (consistent across `useInbox`, `useOps`, `useSeatHealth`, less so `useToday`):
1. `useState` for the fetched shape + a `loading` flag.
2. A `refresh` `useCallback` that calls the matching `lib/*.ts` fetcher, `.then(setState).catch(() => setLoading(false))` — errors are swallowed to `loading:false`, not surfaced as an error string, in the simple hooks (`useInbox.ts:13-23`, `useOps.ts:15-20`, `useSeatHealth.ts:6-7`).
3. `useEffect` on mount: call `refresh()`, open a Supabase Realtime channel (`useInbox`/`useOps` only) subscribed to `postgres_changes` on the relevant table, **and** a `window.addEventListener('focus', refresh)` — belt-and-suspenders (realtime for while-open, focus-refetch for backgrounded-then-resumed). Cleanup unsubscribes both.
4. `useOps` specifically namespaces its realtime channel per-mount with `useId()` (`useOps.ts:14`) because `supabase.channel(topic)` returns the *existing* channel object for a topic already held — two `useOps()` call sites sharing one channel would throw on the second `.on()` bind and blank the whole tree, and one unmounting would rip the channel out from under the other (comment `useOps.ts:8-13`).
5. `useSeatHealth` has no realtime — it only focus-refetches, because the guard behind it only writes every ~2h (`useSeatHealth.ts:4-5`).
6. `useToday` is the outlier: no realtime, no simple focus-refetch — it's a two-tier fetch (fast `counts` mode + slow `full` mode that round-trips through n8n and takes ~12s), paints synchronously from a `localStorage` cache on mount (`today.ts:44-49`), and throttles focus-refetch to once per 60s (`useToday.ts:41,120-127`) because the full call is expensive.

**Pull-to-refresh** (`usePullToRefresh.ts`): a from-scratch touch-gesture hook (no library), engages only when the scroll container is already at `scrollTop<=0`, 64px trigger / 92px cap / 0.5 resistance (`usePullToRefresh.ts:7-9`), used identically by every list screen (`InboxScreen`, `DraftsScreen`, `OpsScreen`, `SendsScreen`, `TodayScreen`) paired with `<PullIndicator pull refreshing trigger>` (`components/PullIndicator.tsx`).

**`lib/*.ts` module shape:** each file owns one domain (`inbox.ts`, `ops.ts`, `today.ts`, `kpis.ts`, `sends.ts`, `seatHealth.ts`, `context.ts`, `push.ts`, `chime.ts`) and mixes three kinds of exports in the same file: (a) types mirroring a DB row/view shape, (b) **pure functions** (filtering/sorting/grouping/formatting — e.g. `pendingOps`, `groupThreads`, `buildLanes`, `rollupReplies`) that take rows in and return derived rows out with zero I/O, and (c) `async function fetch*()`/`approve*()`/`discard*()` I/O wrappers that are thin `supabase.from(...).select/update/insert` calls, always `if (error) throw error`. The pure functions are what's unit-tested; the I/O wrappers generally aren't (no mocking layer in the repo for supabase-js).

**Test conventions** (`vitest.config.ts` + `src/test-setup.ts`):
- `vitest run`, no jsdom/DOM environment configured — tests are pure-function unit tests against `lib/*.ts` exports, described with nested `describe`/`it` blocks, one behavior per `it`, and comments in the test explaining the *real historical incident* the assertion guards against (e.g. `ops.test.ts:79-84` explains why weekly_report must stamp both `approved_at`+`sent_at` together, referencing a real bug shape).
- `src/test-setup.ts:1-8` stubs a bare `globalThis.WebSocket` class because Node's test runner has no native WebSocket and `supabase-js`'s realtime client needs the constructor to exist at `createClient()` time — otherwise importing anything that transitively imports `lib/supabase.ts` throws before any test runs.
- One DOM-touching test exists: `Linkified.test.tsx` renders via `renderToStaticMarkup` (react-dom/server), not a browser/jsdom (`Linkified.test.tsx:1-8`) — confirms the repo avoids a DOM test dependency entirely.
- Fixture convention: literal ISO timestamps in 2026-07 (matching "now" in this project), a `base`/`row()`/`mkC()` factory object spread with overrides per test file (`ops.test.ts:4-8`, `sends.test.ts:4-8`).

---

## 4. Ops tab in detail (`OpsScreen.tsx` + `lib/ops.ts` + `useOps.ts`)

**Source of truth:** single table `ops_drafts` (`ops.ts:110-117`, `fetchOpsDrafts` — `select('*').order('created_at',desc).limit(300)`), realtime-subscribed via `useOps` (`useOps.ts:23-24`, `event:'*' schema:'public' table:'ops_drafts'`).

**Row shape** (`ops.ts:61-72`, `OpsDraft`): `id, client_id, kind, slack_channel, body, context (jsonb), created_at, approved_at, sent_at, send_blocked_reason`. `context` is untyped/loose (`OpsContext`, `ops.ts:8-41`) because its shape varies per `kind`.

**Card kinds** (`ops.ts:3`, `OpsKind`) and what each renders/does:

| kind | label/color (`OpsScreen.tsx:30-33`) | context shown (`ContextLine`, `OpsScreen.tsx:41-101`) | approve action | discard consequence |
|---|---|---|---|---|
| `escalation` | ESC / red `#FF453A` | prospect name · company, replay tag | `approveOpsDraft` → stamps `body`+`approved_at`; n8n dispatcher posts to Slack within ~2min (`ops.ts:122-127`, `OpsScreen.tsx:168-180`) | won't post to that Slack channel |
| `update` | UPDATE / blue `#0A84FF` | receipts array joined | same as escalation | same |
| `newsjack` | NEWSJACK / amber `#FF9F0A` | headline (linked to `source_url`) + countdown from `expires_at` (`expiresIn`, `ops.ts:52-59`) | same write path, but semantically "take the next publish slot" — approving **writes the post now and swaps it into the engine's next publish slot, bumping whatever was there to the next open weekday** (`OpsScreen.tsx:170-172`) | "won't be written or scheduled" |
| `weekly_report` | WEEKLY / green `#30D158` | week + replied/calls/engagers/impressions counts (zeros always printed, never hidden — `OpsScreen.tsx:58-64`) + link to the report page | **no dispatcher exists behind this kind** — approve copies `body` to clipboard via `navigator.clipboard.writeText` *then* stamps `approved_at`+`sent_at` together in one write (`approveWeeklyReport`, `ops.ts:178-184`); Ivan pastes it to the client himself. Clipboard write happens first so a blocked clipboard leaves the card recoverable (`OpsScreen.tsx:159-161`) | page stays live, just stops reminding |
| `comment_reply` | COMMENT / purple `#BF5AF2` | author name/headline, quoted comment text, category chip, link to the post | **the only kind that publishes externally.** See below. | comment stays on the post, stops reminding |

**`comment_reply` — the external-publish action, in full:**
- Client side (`ops.ts:144-169`, `OpsScreen.tsx:122-147`): grabs the current session's `access_token`, `fetch()`s `${VITE_SUPABASE_URL}/functions/v1/rise-comment-reply` with `{ ops_draft_id, body }`. Two sub-cases in the UI: an **"escalated comment"** (`isEscalatedComment = isComment && !draft.body.trim()`, `OpsScreen.tsx:118`) has no draft on purpose — approve just calls `markCommentHandled` (`ops.ts:174-176`, which is literally `approveWeeklyReport(id,'')` reusing the same double-stamp path) with copy "Mark this handled? Nothing is posted."; a real comment draft's approve copy is explicit: **"Goes live on LinkedIn under their comment, from the client seat. Checks first that they have not already been answered."** (`OpsScreen.tsx:128-133`).
- Server side (`~/Desktop/ivan-listener/supabase/functions/rise-comment-reply/index.ts` — lives in a **separate repo**, `ivan-listener`, not `ivan-inbox`): posts from the *client's* UniPile seat, holds `UNIPILE_KEY` server-side only, and enforces (per its own header comment, lines 6-19):
  1. **Never post without a fresh re-read** — the freshness gate (detailed below).
  2. Never post twice — `sent_at IS NOT NULL` on the row is refused outright (409, `index.ts:83`).
  3. Never post an empty body.
  4. Reply **threaded** via `comment_id` in the write body (`index.ts:139`) — omitting it would post a stray top-level comment on the client's own post.
- Auth check on the edge function: decodes the JWT payload (no signature re-verification client-side, but the gateway already validated the signature) and requires `role` to be `authenticated` or `service_role` — an anon key alone cannot reach this path (`index.ts:62-70`).

**The freshness re-read gate** (`rise-comment-reply/index.ts:98-133`, function `alreadyAnswered`):
1. Cheap check first: if the stored `client_post_comments` row already has `client_reply_text` or `answered_by_client=true`, treat as answered — no network call (`index.ts:103`).
2. If not, **live re-read**: calls UniPile's `GET /posts/{post_urn}/comments?comment_id={threadId}` where `threadId` is the **parent** comment id if this card is itself a reply, not the row's own id — because if it asked for replies to the row itself and the row *is* the reply, the client's real answer sits one level up under the parent and the query would come back empty, waving the duplicate post straight through (`index.ts:106-110`, comment explains this exact failure mode).
3. Filters live comments for `author_details.id === MATTAN_ID` (a hardcoded LinkedIn member id, `index.ts:27`) — if any exist, records what he actually said back into `client_post_comments` (so every other surface stops carding this thread) and returns `"live"` (answered).
4. **Fail-closed on error:** if the live re-read call itself throws, the function returns `502` with `"freshness check failed, nothing posted"` — it does **not** fall through to posting (`index.ts:122-126`).
5. If answered (either source), the `ops_drafts` row gets `send_blocked_reason:'already_answered_on_linkedin'` and the client sees `{posted:false, reason:'already_answered'}`, rendered in `OpsScreen.tsx:141` as *"Mattan already replied to this one, so nothing was posted. Card cleared."*
6. Only after the gate clears does the function POST the actual reply, then stamp `ops_drafts.sent_at`/`approved_at` **after** the LinkedIn post succeeds — deliberately, so a stamp-write failure leaves a live-but-"unsent-looking" card rather than risking a double post on retry (comment `index.ts:149-151`).

**Section grouping in the UI** (`ops.ts:80-108`, rendered `OpsScreen.tsx:311-338`):
- `pendingOps` — nothing stamped yet (no `approved_at`/`sent_at`/`send_blocked_reason`) **and** not a stale `comment_reply` — comment cards age out at `MAX_COMMENT_AGE_DAYS = 4` measured off `context.posted_at` (`ops.ts:135-142`; unknown age is never treated as stale, `ops.ts:140`). These render as the actionable `PendingCard` list.
- `claimingOps` ("Working") — approved but not yet sent, newest-approval-first; this is where a newsjack sits while it generates/QA-gates (can run up to an hour) and where a Slack card sits for ~2 minutes (`ops.ts:85-92`).
- `sentOps` ("Done") — `sent_at` set, newest-first, capped to 10 (`ops.ts:95-100`).
- `blockedOps` ("Blocked") — `send_blocked_reason` set **and not** the operator-discard sentinel `DISCARDED_REASON = 'discarded_by_operator'` (`ops.ts:76,104-108`) — an operator-initiated discard is deliberately invisible everywhere, never resurfaced as "blocked" (comment `ops.ts:74-75`).
- Collapsible `<Section>` (`OpsScreen.tsx:272-285`) renders nothing at all if `count===0` — no empty-state chrome for the secondary groups, only the primary pending list gets an explicit "Nothing waiting on you." empty state (`OpsScreen.tsx:319`).

---

## 5. Design language — "rules a new screen must follow to look native"

Tokens (`styles.css:1-16`): CSS custom properties on `:root`, swapped wholesale under `:root[data-theme='light']` — `--bg`, `--surface`/`--surface2`/`--surface3` (three elevation steps), `--text`/`--text2`/`--text3` (three opacity steps via `rgba`), one `--accent` (`#10A37F`, teal-green, used identically for "live"/"good"/"clear" everywhere), `--blue` (`#0A84FF`, used for links + one severity tier), `--sep` (hairline dividers). Severity is a **fixed 3-color vocabulary reused everywhere**, not per-screen: `#10A37F` live/good, `#FF9F0A` slowing/warn, `#FF453A` stale/bad/urgent (declared as `SEV`/`STATUS`/`SEV_COLOR` locally in `TodayScreen.tsx:20`, `SendsScreen.tsx:26-30`, `OverviewView.tsx:17-21` — **duplicated per-file, not imported from one shared module**).

Typography: system font stack only (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif`, `styles.css:23`), **no monospace anywhere in the app** (explicit rule, comment at `styles.css:471`) even for numbers/timestamps. Large-title pattern: `.nav h2{font-size:34px;font-weight:800;letter-spacing:-.02em}` (`styles.css:36`) on every screen's header, paired with a 34px circular `.avatar-me` gradient badge (teal→blue, `styles.css:37`) top-right.

Card idiom: `border-radius` steps up with card size — 14-16px for list-style cards (`.ops-card`, `.ov-tile`, `.td-tile`), 18-20px for larger content cards (`.draftcard`, `.qc`), consistent `var(--surface)` background with `var(--surface2)` for a nested "inner" panel (e.g. message bubble background inside a card). Hairline dividers (`.5px solid var(--sep)`) between list rows, never full-weight borders.

Empty/loading states:
- Every list screen has a bespoke `*Skeleton` component (`components/Skeleton.tsx`) — shimmer via a `::after` pseudo-element sweeping a translucent gradient (`styles.css:230-231`, `sk-sh` keyframe) — shaped to echo the real row (avatar circle + two line-bars for Inbox, a "card" outline for Ops, a bar-chart shape for Sends) so layout doesn't jump on data arrival. **Every screen shows the skeleton only on true first-load** (`loading && rows.length===0` pattern, e.g. `OpsScreen.tsx:300`, `App.tsx:97`), never on a background refresh.
- A generic `.empty{padding:60px 22px;text-align:center;color:var(--text3)}` class is the fallback one-liner for "nothing here" states with no bespoke skeleton (`styles.css:31`).
- Degraded-but-not-empty states get an amber banner (`.td-banner`, `styles.css:488-489`), never a blocking error screen — e.g. Today's "Counts only — this session isn't authorised..." (`TodayScreen.tsx:583-587`).

`ConfirmSheet` (`components/ConfirmSheet.tsx`): a single app-wide `ConfirmProvider` (mounted once in `main.tsx:13`) exposing a `useConfirm()` hook that returns a `Promise<boolean>` — replaces native `window.confirm` everywhere so every destructive/external action gets the same iOS-style bottom sheet (title + message + confirm button styled `confirm`/`danger` + cancel), with a 180ms close animation before unmount so it never "snaps" away (`ConfirmSheet.tsx:41-45`). **Every write action in the app that isn't pure text-editing goes through `useConfirm()` first** — approve/discard on drafts, ops cards, weekly reports, comment replies all confirm before mutating.

`ContextSheet` (`components/ContextSheet.tsx`): same slide-up sheet chrome (`.sheet-scrim`/`.sheet`/`.sheet-card`) reused for a *content* sheet rather than a yes/no — pattern for "tap a name/avatar to reveal a detail panel without navigating away." Loads on-demand (one prospect row + one scan lookup) rather than being pre-joined into any list view, keeping the underlying view lean (comment `context.ts:4-5`).

Pull-to-refresh + chime are the two "liveness" affordances: `usePullToRefresh` + `<PullIndicator>` on every scrollable list (§3), and a synthesized two-tone WebAudio chime (`lib/chime.ts`, no audio asset file) that fires only when `useInbox`'s refresh surfaces a genuinely newer inbound message than the last one seen (`useInbox.ts:16-19`), gated by a `localStorage` toggle (`chimeEnabled`/`setChimeEnabled`).

**Checklist distilled for a new screen:**
1. `.nav` header with `<h2>` 34px/800 title + `.avatar-me` badge, optionally a `.search`/`.chips` row underneath.
2. List/rows container gets a `ref`, wired to `usePullToRefresh` + `<PullIndicator>`.
3. First-load-only skeleton matching the real row/card shape; background refreshes never show the skeleton.
4. Any destructive/external/send action routes through `useConfirm()` with an explicit, honest message about what will actually happen externally (the app's copy is unusually candid — "Goes live on LinkedIn... Checks first that they have not already been answered" — never soft-pedaled).
5. Use the existing severity 3-color vocabulary (`#10A37F`/`#FF9F0A`/`#FF453A`) for any status dot/badge; don't invent a new severity palette.
6. No monospace, system font stack only, `--surface`/`--surface2`/`--surface3` for elevation, `.5px` hairlines for dividers.
7. Desktop: don't build a second layout — either it's a `dt-full` (no thread pane, full-width) tab like Sends/Ops/Today, or it participates in the `dt-list`/`dt-detail` split like Inbox/Drafts. Decide which up front (`App.tsx:143-171`).

---

## 6. PWA

**Build tooling:** `vite-plugin-pwa` with `strategies:'injectManifest'`, custom `srcDir:'src', filename:'sw.ts'`, `registerType:'autoUpdate'` (`vite.config.ts:7-9`). `base: './'` (relative asset paths — required because the app is served from a GH Pages *subpath* `/ivan-inbox/`, not the domain root, `vite.config.ts:6`).

**`src/sw.ts` (11 lines of custom logic on top of Workbox precache):**
- `precacheAndRoute(self.__WB_MANIFEST)` (`sw.ts:4`) — Workbox's injected manifest precaches the built JS/CSS/asset bundle; this is the *only* caching strategy in the app (no runtime caching, no offline API fallback, no stale-while-revalidate rules for Supabase calls — those are always live network requests, never cached by the SW).
- Custom `push` handler (`sw.ts:6-14`): shows a notification from the push payload's `{title, body, url}`, icon/badge both point at `./icon-192.png` (relative, same subpath reasoning), explicitly `silent:false` so the OS plays its notification sound.
- Custom `notificationclick` handler (`sw.ts:15-18`): closes the notification and calls `self.clients.openWindow(e.notification.data?.url ?? './')` — this is where a push's deep link (`#thread/<id>` or `#today`) actually gets consumed to open/focus the app at that route.

**Update rollout to an installed app:** `registerType:'autoUpdate'` means Workbox's generated SW registration script polls for a new SW and activates it automatically (no explicit "update available, tap to reload" prompt exists in the app code — confirmed no `beforeinstallprompt`/update-toast component anywhere in `src/`). A push notification also indirectly forces a fresh app instance to load (since `openWindow`/focus reloads through the current SW), but there's no deliberate cache-bust mechanism beyond Workbox's own precache-manifest hashing (new build → new manifest → new files → old cache entries pruned automatically by Workbox's default precaching behavior).

**Manifest** (`vite.config.ts:10-17`): name "Inbox", `display:'standalone'`, black background/theme color, `start_url:'./'`, two icon sizes (192/512, `public/icon-192.png`/`icon-512.png`). `index.html:5-9` additionally sets a hardcoded `#000000` background/theme-color meta tag and inlines `html,body{background:#000000}` so there's no white flash before CSS loads.

**Push (`src/lib/push.ts`):**
- `getPushState()` (`push.ts:12-22`) reports one of `unsupported | denied | off | on` per-device, driving the Settings toggle — checks `navigator.serviceWorker.ready` then `pushManager.getSubscription()`.
- `enablePush()` (`push.ts:24-37`): requests `Notification.requestPermission()`, subscribes via `pushManager.subscribe({userVisibleOnly:true, applicationServerKey: <VAPID public key, base64url-decoded>})`, upserts the subscription (`endpoint, p256dh, auth, device_label:'ivan-inbox', user_agent`) into `push_subscriptions` keyed by `onConflict:'endpoint'`.
- `disablePush()` (`push.ts:42-55`): unsubscribes locally and deletes the row scoped by **both** `endpoint` and `device_label:'ivan-inbox'` — deliberately narrow so it never touches another tool's rows in the same shared `push_subscriptions` table (comment `push.ts:40-41`).
- **Two server-side push senders**, both edge functions requiring an `x-inbox-secret` header (not user JWT — these are server-to-server/cron-triggered, `verify_jwt` off):
  - `inbox-push` (`supabase/functions/inbox-push/index.ts`): fired per new inbound message; reads `inbox_messages_v` for the message, skips non-inbound, sends to every row in `push_subscriptions` where `device_label='ivan-inbox'`, payload `{title:"<prospect> · Rise/Ivan", body:<first 140 chars>, url:'./#thread/<prospect_id>'}` (`index.ts:23-29`). Uses an inbox-scoped VAPID keypair (`INBOX_VAPID_PUBLIC_KEY`/`INBOX_VAPID_PRIVATE_KEY`) distinct from any shared `VAPID_*` secret (comment `index.ts:18-19`). Prunes dead subscriptions on 404/410 (`index.ts:34-36`).
  - `inbox-morning-push` (`supabase/functions/inbox-morning-push/index.ts`): pg_cron-fired at 09:30 UTC (06:30 BA). **Born-dead by design** — no-ops entirely unless `integration_config.key='morning_push_enabled'` has `value='true'` (`index.ts:11-16`). When live, calls `get-morning-brief?mode=counts` with the **service-role key** server-side (`index.ts:19-22`) and pushes `{title:'Morning brief', body:'<n> urgent · <n> approvals', url:'./#today'}` (`index.ts:29-34`) — the counts definition (72h cutoff, no scan opens, no autoreplies) is the *same filtered definition* that feeds the badge and Today's hero strip, so the push body never disagrees with what's on screen (comment `index.ts:17-18`).

**Deep links notifications use:** exclusively `./#thread/<prospect_id>` (per-message push) and `./#today` (morning brief push) — both relative, both consumed by `sw.ts`'s `notificationclick` → `clients.openWindow` → the hash router in `App.tsx:73-89`.

---

## 7. Desktop behavior

**Detection** (`src/hooks/useDesktop.ts`): a single `matchMedia('(min-width: 1000px)')` boolean, live-updated via the media query's `change` listener (`useDesktop.ts:4-14`) — no separate "tablet" tier, it's a binary mobile/desktop split at 1000px.

**Layout fork** (`App.tsx:143-171`):
- Desktop renders `<div className="app dt">` containing the `TabBar` (reflowed vertical rail via CSS) plus **either**:
  - a `dt-full` pane (`App.tsx:147-153`) for `sends`/`ops`/`today` — these tabs have no per-item conversation to show, so they'd waste half the screen in a list+detail split (comment `App.tsx:139-142`);
  - **or** the `dt-list`/`dt-detail` two-pane split (`App.tsx:154-167`) for `inbox`/`drafts` — the existing `listScreen` renders in a fixed 400px-wide `.dt-list` column (`styles.css:289`), and the selected thread (if any) renders in `.dt-detail` to its right; if no thread is open, a centered "Select a conversation" placeholder shows (`App.tsx:160-165`).
- Mobile (the `else` branch, `App.tsx:174-187`): a thread takes over the *entire* screen when open (no back-and-forth pane), otherwise the active tab + bottom `TabBar`.
- `nav(t)` (`App.tsx:91-95`) only clears `openThread` on tab-switch **when not desktop** (`if (!desktop) setOpenThread(null)`) — on desktop, switching tabs and back can leave a thread still selected in the detail pane, since the list+detail split persists selection state independent of which list tab is active... actually re-reading: `openThread` is Shell-level state shared across tabs, so switching to `sends` and back to `inbox` on desktop would still show the previously-open thread if one was open. This is a byproduct of `openThread` not being tab-scoped, not a documented desktop-specific behavior.
- CSS-only reflow details: desktop bubbles cap at `62%` width vs mobile's `78%` (`styles.css:295` vs `102`), desktop message padding widens (`styles.css:296`), the back chevron (`.back`) is hidden entirely on desktop since there's no full-screen thread takeover to back out of (`styles.css:300`).
- `TodayScreen`/`OpsScreen` additionally have their own `@media(min-width:1000px)` rules reflowing their *internal* zone layout into a 2-column grid (`styles.css:602-627` for Today's 4 zones into 2 columns; `styles.css:451-463` for the Sends Overview hero/KPI grid) — these are independent of the `useDesktop()` hook, driven purely by CSS media queries at the same 1000px breakpoint, so the two mechanisms (JS hook for shell layout, CSS media query for in-screen reflow) must be kept in sync at 1000px if that breakpoint is ever changed.

---

## 8(a). Exhaustive Supabase surface touched by the client (tables / views / RPCs / edge functions)

**Tables (direct read/write via `supabase.from(...)`):**
- `outreach_messages` — write target for drafts/replies: `approveDraft`, `discardDraft`, `composeReply`, `markThreadRead` (`inbox.ts:160-197`). Realtime-subscribed by `useInbox` (`useInbox.ts:27`).
- `ops_drafts` — read via `fetchOpsDrafts`; written by `approveOpsDraft`, `approveWeeklyReport`, `discardOpsDraft` (`ops.ts:110-191`). Realtime-subscribed by `useOps` (`useOps.ts:24`).
- `outreach_prospects` — read (`fetchProspectContext`, `context.ts:41-47`) and written (`saveOperatorNote`, `context.ts:67-76`, columns `operator_note`/`operator_note_at`).
- `outreach_campaigns` — read-only fallback path (`fetchCampaignSendsLegacy`, `sends.ts:222`).
- `scans` — read-only (`fetchScan`, `context.ts:51-64`), two-step lookup: domain match then person-name slug prefix match.
- `integration_config` — read-only, key/value store: `seat_health_summary` (`seatHealth.ts:19-22`) and `morning_push_enabled` (read server-side only, `inbox-morning-push/index.ts:11-12`).
- `push_subscriptions` — upsert/delete from the client (`push.ts:33-49`), read/pruned server-side by both push edge functions.
- `client_post_comments` — **not read/written by the ivan-inbox client at all**; only touched server-side inside the separate `rise-comment-reply` edge function (`ivan-listener` repo). The inbox client only ever sees this data pre-baked into an `ops_drafts.context` blob.

**Views (read-only, `supabase.from(<view>).select()`):**
- `inbox_messages_v` — the workhorse view backing the whole Inbox/Sends/context screens: `fetchMessages` (paginated, 1000-row PostgREST cap handled by manual `.range()` looping, `inbox.ts:135-150`), `fetchThreadChatId` (`today.ts:429-439`), `fetchReplyCounts` (`today.ts:476-484`), `fetchSendLog`/`fetchLaneRecent` (`sends.ts:115-167`), legacy campaign fallback (`sends.ts:223-227`).
- `inbox_sends_v` — `fetchSends` (`sends.ts:46-50`).
- `inbox_sends_daily_v` — `fetchSendsDaily` (`sends.ts:52-56`).
- `inbox_campaign_sends_v` — `fetchCampaignSends` primary path (`sends.ts:184-208`), server-side aggregate that dodges the 1000-row PostgREST cap the legacy client-side count silently truncated on.
- `inbox_accept_v2` — `fetchAccept` (`kpis.ts:43`). Named `v2` because Ivan's scope only counts sends since the 2026-07-11 warm-lane era cutoff; Rise counts full history (comment `kpis.ts:41-42`).
- `inbox_pipeline_v` — `fetchPipeline` (`kpis.ts:44`).
- `inbox_scan_opens_v` — `fetchScanOpens` (`kpis.ts:45`).
- `inbox_outcomes_v` — `fetchOutcomes` (`kpis.ts:46`).

**RPCs (`supabase.rpc(...)`):**
- `inbox_range_kpis(p_from, p_to)` — `fetchRangeKpis` (`kpis.ts:53-57`), the custom-date-range KPI query with no era cutoff.
- `inbox_governor()` — `fetchGovernor` (`kpis.ts:59-63`), returns per-client governor/mode/cap state including v2 fields (`cohort`, `gov_used`/`gov_cap`) that are optional/absent on the legacy RPC shape.

**Edge functions (client → function, `fetch()` with `apikey`+`Authorization: Bearer <user JWT>`):**
- `get-morning-brief` (`?mode=counts` and full) — `today.ts:277-303`. **Function code itself lives outside this repo** (not found under `ivan-inbox/supabase/functions/`; only its two push-notification siblings live here).
- `rise-comment-reply` — `ops.ts:154-165`. Lives in `~/Desktop/ivan-listener/supabase/functions/rise-comment-reply/index.ts`, a **separate repo from ivan-inbox**.

**Edge functions owned by this repo** (`supabase/functions/` under `ivan-inbox`), server-triggered, not called by the client:
- `inbox-push` — per-message push notification (`x-inbox-secret` auth, `verify_jwt` off).
- `inbox-morning-push` — pg_cron-fired daily brief push, born-dead behind `integration_config.morning_push_enabled`.

**Env/keys used at build** (`.github/workflows/deploy.yml:12-15`, mirrored locally in `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` — all three baked into the static bundle at `npm run build` time via GitHub Actions secrets; **no service-role key or other secret ever reaches the client build**. Edge-function-side secrets (`INBOX_PUSH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `INBOX_VAPID_PUBLIC_KEY`/`INBOX_VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and in the separate `ivan-listener` repo: `UNIPILE_KEY`, `UNIPILE_ACCOUNT_RISE`) live only in Supabase's function environment, never in this repo's `.env.local` or GH Actions secrets.

---

## 8(b). Checklist — adding a new surface without breaking native feel

1. **Navigation:** update `Tab` in both `App.tsx` and `TabBar.tsx` plus `TABS` in `route.ts` together — there is no single source of truth for the tab enum today; consider fixing that as a prerequisite rather than adding a 4th place to edit.
2. **TabBar capacity:** the bar is a fixed 1-row flex with no overflow affordance — 6 tabs already fill it. Adding a 7th shrinks every icon; decide up front whether the new surface is a top-level tab, a sub-view reached from an existing tab (like Ops surfaces inside Drafts, `DraftsScreen.tsx:25-52`), or gated behind desktop-only real estate.
3. **Icon:** pick a single-glyph Unicode character consistent with the existing register (`☼ ◉ ✦ ↑ ◈ ⚙︎`) — no icon library exists in `package.json` dependencies to import instead.
4. **Auth:** reads go through the anon-key Supabase client (`lib/supabase.ts`) exactly like every other screen — don't invent a second client instance. If the new surface needs data the anon/authenticated RLS split can't serve, that's a `get-morning-brief`-style edge function with its own auth-gated response shape, not a new key shipped to the bundle.
5. **Data hook:** follow the `useInbox`/`useOps` template — `useState` + `refresh` callback + mount effect wiring `refresh()` + realtime channel (if the table needs live updates) + `focus` listener. If the underlying fetch is slow (like the brief), follow `useToday`'s two-tier counts/full + localStorage-cache-first pattern instead, and throttle focus-refetch.
6. **Realtime channel naming:** if two mounts of the same hook are plausible (e.g. the surface appears both as a tab and embedded elsewhere, as Ops does inside Drafts), namespace the channel topic per-instance with `useId()` like `useOps` does — a shared topic across two live subscribers throws and blanks the screen.
7. **Pure functions first:** put filtering/sorting/derivation logic in `lib/<domain>.ts` as pure functions, write vitest unit tests for them in the same style (`describe`/`it`, comment explaining the real incident being guarded against, 2026-07-dated fixtures) — reserve the screen component for rendering + the thin I/O wrapper calls.
8. **Confirm gate:** any write that is destructive, external, or irreversible must go through `useConfirm()` with copy that states plainly what will actually happen (this app never soft-pedals a "this posts live on LinkedIn" moment) — never a bare `onClick` mutation and never a native `window.confirm`.
9. **Empty/loading:** build a first-load-only skeleton shaped like the real content (extend `components/Skeleton.tsx`); never show the skeleton on a background refresh; fall back to the generic `.empty` one-liner only where a bespoke skeleton isn't worth building.
10. **Color vocabulary:** reuse the exact 3-tier severity palette (`#10A37F`/`#FF9F0A`/`#FF453A`) and the `--surface`/`--surface2`/`--surface3`/`--text`/`--text2`/`--text3` token set; don't introduce a new accent or a 4th severity tier.
11. **Typography:** system font stack, no monospace, 34px/800 large titles on `.nav h2`, hairline `.5px` dividers — match the existing register exactly rather than importing a design system.
12. **Desktop:** decide explicitly whether the new tab is a `dt-full` (no conversation pane, full-width) surface or participates in the `dt-list`/`dt-detail` split, and wire both the `useDesktop()` JS branch in `App.tsx` and, if the screen has its own internal multi-column layout, a matching `@media(min-width:1000px)` CSS rule at the same 1000px breakpoint.
13. **PWA cache:** no runtime-caching layer exists for API calls (Workbox only precaches the static bundle) — a new surface's data fetches are always live network calls, so no service-worker changes are needed purely to add a new screen; only touch `sw.ts` if the surface needs new push-notification handling or precache entries.
14. **Deep links:** if the new surface should be reachable from a push notification, its target URL must be a **relative** `./#<hash>` (never a leading `/`) matching a hash `parseHash` in `route.ts` already understands (or extend `route.ts` first) — a leading-slash URL resolves to the GH Pages user root and the PWA never loads.
15. **client_id scoping:** every existing screen treats `client_id` as `'ivan' | 'risedtc'`, coalescing `NULL`→`'ivan'` at the view/consumption layer (`today.ts:194-196`, `rowClient`) — never assume a raw table's `client_id` column is non-null; the coalescing convention must be replicated for any new query against a raw table rather than a view that already coalesces it.
