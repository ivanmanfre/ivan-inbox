# S3 — Join-gap skeptic: adversarial audit of r3-scan-attribution.md

Role: refute-first audit of the "ivan-skew is true distribution" verdict. All numbers below
independently recomputed against live Supabase (`bjbvqvzbzczjbatgmccb`) on 2026-07-24 via
PostgREST with the service key from scratchpad (never written to repo).

## Headline

**The researcher's core verdict is WRONG.** Rise-origin scans DO exist — 47 of the 149 rows in
`scans` (31.5%) are RISE DTC-branded reports — and one of them (`neve-foods-7f`) belongs to a
live Rise Client-Orbit prospect and has **3 non-owner opens currently mislabeled `ivan`** by
`inbox_scan_opens_v`. The researcher's token / exact-slug / fuzzy-NAME matching was structurally
blind to this class: scans are slugged by **company** name while the matcher compared **person**
vanity slugs and person names, and the one prospect who opened has a provider-ID LinkedIn URL
(`/in/ACoAABo-spk…`) with no vanity slug to match at all. The correct view output today is
**ivan: 64 opens, risedtc: 3 opens** — not ivan: 67, risedtc: absent. "No SQL change needed" is
refuted.

---

## Per-claim verdicts

### Claim 1 — "100% of open-bearing scan slugs (19/19) have null prospect_token" → **CONFIRMED**

Independent full-population recount:
- `scan_opens?is_owner=eq.false` → **67 rows**, **19 distinct company_slugs** (identical list to r3).
- `scans?company_slug=in.(…19…)` → **19 rows, 19 distinct slugs** (1:1, no orphans, no dups
  within the matched set).
- Of those 19 scans rows: **0 have `prospect_token` not null**; all 19 `source='inbound'`.

The arithmetic is right. What's wrong is the *inference* drawn from it (Claim 2): null token ≠
ivan-origin. One of these 19 tokenless "inbound" scans is a Rise scan (see below).

### Claim 2 — "Zero Rise-linked scans exist … so the ivan-skew is true distribution, not a join bug" → **REFUTED**

The researcher matched Rise's 338 prospects against `scans.company_slug` by (a) token,
(b) exact LinkedIn **vanity slug**, (c) fuzzy **person-name** slug. All three probes are
person-keyed. `scans.company_slug` is **company**-keyed. The matcher could never have found a
Rise scan for a prospect whose scan is slugged by her brand.

Independent evidence chain:

1. **47 of 149 `scans` rows are Rise-branded.** Each carries
   `report_json->dtc->brand` = `{"wordmark":"RISE DTC", "logo_url":"https://risedtc.com/…/Rise-DTC-logo…",
   "booking_url":"https://meetings.hubspot.com/mattan5/rise-intro-call--li", accent #ffc71d}`.
   All 47 are `source='inbound'`, `prospect_token=null` — indistinguishable from Ivan's inbound
   scans by every column the view joins on. (Wordmark distribution across all 149:
   RISE DTC = 47, none/ivan = 102.) Most were batch-created 2026-07-21 14:40–16:44 (the
   meta-ads-coverage Apify lane) — DTC apparel/cosmetics brands: `dirtbag-clothing-2d`,
   `sukar-cosmetics-b0`, `gymshark-0f`, `gopure-d1`, `the-rodial-group-aa`, …
2. **One Rise-branded scan is open-bearing: `neve-foods-7f`** (created 2026-07-22 01:50,
   domain `eatneve.com`, company_name "Neve Foods"). It has **3 `is_owner=false` opens**
   (07-22 03:21 desktop, 07-22 15:52 mobile, 07-23 14:47 desktop referred by `www.linkedin.com`).
3. **That scan maps to a Rise prospect.** `outreach_prospects` has **Nora Fierman, company
   "Neve Foods"** (id `bb842d9a-daa5-42fa-ad62-9336e68e704c`), campaign
   `a2194be6-6c18-429c-873e-2a120e505250` = **"RiseDTC — Client Orbit (clients' networks)"**,
   `client_id='risedtc'`, `stage='dm_sent'`, `last_dm_sent_at = 2026-07-22T03:20:42Z`.
4. **Causal clincher:** her scan's first non-owner open is `2026-07-22T03:21:07Z` — **25 seconds
   after the DM went out**, and the 07-23 open arrives via `www.linkedin.com`. This open chain
   is Rise outreach traffic, full stop. It is being counted in ivan's 67.
5. Why r3's matcher missed her: her `linkedin_url` is
   `https://www.linkedin.com/in/ACoAABo-spkBJHHYUk0Rh7pj2t8ivHfTCL5GQxA` — a provider ID, no
   vanity slug to match — and "nora-fierman" fuzzy-name never resembles "neve-foods-7f".
   r3's "all 338 have one [vanity slug]" is therefore also wrong for at least this prospect.

Blast radius today: 3 of 67 opens (4.5%) and 1 of 19 distinct slugs. Corrected view output:
`ivan: opens_total 64, opens_7d 35, distinct 18` / `risedtc: opens_total 3, opens_7d 3, distinct 1`.
The skew is still ivan-heavy, but the claim under attack — "zero Rise-attributable opens, view
correctly shows no risedtc row" — is false, and the 47-scan Rise cohort means the mislabeling
**grows with every future Rise scan-funnel open** (the pipe is not empty; it's mislabeled).

Side note: one more Rise-referred open exists (`gopure-d1`, `referrer_host=resources.risedtc.com`,
07-21) but is `is_owner=true`, so correctly excluded. Across all 47 Rise-branded slugs: 93 total
opens, 90 owner (demo/testing), 3 non-owner — all three on `neve-foods-7f`.

### Claim 3 — "DISTINCT ON … NULLS LAST correctly prefers tokened rows" → **CONFIRMED (semantics only; untested by live data)**

- Live: `scans` has **149 rows, 149 distinct `company_slug`, zero duplicate-slug groups** —
  independently recounted. There is no live case (mixed-token or otherwise) exercising the
  dedup; `andyalagappan` vs `andy-alagappan-ceo-demand-gen-82` are **different slugs** and never
  meet inside one `DISTINCT ON` group. The researcher said the same; verified true.
- Semantics: `ORDER BY company_slug, prospect_token NULLS LAST` is ascending with an explicit
  nulls-last directive, so non-null tokens sort first; `DISTINCT ON (company_slug)` keeps the
  first row per group → a tokened row beats a tokenless one. Correct as written.
- Unclaimed caveat worth recording: if a slug ever has **two different non-null tokens**, the
  winner is the lexicographically smallest token string — arbitrary, not recency-based. Dormant
  today (only 1 tokened row in the whole table), but it's a latent trap if token backfills land.

### Claim 4 — "Correct remedy = honest UI label ('no tokened scans generated yet'), no SQL change" → **REFUTED**

Two failures:

1. **The proposed label is itself dishonest.** "No tokened scans generated yet" implies Rise has
   produced nothing. Rise has produced **47 scans** and **1 prospect-opened report with 3 opens**.
   The true statement is "Rise scan opens exist but are unattributable by the current join."
2. **A data/SQL change IS required**, because tokenless Rise-funnel scans are structurally
   invisible to the token join and default to ivan. Exact fix:

   **(a) Immediate backfill (makes the existing view correct today, no view change):**
   ```sql
   update scans
   set prospect_token = 'bb842d9a-daa5-42fa-ad62-9336e68e704c'  -- Nora Fierman, Neve Foods
   where company_slug = 'neve-foods-7f' and prospect_token is null;
   ```
   After this, the existing join resolves neve-foods-7f → campaign a2194be6 → `risedtc`, and the
   view emits ivan 64 / risedtc 3 with zero SQL edits.

   **(b) Structural fix for the class (required before Rise funnel volume grows):** the Rise
   generator already stamps every scan with its brand block, so either add a `scans.client_id`
   column populated at insert (clean), or derive it in the view's dedup subquery (works on all
   47 existing rows today):
   ```sql
   left join (
     select distinct on (company_slug) company_slug, prospect_token,
            case when report_json->'dtc'->'brand'->>'wordmark' = 'RISE DTC'
                 then 'risedtc' end as brand_client
     from scans order by company_slug, prospect_token nulls last
   ) sc on sc.company_slug = so.company_slug
   ...
   coalesce(c.client_id, sc.brand_client, 'ivan') as client_id
   ```
   Without (b), every future open on the 46 other Rise-branded scans silently inflates ivan's KPI.

### Side-claim — "4 identifiable ivan prospects among the tokenless slugs" → **CONFIRMED at name level (evidence standard weaker than stated)**

Spot-verified `rudra-ghosh-98`: `outreach_prospects` has **Rudra Ghosh, Basecom**,
`linkedin_url = linkedin.com/in/rudra-ghosh-370652180`, campaign
`0aaf1db1-4cdc-41f6-a033-87fdde6eb78e` = **"Warm - Kyle Engagers"**, `client_id=null` (ivan),
`stage='archived'` — matching r3's campaign attribution. But r3's stated evidence standard
("exact vanity-slug substring") is not literally met: the scan slug is `rudra-ghosh-98`
(name + hash suffix), the vanity is `rudra-ghosh-370652180`; only the name prefix matches.
Same-person identification is plausible (name + campaign coherence), not slug-proven. The
ivan-scoped conclusion stands; the method description oversells its precision — the same
name-level matching, applied to *companies* instead of persons, is exactly what would have
caught Neve Foods.

---

## Summary table

| # | Claim | Verdict | Independent numbers |
|---|-------|---------|---------------------|
| 1 | 19/19 open-bearing slugs token-null | CONFIRMED | 67 opens, 19 slugs, 19 scans rows, 0 tokened, all inbound |
| 2 | Zero Rise scans → skew is true distribution | **REFUTED** | 47/149 scans Rise-branded; neve-foods-7f = Rise Client-Orbit prospect (dm_sent 03:20:42, first open 03:21:07) with 3 mislabeled non-owner opens; truth = ivan 64 / risedtc 3 |
| 3 | DISTINCT ON dedup prefers tokened rows | CONFIRMED (semantics); untested live — 149/149 distinct slugs, 0 dup groups; latent arbitrary-pick if two tokens ever share a slug |
| 4 | UI label only, no SQL change | **REFUTED** | Backfill neve-foods-7f token (query above) + structural client attribution for the 47-row Rise cohort (scans.client_id or wordmark coalesce) |
| — | 4 identifiable ivan prospects (spot: rudra) | CONFIRMED (name-level) | Rudra Ghosh / Basecom / Warm - Kyle Engagers / client_id null; slug suffix -98 ≠ vanity -370652180, so name-match not slug-match |

## Working notes (queries)

- Population: `scan_opens?select=company_slug&is_owner=eq.false` (67), distinct in Python (19).
- Join: `scans?company_slug=in.(…19…)&select=company_slug,prospect_token,source` (19/19, 0 tokened).
- Dup groups: full `scans?select=company_slug,prospect_token,source` (149 rows, 149 distinct, 1 tokened = andyalagappan/outreach).
- Sibling-table probes: `rise_scans`, `scan_reports`, `risedtc_scans`, `client_scans`, `scans_v2`, `scan_results`, `scan_leads`, `scan_requests` → all 404. `scans` has no `client_id` column (full-row dump).
- Rise detection: `scans?select=…,report_json->dtc->brand->>wordmark` → 47 × `RISE DTC`.
- Referrers: non-owner referrer_hosts = {null:51, www.linkedin.com:12, 185.199.109.153:2, 185.199.111.153:1, bing.com:1}; one `resources.risedtc.com` referral exists but is_owner=true (gopure-d1).
- Opens on the 47 Rise slugs: 93 total, 90 owner, 3 non-owner (all neve-foods-7f).
