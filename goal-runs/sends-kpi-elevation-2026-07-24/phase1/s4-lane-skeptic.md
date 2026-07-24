# S4 — Lane-bucket skeptic vs r4-lane-bucketing.md

Role: refute "lane_of() needs NO change — all 27 campaigns bucket correctly per the operator's model."
Method: live Supabase REST (read-only) + primary memory files. All queries re-run 2026-07-24.

## VERDICT: REFUTED (label-level, not CASE-mechanics-level)

The researcher's *mechanical* replication is clean — I re-ran the ilike CASE over all 27 names and got
identical lane assignments; no stray-substring misfire exists (attack 4 fails to land). What is refuted is
the *semantic* claim that the buckets are "correct per the operator's model (engager = engagers of that
account's own content)." Measured against that definition, the ivan `engager` lane is **0% own-content
engagers** — every sendable prospect and every sent connection in it was harvested from OTHER people's
audiences. The researcher's trigger_type evidence cannot see this, because `engaged_post` carries no
"whose post" dimension. The evidence was circular: "engager campaigns have engager-ish trigger_types."

---

## Attack 2 (LANDED — the load-bearing refutation): "engager" ≠ own-content engagers for ivan

Composition of the ivan/engager row the dashboard will show (sendable 92, sent_30d 122 in r4's own
cross-check), decomposed per campaign via live queries (icp≥7, pre-contact stages, not blacklisted;
sent-proxy = connection_sent_at ≥ 2026-06-24):

| Campaign | Whose audience? (primary source) | sendable | sent_30d proxy |
|---|---|---|---|
| Warm - LM Anchor Engagers | **Other creators'** LM-drop posts (Paolo Trivellato, Dylan). Campaign's own DB description: "People who engaged with **other creators'** lead-magnet-drop posts". Memory `lm-anchor-engager-lane-2026-07-05.md` confirms. | 69 | 38 |
| Warm - Kyle Engagers | **Kyle Hunt's** posts/reactions (Kyle = case-study client, not Ivan's account). `kyle-warm-lane-2026-07-01.md`. | 14 | 64 |
| Warm - Engagement Harvest | **Competitor + ICP-authority** posts — 16 harvest_sources: 3 competitors (Nadia Privalikhina, Carlos Delgado, Kenny Damian) + 13 agency-authority voices (Drew McLellan, Jason Swenk, …). `engagement-harvest-feed.md`: "harvests commenters off competitor/ICP-authority LinkedIn posts". Kyle Hunt explicitly EXCLUDED from this one. | 9 | 20 |
| Profile View — Ivan | Ivan's own presence (the only own-account signal) | 0 | 0 |
| **Total** | | **92** | **122** (matches view exactly) |

**Own-content engagers in the ivan engager lane: 0 of 92 sendable, 0 of 122 sent.** The r4 verdict on
"Warm - Engagement Harvest" ("100% engaged_post → Correct as-is") answered the wrong question: 100%
engaged with SOMEONE's post — none of them Ivan's. Note the irony: the researcher used exactly this
whose-content test to validate "RiseDTC — Warm (his engagers)" (Mattan's OWN posts → engager ✓) but never
applied it to the three ivan-side campaigns.

**Wrong-decision test (required by brief): FAILS — a wrong decision WOULD result.** An operator reading
"Engager: 92 sendable / 122 sent-30d" under the stated definition concludes his own LinkedIn content is
fueling half his outreach pipeline. It is fueling none of it — there is currently NO ivan-side lane that
captures Ivan's own post engagers into outreach_prospects (closest is the 4-prospect profile-view lane).
Two concrete bad reads: (a) crediting the content engine with outreach supply it doesn't produce, and
(b) NOT noticing that own-engager capture is a missing lane while believing it's already running. The
anchor-orbit mechanism is also Ivan's proven best channel (inmail-audit-sender: Kyle warm 6/41 vs cold
1/102, p=.002) — burying it inside "Engager" hides which mechanism actually converts.

### Exact change to make

Minimum (required — one line, no SQL): in the `LANE_LABELS` map (`src/lib/kpis.ts`, to be created),
label the lane honestly:

```ts
engager: "Engagers — harvested audiences (Kyle / anchors / authority posts), not own-content"
```

or the short form if space-constrained: **"Engager (harvested)"** with the long form as a tooltip/subtitle.

Optional clean fix (only if a 4th column is acceptable) — split harvest from true own-content engagers in
`lane_of()`, inserting BEFORE the current engager branch:

```sql
when camp_name ilike '%kyle engagers%' or camp_name ilike '%anchor%'
  or camp_name ilike '%engagement harvest%'                             then 'harvest'
when camp_name ilike '%engager%' or camp_name ilike '%profile view%'    then 'engager'
```

This keeps "RiseDTC — Warm (his engagers)" → engager (correct: Mattan's own content) and Profile View →
engager, while the three third-party-audience campaigns get their own honest bucket. With this split,
today's ivan/engager row becomes ~0/0 and ivan/harvest becomes 92/122 — which is the true state.

---

## Attack 1 (LANDED on reasoning, inert on impact): "Warm - Hiring Signal" is a COLD lane by the operator's own record

r4 line: "Correct — operator's own model explicitly puts 'hiring-signal warm lists' in the warm bucket."
The primary source contradicts this. `hiring-signal-feed.md` (the operator's own memory file) calls it,
verbatim: **"Highest-intent cold lane"** — a buy-now-intent *intercept* of companies scraped from LinkedIn
job postings via Apify. "Warm" in the campaign name means intent-warmth, not relationship-warmth. Live
sample row confirms sourced strangers: prospect "Free-Work UK" is a COMPANY (not a person) pulled from a
jobs-search URL, `enrichment_data.source='hiring_signal'`, no connection, no engagement, no prior
relationship of any kind. So per the operator's model (warm = existing network/orbit), this bucketing is
definitionally wrong, and the researcher's justification for it is refuted.

Why I still recommend NO change here: the lane is dead three ways over — RETIRED 2026-06-23 (Ivan's call,
"off the content_system narrow-door positioning"), then ICP-retired again 2026-07-01 ("off-ICP hired
non-owners"); all 90 prospects are blacklisted (89 archived + 1 skipped); `is_active=false` so sendable=0;
and its 59 historical connection sends (June 11–23) are outside every 7d/30d window, so it contributes
0/0/0 to `inbox_pipeline_v` (r4's own ivan/warm row confirms). A mislabel on a corpse cannot cause a wrong
decision. If it is ever revived, add `when camp_name ilike '%hiring%' then 'cold'` above the warm branch —
but do not spend a migration on it now.

## Attack 3 (FAILS — claim survives, with a caveat): description column is real, quote is verbatim

`outreach_campaigns.description` EXISTS. "RiseDTC — Warm (his engagers)" (id `8f72efb3`) description
contains verbatim: "Works anyone who likes/comments on HIS LinkedIn posts toward a booked call." Not
fabricated; the researcher's inference (Mattan's own content → engager) is sound and is in fact the ONLY
correctly-bucketed engager campaign under the strict own-content definition (alongside the profile-view
pair, n=6). Caveat that weakens description-as-evidence generally: descriptions are stale — both "RiseDTC
— Warm (his engagers)" and "RiseDTC — Cold (DTC Sales Nav)" say "BORN-DEAD (is_active=false)" while their
rows show `is_active=true`. The quoted sourcing-intent text is design-time truth, not runtime truth; r4's
own "re-verify trigger_type once armed" flag is the right hedge and should be kept.

## Attack 4 (FAILS): CASE replication finds no mechanical misses

Re-ran the ilike patterns by hand over all 27 live names (pulled fresh). Every assignment matches r4's
table. Checked specifically: no cold/vertical name contains warm/orbit/engager/anchor/engagement
harvest/profile view/network activation as a stray substring; "Paid-Media" does not hit '%anchor%';
both explicit "(Cold)" names fall through to the else-branch correctly; the three "warm+engager" names
resolve engager via branch order exactly as described. The researcher's mechanical audit stands.

## Secondary confirmations
- 17 campaign_id-NULL `room_census` prospects invisible to the view — reproduced conceptually from the
  view SQL (inner joins on campaign_id); r4's secondary finding stands.
- r4's sent_30d=122 for ivan/engager exactly equals my per-campaign connection_sent_at decomposition
  (64+38+20) — the view numbers are internally consistent; the problem is purely what the label claims
  they mean.

## Bottom line

- CASE mechanics: CONFIRMED, no misbucket against names.
- Semantic claim "all 27 bucket correctly per the operator's model": **REFUTED.** Three campaigns
  ("Warm - Engagement Harvest", "Warm - Kyle Engagers", "Warm - LM Anchor Engagers") sit in `engager`
  while containing 100% third-party-audience prospects — they are the ENTIRE ivan engager lane (92/92
  sendable, 122/122 sent-30d). "Warm - Hiring Signal"'s warm bucketing is also definitionally wrong per
  the operator's own memory ("Highest-intent cold lane") but is materially inert (retired, blacklisted,
  0 in-window).
- Required change: **relabel, don't necessarily re-bucket.** One-line UI copy:
  `engager: "Engager (harvested)"` — subtitle/tooltip: "Kyle / anchor / authority-post audiences — not
  engagers of your own content." Optional `harvest` 4th lane SQL provided above if lane-truth is wanted
  in the data layer itself.
