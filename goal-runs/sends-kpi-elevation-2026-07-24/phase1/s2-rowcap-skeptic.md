# S2 — Row-cap / phantom-burst skeptic audit of r2-campaign-counts.md

Adversarial re-verification, 2026-07-24, all queries run independently against live Supabase
(`bjbvqvzbzczjbatgmccb`). Mandate was to REFUTE. I could not — every load-bearing claim reproduced, and I
resolved the 587-duplicates contradiction with commit-level evidence. One inferential sentence in the
researcher's doc is wrong (flagged below), one 2-row semantic delta between their ground-truth table and their
proposed view needs to be stated before shipping.

## Verdicts

| # | Claim | Verdict |
|---|---|---|
| 1 | PostgREST silently caps `.limit(4000)` to 1000 rows; Campaigns block undercounts by ~409 rows / 12 campaigns misreported | **CONFIRMED** — for the app's actual role (authed user), both via `Range` header and via the exact supabase-js `?limit=4000` URL-param form |
| 2 | Phantom-duplicate burst no longer exists (0 dupes among sent rows) | **CONFIRMED as of 07-24** — contradiction with the 07-22/23 build resolved: the ~800 phantom rows were **physically deleted** from `outreach_messages` between 07-22 and 07-24. Researcher's alternate hypothesis "or it never existed among sent rows" is **REFUTED** by commit adcd630 |
| 3 | 14 deduped sends belong to campaign_id-NULL prospects and are invisible in `inbox_messages_v` | **CONFIRMED** — exactly 14, all `dm`, dropped by the inner join at `db/001_inbox.sql:13-15`; 1423 − 14 = 1409 reconciles to the row exactly |
| 4 | Proposed `inbox_campaign_sends_v` SQL is correct | **CONFIRMED** with two required disclosures (message_type filter shifts one campaign by −2 vs the doc's own ground-truth table; see §5) |

## 1. Row cap — independent reproduction, including the role the app actually runs as

Query in all cases: `inbox_messages_v?select=…&direction=eq.outbound&sent_at=not.is.null&order=sent_at.desc`.

| Role / form | Result |
|---|---|
| service_role, `Range: 0-3999` | `content-range: 0-999/*`, **1000 rows** returned |
| service_role, `Prefer: count=exact` | `content-range: 0-0/1409` (view total) |
| **authed user** (session minted via `scripts/dev-login.mjs`, anon apikey + user Bearer — the app's exact posture), `Range: 0-3999` | `content-range: 0-999/*`, **1000 rows** |
| **authed user, `?limit=4000` URL param** (the literal form supabase-js `.limit(4000)` emits) | **1000 rows** |
| authed user, exact count | `content-range: 0-0/1409` |
| anon key alone (no user token) | HTTP 200, **0 rows** (RLS) |

**Explicit answer on the anon-role cap:** PostgREST's `max-rows` is server-global here — service and authed
both cap at **1000**. The bare anon role is moot: RLS returns it zero rows, so an unauthenticated app session
would show an all-zero Campaigns block, not an undercount. The role that matters (authenticated user) hits the
1000 cap. **The "maybe authed returns 4000" escape hatch is closed; the finding stands.**

Undercount arithmetic independently reproduced: authed capped pull (1000 rows) run through the exact
`fetchCampaignSends` dedup+group logic sums to **1000**; full ground truth sums to **1409**; delta **409**.
My replicated "Current UI" numbers match the researcher's table on every campaign I checked:
Agency-Focused 199, Manufacturing & Industrial Ops 0, RiseDTC Cold 42, Accounting & Tax 85, Warm - Kyle
Engagers 156.

## 2. The 587-duplicates contradiction — resolved: the data changed

Full pull of **ALL 1637 outbound rows** (no `sent_at` filter — closing the "researcher's filter hid them"
attack), paginated 1000/page, grouped every way that matters:

- Key `(prospect_id, sent_at, message_text)`: **2 dup groups, 4 surplus rows total** — both groups are ×3
  copies of unsent DM drafts (`sent_at IS NULL`, prospects `d3c52c76…`, `8e52e98c…`). Invisible to both the
  app query and the proposed view (both filter `sent_at not null`), and trivially collapsed by the dedup guard
  regardless.
- Adding `message_type` to the key: same 4 surplus rows — **the dedup-key-mismatch hypothesis is dead**; all
  historical dupes were `dm` on both keys.
- Among `sent_at not null` rows (1423): **0 surplus** — 1423 → 1423 after dedup. Matches researcher.
- Brian Gerstner (the documented 587-copy victim, prospect `943f2abb-34a0-4c62-a51e-c860ed1c2790`): **3**
  outbound rows total today.

Why the build run saw 587 one day earlier — commit `adcd630` (2026-07-22 17:27 -0300), "collapse phantom
duplicate sends (insert-loop left **816 dup DM rows**)", measured live at commit time: "DM sent_total
**1033 → 203 real**". So on 07-22 the phantom rows existed **with `sent_at` set** (sent_total counts
non-null `sent_at` only). Today raw DM sent rows = **229 with zero duplicates**, and outbound-total is 1637
(not ~2450), non-sent outbound is only 214 (not ~1000, ruling out "sent_at was nulled instead of deleted").

**Conclusion: someone hard-deleted the ~800+ phantom rows from `outreach_messages` between 07-22 and 07-24.
Both observations were true at their respective moments.** The researcher's measurement is correct, but their
sentence "…or it never existed among *sent* (non-blocked) rows" (r2 §1) is **refuted** — adcd630's 1033→203
measurement proves the burst lived among sent rows on 07-22. Keep the `distinct on` guard in the view: the
insert-loop class of bug produced it once and nothing prevents a recurrence.

## 3. The 14 orphan sends — confirmed against the view definition

`db/001_inbox.sql:13-15` is a plain **inner** `join outreach_prospects p … join outreach_campaigns c on
c.id = p.campaign_id` — any prospect with `campaign_id IS NULL` drops out, no error. Independent full-table
join in Python: exactly **14 deduped sent rows** whose prospect has `campaign_id NULL`; all
`message_type='dm'`; `sent_at` 2026-07-17 **19:06:42 → 19:10:42** UTC (researcher wrote "19:06–19:20" — the
real span is 4 minutes, trivial overstatement, same rows). Zero sends with a missing prospect row; zero with a
dangling `campaign_id` (matches researcher's `missing_campaign_row = 0`). Reconciliation is exact:
`outreach_messages` sent = 1423, minus 14 orphans = **1409** = `inbox_messages_v` count. (The 2
`audit_delivery` rows DO join — they're not part of this gap.)

## 4. Spot-check of the ground-truth table (independent full pull + Python join)

| Campaign | Researcher | My independent count | Match |
|---|---:|---:|---|
| Agency-Focused Consultants & Fractionals (big) | 331 | **331** | yes |
| Manufacturing & Industrial Ops (paused, UI shows zero) | 29 | **29** (UI-replica: 0) | yes |
| RiseDTC — Cold (DTC Sales Nav) (Rise) | 42 | **42** | yes |
| Accounting & Tax Advisory Firms (bonus) | 153 | **153** (UI-replica: 85) | yes |
| Total across 27 campaigns | 1409 | **1409** (21 campaigns with ≥1 send) | yes |

## 5. Proposed view SQL — line-by-line attack results

- **Zero-send campaigns appear:** yes — `from outreach_campaigns c LEFT JOIN dedup d` keeps all 27 campaigns;
  `count(d.sent_at)` yields 0 on no-match (COUNT of NULL). Correct direction.
- **Client scoping:** `coalesce(c.client_id, 'ivan')` present and matches the `inbox_messages_v` convention.
  This also *fixes* a real trap: the raw table stores Ivan as NULL, so the TS sketch's server-side
  `.eq('client_id', client)` against the view now works (it silently matched nothing against the raw table —
  the current code comments at `sends.ts:183-185` document that exact trap).
- **security_invoker=on:** present. Same posture as `inbox_messages_v`, which the authed user demonstrably
  reads — base-table RLS/grants are already compatible.
- **Join by campaign_id, not name:** yes (`d.campaign_id = c.id`). Kills the latent name-collision landmine.
- **distinct on validity:** `order by m.prospect_id, m.message_text, m.sent_at, m.id` — leading columns match
  the `distinct on` list, `m.id` is a deterministic tiebreaker. Valid Postgres, mirrors `inbox_sends_v`.
- **Orphans:** the dedup CTE joins prospects but not campaigns, so the 14 NULL-campaign sends survive dedup and
  then correctly fall out at the LEFT join (NULL never equals `c.id`). Disclosed by the researcher; correct.
- **message_type filter — the one thing that changes numbers:** the current UI counts ALL outbound types (no
  filter); the view restricts to `('connection_note','dm','inmail','email')`. Live delta is exactly **2 rows**,
  both `message_type='audit_delivery'`, both in **"Warm - Engagement Harvest"** (campaign
  `7695d36d-df7e-4344-9ec5-a206b5dbfab0`, sent 2026-06-15). Consequence the researcher did NOT state: **their
  own ground-truth table (built with no type filter) shows Warm - Engagement Harvest = 64, but the shipped view
  will report 62.** Every other campaign is identical filtered vs unfiltered (verified per-campaign).
  **Semantics ruling: the filter is CORRECT.** The block's intent is "sends per campaign", and every sibling
  KPI surface (`inbox_sends_v`, `inbox_sends_daily_v`, `inbox_accept_v`) already defines "sent" as those 4
  real outreach channels; `audit_delivery` is an artifact-delivery event, not an outreach send. Keeping the
  filter makes the Campaigns block sum-consistent with the Sends totals block instead of disagreeing with it
  by 2. Ship the filter, but the acceptance check for the migration must expect **62, not 64**, on
  Warm - Engagement Harvest — otherwise someone will "fix" a non-bug.
- **No corrected SQL needed.** The view as written is correct for the stated semantics.

## 6. Method / raw evidence

- Keys: service key from scratchpad (never written to repo); anon key from `.env.local`; authed session minted
  live via `node scripts/dev-login.mjs` (`im@ivanmanfredi.com`, `.session.json`).
- Full pulls (service role, paginated 1000/page): `outreach_messages` outbound 1637 rows (count header
  `0-0/1637`; table total any-direction 1754); `outreach_prospects` 6271 rows; `outreach_campaigns` 27 rows.
- Dedup/dupe-hunt, orphan join, and per-campaign grouping in Python (script + JSON dumps in session scratchpad:
  `audit.py`, `svc-pull.json`, `authed-pull.json`, `authed-limitparam.json`, `bycamp.json`).
- Deduped-sent message_type census: connection_note 1009, dm 229, inmail 167, email 16, audit_delivery 2
  (= 1423; view population after type filter = 1421; after campaign inner-join = 1407 attributed + 14 orphans).
- Commit evidence: `git show adcd630` (2026-07-22 17:27 -0300) — "insert-loop left 816 dup DM rows",
  "DM sent_total 1033 -> 203 real"; comments in `db/003_sends_views.sql:1-6` and `src/lib/inbox.ts:37`
  ("587 copies of one June-13 DM to Brian Gerstner").
