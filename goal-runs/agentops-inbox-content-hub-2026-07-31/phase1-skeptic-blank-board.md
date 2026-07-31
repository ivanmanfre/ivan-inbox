# Phase 1 — Blank-Board Skeptic

Role: refute the claim that the planned Content/Styles/AgentOps queries will show the
right rows. Default REFUTED on thin evidence. Read-only audit against
`~/Desktop/personal-site` and `~/Desktop/ivan-inbox` as they exist on 2026-07-31.
Both apps confirmed on the **same Supabase project** `bjbvqvzbzczjbatgmccb`
(`personal-site/lib/supabase.ts:3-6` default URL; `ivan-inbox/.env.local:1` /
`ivan-inbox/src/lib/supabase.ts:4` via `VITE_SUPABASE_URL`) — RLS is shared
infrastructure, not per-app.

---

## 1. `client_id` semantics mismatch — REFUTED (as stated) + NEEDS-DB-CHECK (the actual values)

The mission assumes a Content query can filter `client_id=eq.ivan` (or similar) to get
Ivan's lane, and `client_id=eq.rise`/`risedtc` for Rise. **Both literal-string
assumptions are wrong for `carousel_drafts`.**

- `'ivan'` is never a value written to `carousel_drafts.client_id`. It is a
  **client-side coalescing default**, invented at read time in a completely
  different app/table domain: `ivan-inbox/src/lib/today.ts:199-200`
  ```ts
  export function rowClient(r: { client_id?: string | null }): string {
    return r.client_id ?? 'ivan'
  }
  ```
  and `ivan-inbox/src/lib/today.ts:197`: `export type Scope = 'all' | 'ivan' | 'risedtc'`.
  This convention lives in `today.ts`, which reads `outreach_messages` /
  `outreach_prospects` / KPI views (§8a of phase1d) — a completely different
  table family from `carousel_drafts`. There is **no evidence in either repo**
  that this same coalescing function, or the literal string `'risedtc'`, is
  ever applied to `carousel_drafts`.
- On the content side, the actual dashboard convention for Ivan's lane is
  **`.is('client_id', null)`**, not `.eq('client_id','ivan')` —
  `personal-site/hooks/useContentLibrary.ts:107-114`:
  ```ts
  .from('carousel_drafts').select(SELECT_COLS)
  // This is Ivan's OWN content library. Client-owned drafts (client_id set,
  // e.g. RISE) live on their own Client Ops surface ...
  .is('client_id', null)
  ```
  If the new inbox Content query does `client_id=eq.ivan` on `carousel_drafts`,
  it returns **ZERO rows** — Ivan's rows are `NULL`, never the string `'ivan'`.
  This is exactly the incident this skeptic role is named for (a filter that
  looks reasonable but silently returns nothing because the literal value
  assumed doesn't exist in the column).
- **What literal value Rise rows actually carry in `carousel_drafts.client_id`
  is UNKNOWN from either repo.** Grepped `ClientOps.tsx`, `clientops2/shared.tsx`,
  `ClientBoardPage.tsx` for a literal `'risedtc'`/`'rise'` assigned to
  `client_id` — none found. Rise is only ever identified by **domain/slug/name
  string-matching** on `board.domain`/`board.company_name`
  (`ClientBoardPage.tsx:2209`: `board.domain.includes('risedtc') ||
  board.company_name?.toUpperCase().includes('RISE')`), never by a known
  `client_id` literal. Every client-scoped read in `ClientOps.tsx` passes
  `client.client_id` opaquely into `operator_*` RPCs
  (`ClientOps.tsx:414-417`) whose bodies are server-side only (not in either
  repo) — the client value could be a UUID (`client_boards.id`), a slug, or a
  literal `'risedtc'`; nothing in the client code disambiguates this.

**Exact DB check needed** (read-only, run against the live Supabase project
before wiring any Content query):
```sql
select client_id, count(*) from carousel_drafts group by client_id order by 2 desc;
select client_id, count(*) from lm_drafts_v2 group by client_id order by 2 desc;
-- confirm scheduled_posts even HAS a client_id column, and if so its values:
select column_name from information_schema.columns
  where table_name='scheduled_posts' and column_name ilike '%client%';
```
Until that returns, any query written as `client_id=eq.<anything>` on
`carousel_drafts`/`lm_drafts_v2` is a guess. The only verified-safe filters
from code are `.is('client_id', null)` (Ivan) and `.not('client_id','is',null)`
(client rows, lane unspecified — see §2 for why that's not sufficient either).

**Verdict: REFUTED** for the `client_id='ivan'` assumption (proven wrong in
code); **NEEDS-DB-CHECK** for what the real Rise-lane value is before any
`eq()` filter is written.

---

## 2. Rise lane visibility via a raw `carousel_drafts` read — NEEDS-DB-CHECK (real risk, not proven either way)

The mission's Content section plans to read `carousel_drafts` (+ `lm_drafts_v2`,
`scheduled_posts`) directly for **both** Ivan and Rise lanes. But nowhere in
`personal-site` does the dashboard read Rise's rows this way — every Rise-facing
surface goes through one of two indirections:

1. **Client board (Rise's own view of its content)**: `get_client_board` /
   `get_client_board_by_session` RPCs — bodies **not in the repo**
   (`phase1b-content-map.md:46-51`, grepped, no `CREATE FUNCTION
   get_client_board` in `supabase/migrations/*.sql`).
2. **Ivan's internal view of Rise** (`ClientOps.tsx`): `operator_client_drafts`,
   `operator_client_ideas`, `operator_client_lms` RPCs, gated by an
   **app-level string** `p_gate:'clientops'` (`clientops2/shared.tsx:21`,
   `GATE`) — explicitly documented as **not a Postgres role/auth check**, just
   a parameter the RPC body presumably inspects server-side.

Nothing in either repo confirms that a **direct** `.from('carousel_drafts').select().not('client_id','is',null)` call, run as the `authenticated` Postgres role (Ivan's own Supabase Auth session, which both personal-site and ivan-inbox share via the same project), would return Rise's rows at all. Two live possibilities, indistinguishable from client code:

- **RLS permits it** — in which case the `operator_*` RPC layer exists only for
  the `clientops` app-gate/assembly convenience, and a raw authenticated read
  would work identically in ivan-inbox (same login, same project).
- **RLS blocks direct reads of client-owned rows to `authenticated`**, and only
  `SECURITY DEFINER` RPCs (which bypass RLS) can see them — in which case a
  raw `carousel_drafts` read from ivan-inbox returns **zero Rise rows even
  when logged in**, an authed-empty failure that looks like "Rise has no
  content" rather than "the query can't see it."

The fact that **every single Rise-scoped read across the entire personal-site
codebase** routes through a SECURITY DEFINER RPC (never a raw `.from()` call)
is itself circumstantial evidence pointing toward the second case — if raw
reads worked, at least one internal surface would likely use the cheaper path.

**Exact check needed:** authenticate the ivan-inbox anon+session client as Ivan
(same login the app already gates on) and run, live:
```
supabase.from('carousel_drafts').select('id,client_id,status').not('client_id','is',null).limit(5)
```
If this returns rows, raw reads are viable for Rise's lane (still need §1's
DB check to know what value to filter on). If it returns `[]` while
`operator_client_drafts` for the same client returns rows in the same
session, the Content section's Rise lane **must** go through a new/adapted
RPC (respecting the guardrail against inventing new secrets — reusing
`operator_client_drafts` is available, but it requires a `client_id`
parameter this run does not yet have safely, again per §1).

**What the dashboard uses to show Rise to Ivan (not the client)**:
`ClientOps.tsx` + `clientops2/shared.tsx`, exclusively via the `operator_*`
RPC family listed above — this is the pattern to port, not a raw table read.

**Verdict: NEEDS-DB-CHECK.** Do not assume a raw `carousel_drafts` read can see
Rise rows just because Ivan is logged in.

---

## 3. Status filters — REFUTED (a live, code-confirmed black hole: `status='approved'`)

The mission's status list (idea/generating/review/approved/disqualified/
scheduled/published/error, + scheduled_posts pending/queued_v2/posting/
posted/failed/cancelled) is the right vocabulary — but at least one status in
that list, **`'approved'`**, has **no live read/queue anywhere in the current
dashboard** for the exact case that matters: an approved-but-not-yet-scheduled
post. Traced end to end:

- `approve()` in `PostWorkSurface.tsx:222-229` flips `status:'approved'` via
  `setStatus()` and does **not** set `scheduled_at`.
- The only queue that shows `'review'` rows explicitly filters them **out**
  the moment they leave review: `reviewQueue` = `status === 'review' &&
  !d.clientId && !d.isIdea && !skipped` (`PostWorkSurface.tsx:100-104`).
- `errorRows` = `status === 'error'` only (`PostWorkSurface.tsx:113`).
- `stuckRows` = `status === 'scheduled' && scheduledAt < now` only
  (`PostWorkSurface.tsx:114-120`).
- Calendar only shows rows that HAVE a `scheduledAt`
  (`calendarItems.ts:71-82`) — an approved-but-unscheduled row has none.
- Grepped the full status-literal set actually branched on in
  `PostWorkSurface.tsx`/`Calendar.tsx`/`calendarItems.ts`:
  `review`, `error`, `scheduled` (×2 contexts), `fulfilled` (unrelated,
  idea-projection concept), `published` (only a `!==` exclusion in
  `calendarItems.ts:44`). **`approved` never appears as a read-side filter
  anywhere in these three files.**

So today, in the live dashboard, a post that is `approved` and has no
`scheduled_at` is invisible: not in review, not in error, not in the
calendar, not flagged as stuck. It is a **write-only status** for this
surface — exactly the class of bug this skeptic role exists to catch (a
lane that looks dead/complete when it's actually starved of a "needs
scheduling" view). If the new inbox Content queue is built by porting these
same three filters verbatim, it inherits the same black hole, and Ivan will
see "queue empty" on a brand with an approved backlog nobody scheduled yet.

Additionally: **`'draft'`** is not a real DB value — it's a fallback string
for `NULL`/empty (`useContentLibrary.ts:69`, `status: row.status || 'draft'`)
— any new query branching on the literal string `'draft'` as if it were a
distinct lifecycle stage is filtering on a value that (per this code) never
actually exists in the column.

**Verdict: REFUTED.** The status list is incomplete in its *consumption*, not
its enumeration — `status='approved'` (unscheduled) needs an explicit new
"needs scheduling" bucket in the Content section or it silently vanishes,
reproducing a known-shape incident (a real row, no query surfaces it).
Recommend: `carousel_drafts.status='approved' AND scheduled_at IS NULL` as an
explicit named bucket, verified against a live count before shipping
(`select count(*) from carousel_drafts where status='approved' and
scheduled_at is null and client_id is null`).

---

## 4. Styles previews — REFUTED / gap the prior audit missed (`style_id` column undocumented + linkage unproven)

Phase1c states flatly (`hooks/useStyleUsage.ts:6-9` comment, quoted in
`phase1c-styles-map.md:52`): *"Carousel layout archetypes are intentionally
excluded — carousel_drafts records no archetype field, so there is nothing
real to count there."* **This comment is contradicted by the schema the same
codebase actually selects.** `carousel_drafts` has a dedicated
`style_id` column, selected and mapped in every live copy of
`useContentLibrary.ts` (confirmed in the current file plus every worktree
copy under `.claude/worktrees/*`):
```
SELECT_COLS = '... taxonomy, style_id, scheduled_at ...'   // useContentLibrary.ts:61
styleId: row.style_id,                                      // useContentLibrary.ts:76
```
and it is rendered to Ivan today: `FieldRow label="Style" value={draft.styleId}
mono` (`components/dashboard/FieldGrid.tsx:60`). **Neither phase1b nor
phase1c's audit mentions this column at all** — both describe styling
linkage purely through `taxonomy.image_style` (single-image) and treat
carousel-layout linkage as nonexistent. That's an audit gap this skeptic is
flagging before Phase 2 builds on it.

Two live unknowns, both required before "real previews aggregated from
published carousel_drafts" can work for carousel styles:
1. **Is `style_id` ever actually written?** It's read in every client file
   but grepped zero writes to it anywhere in `lib/studioActions.ts`,
   `StylesLive.tsx`, `useContentArchetypes.ts`, `useCarouselStyles.ts`, or
   `useStylePrompts.ts`. If it's only ever set by the n8n `post-gen-v2`
   pipeline (outside both repos) it could still be consistently populated —
   or it could be a vestigial column that's always `NULL`, matching the
   `useStyleUsage.ts` comment's claim that there's "nothing real to count."
   These two possibilities produce opposite outcomes and are indistinguishable
   from either repo's code.
2. **If populated, does its value match `content_prompts.slug` format
   (`style-comic-explainer` etc.)?** No confirmation either way — `style_id`
   could hold the slug, a `content_archetypes` id, a human title, or a
   `carousel_styles` kit id (a THIRD, unrelated catalog per phase1c §0). Any
   mismatch in format (e.g. slug vs. title-case vs. a different id space)
   means a join between `content_prompts.slug` and `carousel_drafts.style_id`
   silently matches **zero** rows and every carousel style's preview comes
   back empty — while the query "succeeds" (no error), so it reads as "no
   published examples yet" rather than "the join key is wrong." This is the
   single-most likely blank-board failure in the whole Styles section.

Single-image styles have the same lower-severity risk one level down: the
existing `aggregateImageStyleUsage()` (`lib/styleUsage.ts:29-46`) keys on
`taxonomy.image_style` as a raw string with no normalization
(`if (!style || typeof style !== 'string') continue;` — no `.toLowerCase()`
or slugify), so if `content_prompts` style-% titles are (e.g.) "Framework
Diagram" and stored `image_style` values are `"framework_diagram"` or
`"Framework Diagram"` with different casing/punctuation, the aggregation key
still won't match a `content_prompts` slug lookup unless the Styles section
does its own normalization layer that doesn't exist yet in this code.

**Exact DB check needed:**
```sql
select style_id, count(*) from carousel_drafts where style_id is not null group by style_id order by 2 desc;
select distinct taxonomy->>'image_style' from carousel_drafts where type='single_image' and status='published';
select slug from content_prompts where slug like 'style-%' and is_active=true;
```
Compare all three sets by exact string match before assuming any join works.

**Verdict: REFUTED** as currently scoped — the "aggregate from published
carousel_drafts" plan for carousel layouts rests on a column
(`style_id`) the prior audit didn't examine and whose write-population and
value-format are both unconfirmed; until the three queries above are run and
compared, assume 0-for-N previews resolve for carousel styles, and an
unknown fraction for single-image styles depending on casing drift.

---

## 5. Empty-vs-broken ambiguity — per surface, what "zero rows" means

| Surface | CORRECT-empty state | BROKEN-empty state (looks identical, is a bug) | How to tell them apart |
|---|---|---|---|
| Content — Ivan review queue | No posts currently in `status='review'` | Query filters on `client_id='ivan'` (literal string, never exists — see §1) or drops rows some other tenancy-column mismatch | Cross-check against a raw unscoped count: `select count(*) from carousel_drafts where status='review'` vs. the scoped query's count; if scoped=0 and unscoped>0, the filter is wrong, not the pipeline |
| Content — Ivan "needs scheduling" (approved, unscheduled) | No approved-but-unscheduled backlog | This bucket doesn't exist as a query at all yet (§3) — will read as "nothing to do" when there may be a real backlog | Must add the explicit `approved AND scheduled_at IS NULL` bucket and log its count on first ship; a nonzero count on day one that nobody noticed before is the proof this was previously invisible, not proof the new query is wrong |
| Content — Rise lane | Rise genuinely has nothing in the relevant stage this week (plausible — Rise content is client-approved on its own cadence) | RLS blocks the raw read entirely (§2), or the `client_id` filter value is wrong (§1) — both produce a silent `[]` | Compare the new query's row count against the SAME data pulled through the known-working `operator_client_drafts` RPC for the same client in the same session; any divergence is the query, not reality |
| Styles — carousel layouts | A style genuinely has zero published examples yet (plausible for a brand-new layout) | `style_id` is unpopulated or format-mismatched against `content_prompts.slug` (§4) — every style shows zero regardless of real usage | Run the three §4 queries once; if literally every carousel style shows a zero preview simultaneously, that is the tell (a real "just launched" style would be the rare exception, not the universal case) |
| Styles — single-image | A style has zero published posts | `taxonomy.image_style` casing/format drift against the `content_prompts` slug (§4) | Same tell as above — check whether the distinct `image_style` values found live even resemble the slug list before trusting a zero |
| AgentOps ports (n8nclaw_* tables) | No alerts/reminders/messages currently pending | Anon-key/RLS gap (the mission's own named central risk) — a table the inbox's session can't read returns `[]`/PostgREST error indistinguishable from "nothing pending" without checking for a thrown error first | The existing hooks (`useAgentData.ts`) don't surface fetch errors as a distinct UI state today (`useInbox.ts`/`useOps.ts` swallow errors to `loading:false`, per phase1d §3) — port must NOT repeat this; a genuine RLS-403/PostgREST error must render distinctly from a clean empty array, or this exact ambiguity ships into the new surface too |

General rule this run should hold itself to: **every new "queue" or "preview"
component must log (dev-console or a debug panel, not user-facing) the raw
unscoped count alongside the scoped count on first load** for at least the
verification phase — a scoped-zero next to an unscoped-nonzero is the single
cheapest signal that separates "starved" from "broken," and none of the
current dashboard or inbox code does this today (confirmed by reading the
fetch paths in both `useContentLibrary.ts` and `ops.ts`/`inbox.ts` — errors
and zero-result-sets are both silently treated as "just empty").

---

## Verdict summary

1. `client_id='ivan'` filter assumption — **REFUTED** (proven wrong: NULL, not `'ivan'`, is Ivan's value in `carousel_drafts`).
2. Raw `carousel_drafts` read seeing Rise rows — **NEEDS-DB-CHECK** (RLS posture for `authenticated` on client-owned rows is unproven; every existing Rise read goes through a SECURITY DEFINER RPC instead, which is suspicious but not conclusive).
3. Status vocabulary completeness — **REFUTED** (`status='approved'` with no `scheduled_at` is a live, code-confirmed black hole with zero read-side coverage anywhere in the current dashboard).
4. Styles preview aggregation — **REFUTED** (rests on an undocumented `carousel_drafts.style_id` column whose population and value-format vs. `content_prompts.slug` are both unconfirmed; single-image `taxonomy.image_style` matching has an unhandled casing/format-drift risk too).
5. Empty-vs-broken distinguishability — **REFUTED as currently unaddressed** (no surface in either repo — dashboard or inbox — currently distinguishes a genuinely-empty result from a filtered-to-empty or RLS-blocked one; this must be added, not assumed away, before Phase 4's "full population" checks can be trusted).
