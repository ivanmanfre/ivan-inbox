# F3 — Scan-report opens attribution: ivan-skew verdict

Read-only audit against live Supabase (`bjbvqvzbzczjbatgmccb`), run 2026-07-24.
View under test: `db/007_kpi_scan_opens.sql` → `inbox_scan_opens_v`.
All queries via `curl` against PostgREST with the service key from scratchpad (never written to repo).

## Headline verdict (read this first)

**The ivan-skew is a TRUE DISTRIBUTION, not a join bug.** Zero scans in the `scans` table
(149 total) are traceable — by token, by exact LinkedIn vanity slug, or by fuzzy name match —
to any of the 338 prospects sitting in Rise's 5 campaigns. Rise has not generated a single
scan-report view yet, tokened or not. The view's 100%-ivan output is the correct rendering of
that fact, not evidence of a broken join. There is one small, real, unrelated join gap (below)
that undercounts *ivan's* internal campaign attribution slightly, but it does not touch Rise
and does not change the client-level number.

---

## 1. Headline computation (non-owner opens → token resolution)

Query: `scan_opens?select=company_slug&is_owner=eq.false` → **67 rows**, `Prefer: count=exact` confirms `0-0/67`.

- **(a) Distinct open-bearing slugs:** 19
  (`alex-ayre-1b, andy-alagappan-ceo-demand-gen-82, anthony-hodges-94, antoine-gagn-96, george-kapernaros-f9, graeme-roberts-c7, hal-smith-5f, jenny-plant-31, jeremy-c-adams-9f, jonathan-saeidian-e1, mike-gleba-58, natalie-hogg-d2, neve-foods-7f, rachel-woods-b5, rudra-ghosh-98, shannon-b-ff, simon-long-a3, ste-bell-dc, teo-olarescu-d0`)
- **(b) Of those, matched to a `scans` row at all:** **19 / 19 (100%)** — `scans?company_slug=in.(...)` returned exactly one row per slug, no orphans.
- **(c) Of those, `prospect_token` not null:** **0 / 19 (0%)**. All 19 matching `scans` rows have `prospect_token = null`, `source = 'inbound'`.
- **(d) Of the tokened ones (0), resolving to client `risedtc` vs null/ivan:** N/A — there are zero tokened rows in this set to resolve.

**Null-rate: 100%** of open-bearing scans carry no `prospect_token`. Every one of the 67
non-owner opens therefore coalesces to `client_id = 'ivan'` per the view's `coalesce(c.client_id,'ivan')`.

---

## 2. Join-gap check

### 2a. Orphan opens (open-bearing slug with no `scans` row)
**None.** All 19 open-bearing slugs matched a `scans` row exactly (see 1b). No orphan case exists
in the current data — the hypothesis of a suffix-mismatch orphan class did not materialize for
this set.

### 2b. Duplicate `scans` rows per slug (testing the `DISTINCT ON ... ORDER BY ... NULLS LAST` behavior)
Checked the **entire** `scans` table (149 rows): **149 distinct `company_slug` values, zero
duplicates.** There is currently no live case where the view's dedup logic (`distinct on
(company_slug) ... order by company_slug, prospect_token nulls last`) has to choose between a
tokened and a tokenless row for the same slug — the collapsing logic is dormant, not exercised,
in the current dataset.

Semantic check (since it can't be empirically tested live without writing data, which is out of
scope for a read-only audit): Postgres `NULLS LAST` sorts non-null values before null
regardless of ascending/descending direction. `DISTINCT ON (company_slug)` keeps the **first**
row per group under the `ORDER BY` clause. So if a slug ever *did* have two `scans` rows — one
tokened, one not — the tokened row would sort first and win. **The ordering logic is correct as
written**; it's just unverified live because no duplicate-slug case exists yet to exercise it.

### 2c. A real (but Rise-irrelevant) join gap found by cross-checking names
The one live near-miss: `scans` has exactly **one** tokened row, slug `andyalagappan`
(`source=outreach`, `prospect_token=01ae433b-9572-42c9-8d09-880b3f77f6b1` →
`outreach_prospects.linkedin_url = linkedin.com/in/seoppcguru`, campaign `Warm - LM Anchor
Engagers`, `client_id=null`→ivan). Meanwhile one of the 19 **open-bearing** slugs is
`andy-alagappan-ceo-demand-gen-82` (`source=inbound`, `prospect_token=null`) — almost certainly
the *same person*, re-scanned via a path that generated a different, longer slug (name+title
suffix) instead of matching the original short vanity slug. This is a real slug-generation
non-idempotency bug, but it (i) doesn't touch the ivan/risedtc split — both slugs are ivan-owned
campaigns — and (ii) doesn't explain the skew, since the "correct" merge would still land on
`ivan`.

Separately, by matching `outreach_prospects.linkedin_url` (exact vanity-slug substring) against
the 19 open-bearing slugs, 3 more of the "inbound/tokenless" opens turn out to be identifiable,
real outreach prospects who simply weren't tokened when they re-opened their report:
`rudra-ghosh-98`, `antoine-gagn-96`, `hal-smith-5f` — all three sit in the **same** campaign,
`Warm - Kyle Engagers` (`client_id=null`), two of them at `stage='positive_reply'`. `graeme-
roberts-c7` similarly matches a prospect in `Agency-Focused Consultants & Fractionals`
(`client_id=null`), also `stage='positive_reply'`.
**All four of these campaigns are ivan-owned (`client_id=null`).** Fixing this class of gap
would improve *sub-campaign* attribution granularity for ivan's own book; it would not create
or reveal any risedtc opens.

---

## 3. Cross-check: live view output vs hand computation

Live `GET inbox_scan_opens_v`:
```json
[{"client_id":"ivan","opens_7d":38,"opens_30d":67,"opens_total":67,"distinct_prospects":19,"last_open":"2026-07-24T13:41:36.374537+00:00"}]
```

Hand computation from raw `scan_opens` (`is_owner=false`, 67 rows), independently in Python:
- opens_7d = 38, opens_30d = 67, opens_total = 67, distinct slugs = 19, last_open =
  `2026-07-24T13:41:36.374537+00:00`.

**Exact match on every field.** There is no `risedtc` row in the live view output at all — correct,
since there are zero risedtc-attributable opens (see §4). The view is computing exactly what
the raw data says.

---

## 4. Does Rise have any scans at all?

- Total `scans` rows: **149** (unchanged from build-time notes: `inbound=147, outreach=1,
  hypertarget_pilot=1` — confirmed live, identical distribution today).
- Scans with non-null `prospect_token`: **1** (the `andyalagappan` row above), which resolves to
  an **ivan**-owned campaign (`Warm - LM Anchor Engagers`, `client_id=null`), not risedtc.
- **Scans resolving to a risedtc-campaign prospect: 0.**
- Cross-check for a broken join masking Rise data: pulled all **338** prospects across Rise's 5
  campaigns (`RiseDTC — Network Activation`, `— Warm (his engagers)`, `— Cold (DTC Sales Nav)`,
  `— Client Orbit`, `— Profile View`), extracted each one's LinkedIn vanity slug (all 338 have
  one) and also each one's `name`-derived slug, and diffed both sets against **all 149**
  `scans.company_slug` values (not just the 19 open-bearing ones). **Zero exact matches, zero
  fuzzy name matches.** No Rise prospect — sent to, warm, or engager — has ever generated a
  `scans` row, tokened or not.
- Consequently: **no slug in `scan_opens` can possibly resolve to risedtc**, because the
  precondition (a Rise-linked `scans` row) doesn't exist yet anywhere in the data, let alone
  among the 19 that received opens.

---

## 5. Owner-exclusion honesty check (light)

`scan_opens` totals: `is_owner=true` → **273**, `is_owner=false` → **67**, table total → **340**
(273+67 = 340, consistent).

Sampled the 20 most recent `is_owner=false` rows:
- **10 distinct user-agent strings** across 20 rows — real diversity across macOS/Windows/
  iPhone/Android, Chrome 141/142/150, mobile Safari. No single dominant fingerprint that would
  suggest one person's owner-session leaking through as "non-owner."
- `referrer_host`: 5/20 came from `www.linkedin.com` (organic post/DM click-throughs), 15/20
  direct/no-referrer (link pasted or opened from DM/email) — a normal split for cold-outreach
  scan links.
- `device_type`: 16 desktop / 4 mobile — plausible.
- **Flag (not owner-leakage, a separate data-quality note):** 3 of the 20 rows carry a
  `HeadlessChrom[e]` user-agent — consistent with a link-preview bot (Slack/LinkedIn unfurl,
  monitoring tool) rather than a human open. This is minor (≤15% of the sample) and doesn't
  explain the ivan/risedtc skew, but it does mean `opens_total` is very slightly inflated by
  non-human traffic. Not in scope to fix here; flagging for a future pass if `opens_total` is
  ever used as a precision metric rather than a directional one.
- No pattern found suggesting owner clicks are misclassified as `is_owner=false`.

---

## 6. Verdict and recommendation

**Verdict: TRUE DISTRIBUTION, not a fixable join bug — for the ivan/risedtc split specifically.**
The join chain in `007_kpi_scan_opens.sql` is implemented correctly (confirmed by §2b/§3): it
does exactly what it should with the data that exists. The 100%-ivan skew is real because:
1. 100% of the opened scans this month have `prospect_token = null` (inbound source), and
2. Independently, **zero** of Rise's 338 prospects have ever produced a `scans` row at all —
   tokened or not — by any matching method tried (token, exact slug, fuzzy name).

There is a small, genuine, ivan-scoped join gap (§2c: `andy-alagappan`/`andyalagappan` slug
drift, and 3 more tokenless-but-identifiable warm-engager prospects) that is worth fixing for
sub-campaign attribution quality, but it is orthogonal to the Rise question and would not move
a single open into the `risedtc` bucket.

**What would change it:** Rise needs to start generating scan-report links through the tokened
outreach flow (the same mechanism that produced the one `andyalagappan` / `source=outreach` row)
— i.e., Rise prospects need to actually receive and open scan reports with `prospect_token` set
to their `outreach_prospects.id`. Until that happens, there is structurally nothing for the view
to attribute to `risedtc`; the pipe is empty, not clogged.

**Optional fix-pack for the ivan-scoped gap (§2c), if worth doing later — not required for the
Rise question:**
```sql
-- Example: backfill prospect_token on scans rows where the slug uniquely matches
-- an outreach_prospects.linkedin_url vanity slug, for tokenless 'inbound' scans.
-- (Illustrative only — verify each candidate manually before running; slug-to-vanity
-- matching is not guaranteed unique or safe to automate blindly.)
update scans s
set prospect_token = p.id::text
from outreach_prospects p
where s.prospect_token is null
  and s.source = 'inbound'
  and s.company_slug <> p.linkedin_url  -- avoid trivial no-ops
  and lower(regexp_replace(split_part(p.linkedin_url, '/in/', 2), '[/?].*$', '')) = s.company_slug;
```

**Recommended honest UI label:** Do not present the dashboard's "ivan: 67 opens" next to a
"risedtc: 0 opens" as if they're comparable performance numbers — that implies Rise's outreach
isn't converting to opens, when the real story is Rise's tokened-scan pipeline hasn't produced
a single traceable scan yet. Label it explicitly, e.g.:
> "Scan-report opens (tokened attribution only) — Rise: no tokened scans generated yet."
or suppress the risedtc row entirely with a footnote rather than implicitly zero-filling it,
so nobody reads "0" as "underperforming" instead of "not yet instrumented."
