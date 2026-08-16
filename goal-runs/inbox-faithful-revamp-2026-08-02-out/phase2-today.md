# Phase 2 (server) — Today-screen staleness fix

Scope: the edge function only. `ivan-listener` repo,
`supabase/functions/get-morning-brief/index.ts`. The `ivan-inbox` worktree and
its dev server were NOT touched (client companion is a separate builder).

Commit `68ba5ce` on `feat/daily-brief` — "brief fn: approval drafts age instead
of lying about being new". Staged by explicit path (never `git add -A`; the repo
carries ~40 unrelated dirty files from the menubar work).

## 1. Diagnosis re-verified before building

Read the whole 626-line function first. The phase0 claims all hold:

- `dm_drafts` (`:141-148`) — `direction=outbound, sent_at IS NULL,
  message_type=dm, send_blocked_reason IS NULL`, `order(created_at desc).limit(50)`.
  No window, no supersession check. Confirmed.
- `commentDrafts` (`:88-96`) — `status='draft'`, `order(drafted_at desc).limit(50)`.
  No window. Confirmed.
- The contrast blocks are real: `feedSince` 3d (`:104`), `AGE_CUTOFF` 72h (`:434`).
- The DEPLOYED function was byte-equivalent to the repo HEAD file (the before-payload
  emits exactly the fields the repo source maps — no `client_id`, no `prospect_id`
  on dm_drafts, which `today.ts` types as optional and tolerates).

Live probes (PostgREST, session token) that the fix depends on:

| draft | prospect_id | draft created_at | latest SENT outbound to that prospect | verdict |
|---|---|---|---|---|
| David Card `9a77664b` | `0f8a3f84` | 2026-07-29T20:30 | **dm sent 2026-07-30T09:00:50** (also an inmail 07-29T14:00) | **superseded** |
| Vuk `699c248a` | `94770c22` | 2026-07-17T22:30 | dm sent 2026-07-17T19:08 (EARLIER) | still open |
| Prakhar `a181861f` | `b4ec14f2` | 2026-07-18T13:00 | dm sent 2026-07-17T19:08 (EARLIER) | still open |
| Joachim `c2bbf068` | `5173e1a9` | 2026-07-20T22:00 | dm sent 2026-07-17T19:08 (EARLIER) | still open |

**Strictly-later is the whole fix.** A naive "prospect has any sent outbound"
rule would have deleted all four. Three of the four have an earlier send in the
same thread and must survive.

Comment drafts — supersession check deliberately NOT applied. Probed all 6
standing drafts by `post_social_id`: each post has exactly **one** `commenting_log`
row, all still `status='draft'`, none with a later `posted`/`approved` sibling.
There is no orphan pattern on this table to fix, so adding the query would be a
cost with no finding. (Recorded in a code comment so the next reader doesn't
re-derive it.)

## 2. The diff

```diff
@@ -46,6 +46,31 @@ Deno.serve(async (req) => {
   const startOfTomorrow = new Date(startOfToday.getTime() + 86400_000);
   const tomorrowIso = startOfTomorrow.toISOString();
 
+  // --- approval-draft freshness (2026-08-02) ---
+  // The two approval queues (comment drafts, DM drafts) had no age signal at all, so a
+  // 16-day-old draft and one written last night read identically on the Today screen
+  // ("the approve dm draft is old asf"). AGE, DON'T HIDE: unlike feed_drafts (hard 3d
+  // window) and urgencies (hard 72h cutoff), these are one-off manual decisions Ivan still
+  // owes — dropping them would bury a real backlog. So every row carries is_aging and the
+  // arrays come back OLDEST FIRST (the row owed longest is the one the zone previews).
+  const AGING_MS = 7 * 86400_000;
+  const ts = (iso: string | null | undefined) => {
+    const t = new Date(iso ?? "").getTime();
+    return Number.isFinite(t) ? t : NaN;
+  };
+  const isAging = (iso: string | null | undefined) => {
+    const t = ts(iso);
+    return Number.isFinite(t) && (Date.now() - t) > AGING_MS;
+  };
+  // Undated rows sink to the bottom: unknown age is not evidence of urgency (same
+  // reasoning as the urgency cutoff, which keeps unparseable waiting_since rows).
+  const oldestFirst = (a: string | null | undefined, b: string | null | undefined) => {
+    const ta = ts(a), tb = ts(b);
+    if (!Number.isFinite(ta)) return Number.isFinite(tb) ? 1 : 0;
+    if (!Number.isFinite(tb)) return -1;
+    return ta - tb;
+  };
+
   // --- workflow_errors_count (counts mode only) ---
@@ -91,7 +116,14 @@
       .order("drafted_at", { ascending: false })
       .limit(50);
-    commentDrafts = data ?? [];
+    // desc + limit(50) at the DB stays the newest-50 WINDOW (flipping it there would make
+    // the cap hide new drafts); the oldest-first order is applied to the returned page.
+    // No supersession check here: probed 2026-08-02, each of the 6 standing drafts is the
+    // only commenting_log row for its post_social_id — there is no later posted/approved
+    // sibling, so the DM orphan pattern has no analogue on this table.
+    commentDrafts = (data ?? [])
+      .map((r) => ({ ...r, is_aging: isAging(r.drafted_at) }))
+      .sort((a, b) => oldestFirst(a.drafted_at, b.drafted_at));
     comments_pending_p = Promise.resolve(commentDrafts.length);
@@ -151,12 +183,40 @@
   const pById = new Map((dmProspects ?? []).map((p) => [p.id, p]));
+  // --- supersession (2026-08-02) ---
+  // A draft whose prospect has a LATER outbound that actually went out is a decision
+  // already made: the thread moved on and this row is the abandoned predecessor. Nothing
+  // in the send path retires it, so it kept reading as "waiting for your approve" forever
+  // — and, being the newest, it was the row the Today zone previewed. (David Card: draft
+  // 07-29 20:30, superseded by a real send 07-30 09:00.) STRICTLY LATER is load-bearing:
+  // the three genuinely-open 13-16d drafts all have EARLIER sends in-thread and must
+  // survive. Compared as instants, never lexically. dmRows is limit(50) so dmIds cannot
+  // approach the ~16KB in.() URL ceiling — no batching needed.
+  const { data: dmSentRows } = dmIds.length
+    ? await sb.from("outreach_messages").select("prospect_id,sent_at")
+      .eq("direction", "outbound").not("sent_at", "is", null).in("prospect_id", dmIds)
+    : { data: [] };
+  const lastSentByProspect = new Map<string, number>();
+  for (const m of dmSentRows ?? []) {
+    const t = ts(m.sent_at);
+    if (!Number.isFinite(t)) continue;
+    const cur = lastSentByProspect.get(m.prospect_id);
+    if (cur === undefined || t > cur) lastSentByProspect.set(m.prospect_id, t);
+  }
+  let dm_superseded_count = 0;
   const dmDrafts = (dmRows ?? [])
     .filter((r) => { /* existing hiring_signal exclusion, untouched */ })
+    .filter((r) => {
+      const sent = lastSentByProspect.get(r.prospect_id);
+      const made = ts(r.created_at);
+      if (sent === undefined || !Number.isFinite(made) || sent <= made) return true;
+      dm_superseded_count++;
+      return false;
+    })
     .map((r) => ({
       id: r.id,
       prospect_name: (pById.get(r.prospect_id) as any)?.name ?? "(unknown)",
       message_text: r.message_text,
       channel: r.channel,
       matched_offer: r.matched_offer,
       created_at: r.created_at,
-    }));
+      // aged, not hidden — the client renders an honest age stamp off created_at
+      is_aging: isAging(r.created_at),
+    }))
+    .sort((a, b) => oldestFirst(a.created_at, b.created_at));
+  const dm_aging_count = dmDrafts.filter((d) => d.is_aging).length;
@@ -608,6 +672,12 @@   const payload = {
     urgencies_count,
     autoreplies_count,
     aging_count,
+    // approval-queue freshness (2026-08-02). Unlike aging_count (urgencies), these count
+    // rows that are STILL IN the array — an aging draft is owed, not hidden. superseded
+    // rows are the only ones actually removed, and they are counted so the drop is visible.
+    dm_aging_count,
+    comment_aging_count: commentDrafts.filter((d: any) => d.is_aging).length,
+    dm_superseded_count,
     needs_you: { comment_drafts: commentDrafts ?? [], dm_drafts: dmDrafts, feed_drafts },
```

72 insertions, 2 deletions, one file. `deno check` clean.

## 3. Before / after — the specific rows

Payloads: `phase2-brief-before.json` (generated_at 18:52:38Z, pre-deploy) and
`phase2-brief-after.json` (18:56:08Z, post-deploy). Same auth, same URL, no
query params, ~4 minutes apart.

**dm_drafts — 4 rows → 3**

| before (created_at desc) | after (oldest first) |
|---|---|
| **David Card — 07-29T20:30** | *(gone — superseded)* |
| Joachim Koch — 07-20T22:00 | Vuk Sretenovic — 07-17T22:30 · `is_aging: true` |
| Prakhar Vohra — 07-18T13:00 | Prakhar Vohra — 07-18T13:00 · `is_aging: true` |
| Vuk Sretenovic — 07-17T22:30 | Joachim Koch — 07-20T22:00 · `is_aging: true` |

The orphan is gone; all three genuinely-open rows survive, stamped, and the
preview row (`dms[0]`) is now Vuk at 16d — the one owed longest — instead of the
already-answered David Card.

**comment_drafts — 6 rows → 6 rows**, reordered oldest-first (Chad Drew 06-28
now leads instead of Connor McLeod 07-01), all six `is_aging: true`. Field
parity asserted programmatically: after-row fields == before-row fields +
`is_aging`, nothing dropped.

**New scalars**: `dm_aging_count: 3`, `comment_aging_count: 6`,
`dm_superseded_count: 1`.

**Nothing else moved.** Key-set diff between the two payloads is exactly
`+['comment_aging_count','dm_aging_count','dm_superseded_count']`, removed `[]`.
`urgencies` (1), `aging_count` (6), `feed_drafts` (2), `outreach_health`,
`outreach_queue`, `today_content`, `content_calendar`, `pipeline`,
`client_errors`, `workflow_errors`, `urgent_tasks`, `content_performance` all
present with unchanged shape.

**Counts mode re-probed** (authed and anon-degraded, both):
`{"mode":"counts",…,"approvals":{"comments":6,"dms":3,"feed":1}}` — key set
byte-identical to before, `dms` moved 4 → 3 because it derives from the same
`dmDrafts` array. That is the file's own one-definition rule (array, count,
badge and push agree by construction), not a shape change. The anon caller still
gets counts-only — no PII path was widened.

## 4. Deploy record

```
supabase functions deploy get-morning-brief --project-ref bjbvqvzbzczjbatgmccb
→ Deployed Functions on project bjbvqvzbzczjbatgmccb: get-morning-brief
```
2026-08-02 ~18:55Z. No repo deploy script exists (only a doc line in
`docs/superpowers/plans/2026-06-24-daily-brief.md:193` naming this exact
command). No `supabase/config.toml`, so the CLI default `verify_jwt=true` is
preserved — matching what the function's own D11 comment assumes. No secrets
touched, no migration, no RLS change, no other function touched.

## 5. Consumers verified

- `ivan-inbox/src/lib/today.ts` — `asBrief()` (`:171-191`) reads a fixed key
  list and `arr<DmDraft>()` casts rows through untouched, so extra fields ride
  along and unknown top-level keys are ignored. Nothing it reads was renamed.
  **Read-only; not edited.**
- `ivan-inbox/supabase/functions/inbox-morning-push/index.ts:20-31` — calls
  `?mode=counts` and sums `approvals.comments+dms+feed`. Key set unchanged; the
  push body now says one fewer approval, correctly.
- `ivan-listener/menubar/Sources/BriefClient.swift:75` — since commit `d7bd170`
  the Swift app fetches **counts mode only** (`?mode=counts`) for badge + spoken
  brief. `struct BriefCounts` is all-optional; unchanged keys, still decodes.
- `personal-site` — grepped whole repo for `get-morning-brief`: **zero hits**.
  Not a consumer.

## 6. Judgment calls

1. **Ordering done server-side, not exposed as metadata.** Both arrays now come
   back oldest-first. Smaller diff than adding sort keys, and it fixes the
   preview for every consumer at once (the Swift app and the push body get it
   free). The DB query keeps `order(... desc).limit(50)` — flipping the order
   *there* would turn the 50-cap into "hide the newest drafts", which is a worse
   bug than the one being fixed. The reorder is applied to the returned page.
2. **7-day threshold** — matches the existing `pipeline.review_aging` rule
   (`>7d`) already in this file, rather than inventing a third number.
3. **No `age_days` field.** `created_at` / `drafted_at` were already present and
   already cached client-side; a derived integer would be a second source of
   truth that goes stale the moment the payload is cached.
4. **`is_aging` always present as a boolean** (not conditionally spread like
   `is_autoreply`). Costs ~20 bytes/row and keeps the type a single shape, which
   matters because the client's cache projection enumerates fields by hand.
5. **Instants, never lexical compare.** `sent_at` and `created_at` both arrive
   as PostgREST `+00:00` strings today, so a lexical compare would happen to
   work — but this codebase has already been burned by `+00:00` vs `Z`
   (`today.ts:492-495` carries the scar). Both sides go through `getTime()`.
6. **No batching for the `in.()` query.** `dmRows` is `limit(50)`, so `dmIds`
   is ≤50 UUIDs ≈ 1.9KB of URL — structurally an order of magnitude under the
   ~16KB ceiling. Batching here would be unreachable code pretending to be a
   safeguard. If that limit is ever raised, the batch is required.
7. **Counts-mode response keys left alone.** `dm_aging_count` is computed before
   the counts branch returns and could have been added there for one line, but
   the push body has no aging surface to render it and the brief asked for the
   smallest diff. Trivial to add later.
8. **The superseded row is deleted, not flagged.** It is the one case where the
   decision is provably already made — showing it flagged would still be asking
   Ivan to look at a closed question. Counted (`dm_superseded_count`) so the
   drop is auditable rather than silent.

## 7. For the client-side companion (OUT of my scope)

Fields now available to `TodayScreen`:

- `needs_you.dm_drafts[].is_aging` (bool) + existing `created_at`
- `needs_you.comment_drafts[].is_aging` (bool) + existing `drafted_at`
- top-level `dm_aging_count`, `comment_aging_count`, `dm_superseded_count`
- both arrays already arrive oldest-first, so `dms[0]` / `comments[0]` is the
  correct preview with **no client sort needed**.

⚠️ **One trap the client builder must handle**: `today.ts:346-403`
`projectBrief()` is a hand-enumerated whitelist projection into localStorage.
`is_aging` is **not** in it, so on a cache-first paint the aging tag will vanish
and reappear ~12s later when the live payload lands. Add `is_aging` to the
`dm_drafts` and `comment_drafts` field lists in `projectBrief()` (it is a plain
bool — no capability-token risk, `cacheSafe()` is unaffected). The top-level
`aging_count` is already projected; `dm_aging_count` / `comment_aging_count`
are not, and need the same one-line addition if the zone header renders them.

Also unchanged and worth knowing: the fn still emits **no `client_id`** on
dm/comment drafts, so `inScope()` coalesces every draft to `'ivan'`. That is
pre-existing behaviour, not something this diff altered.

---

## Client companion (orchestrator, commit `3b02365` on exp/vis-faithful)

- `src/lib/today.ts`: `is_aging?: boolean | null` added to `DmDraft` + `CommentDraft`; carried through
  `projectBrief()`'s field-enumerated whitelist (only the boolean crosses into localStorage — the
  whitelist stays explicit, no spread).
- `src/screens/TodayScreen.tsx` `ZoneApprove`: counts server-stamped aging rows in scope and appends
  `· N owed >7d` to the DM and comment meta lines. Preview rows arrive oldest-first from the server, so
  no client sort was needed.
- Verified live on :5431 (settled capture, fresh session):
  `3 waiting · oldest drafted 15d ago · 3 owed >7d` / `6 targets · oldest drafted 35d ago · 6 owed >7d`.
- Gates: `tsc --noEmit` clean, `npm test` 412/412.

The stale "approve dm draft" Ivan saw is demonstrably gone (superseded-drop, verified by independent
probe), and everything still shown wears an honest age.
