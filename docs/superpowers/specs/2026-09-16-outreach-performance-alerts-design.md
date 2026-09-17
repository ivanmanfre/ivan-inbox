# Outreach performance alerts in Strategy

Date: 2026-09-16. Status: design approved in chat by delegation ("you decide"); implementation not started.

## Why

Reply rate drops have three usual causes: the copy variant, the lane (list quality, the source batch), or the seat. Today the only per-lane read is the weekly funnel RPC the cap watchdog uses, and nothing compares variants or sources at all. The InMail follow-up note (1.4% vs 10.3%) was caught by hand. This feature makes that catch automatic and shows the suspect dimension with the numbers, per lane, inside the inbox Strategy tab.

Origin: Eric Nowoslawski's cold-email inbox rotation rules (daily reply-rate drop → pull inbox; Friday 200 sends and under 0.7% → cancel). Transposed to LinkedIn DMs as an alert, never an action.

## Scope

- Surface: ivan-inbox Strategy tab, a fifth view `Outreach`, per `ContentLane` (`ivan` | `risedtc` | `arch`). Authenticated only. Never on a client board, never anon.
- Rows counted: DM sends only. `outreach_messages` with `direction='outbound'`, `sent_at` not null, `message_type in ('dm','inmail')` (InMail identified by `channel='linkedin_inmail'`, see the sender's note that `message_type` is not the discriminator). Connection notes are OUT of v1 (their variant lives on `outreach_prospects.note_variant`, not on the message row). Manual mirrors (`ai_model='manual_mirror'`) excluded.
- Lanes shown: active only. A lane appears when its campaign is `is_active` and not `archived` AND it has at least one matured DM send in the 90-day window.
- Action: none. The page and the WhatsApp digest say what is off and what the suspect is. No auto-pause, no variant rotation, no copy edit (DM copy changes need Ivan's OK, standing rule).

## Dimensions

Every send resolves to:

| dimension | source of truth |
|---|---|
| client / seat | `outreach_campaigns.client_id` (NULL = ivan). One seat per client today, so seat = client. |
| lane | `lane_of(outreach_campaigns.name)` (current buckets: signal, partner, harvest, engager, warm, cold) |
| campaign | `outreach_prospects.campaign_id` |
| step | `outreach_messages.sequence_step`, labelled dm1 / nudge / dm3 / inmail |
| variant | `outreach_messages.ai_model` (template key, e.g. `arch_dm1_b_d2c`, `rise_dm2_nudge_v1`) |
| source | `coalesce(enrichment_data->>'source', enrichment_data->>'source_kind', enrichment_data->>'seed', 'unknown')` |
| country bucket | `outreach_prospects.country`, top 5 by volume per lane, rest = other |
| vertical (ARCH) | `coalesce(enrichment_data->'gate'->>'vertical', enrichment_data->>'vertical')` |

Source is a loose JSON key written by several harvesters. The RPC reads it as is and reports `unknown` honestly. Standardising the key is a separate, later change.

## Metric definitions

- Matured send: `sent_at <= now() - interval '7 days'`. Nothing younger is counted anywhere. (The 7-day accept rollback fired on immature data once; same trap here.)
- Reply for a send: an inbound `outreach_messages` row with `replies_to_message_id = send.id`, OR, when no threaded row exists, `outreach_prospects.last_reply_at > send.sent_at` and no later outbound send from the same step sits between them. The replay step (below) must report how often each branch fires so we know whether threading is reliable.
- Reply rate = replies / matured sends.
- Positive rate = replies with `reply_intent='positive'` / matured sends. Shown only where `reply_intent` is populated (RISE seat today). Ivan and ARCH show a dash, not zero.
- Current window: last 14 days of matured sends. Baseline: the 60 days before that. Table window: 90 days.

## Alarms

Floor: 20 matured sends per cell (was 30; lowered after the third live replay hid a 25-point fall at 22 sends). Below the floor a cell is displayed with its raw numbers and the label `too few to call`, and it can never fire.

1. Drift alarm, per lane × step. Fires when the current-window rate is below the baseline rate, the Wilson 80% upper bound of the current rate is still below the baseline, and the absolute gap is at least 3 points.
2. Sibling alarm, per variant within a lane × step, same window. Compared against the pooled rate of the other variants in that cell. Same test, same floor on both sides.

Attribution for a drift alarm: for each child dimension (source, variant, country bucket, vertical) split the current window and compute, per child value with n ≥ 15 and n smaller than the cell (a child that is the whole cell explains nothing), its rate against the lane baseline. The dimension whose worst child explains the largest share of the missing replies is the suspect. The alert card shows the suspect dimension's full split. If no child clears n ≥ 15, the card says `spread evenly across sources and variants at this volume`.

Alert copy shape (numbers from the RPC, no adjectives):

```
risedtc · cold · DM1
3.1% now (4 of 128) vs 9.2% prior 60d
Suspect: source
  competitor_engagers  2 of 71  (2.8%)
  own_engagers         6 of 40  (15.0%)
Variants: even
```

## Data flow

1. Migration `db/081_outreach_perf_payload.sql`: function `outreach_perf_payload(p_client_id text, p_days int default 90) returns jsonb`, `SECURITY DEFINER`, `REVOKE ALL FROM anon`, grant `authenticated, service_role`. Pattern copied from `audn_benchmark_payload`. Returns `{ generated_at, lanes: [{ lane, campaigns[], cells: [{step, n, replies, rate, positive_rate|null, baseline_n, baseline_rate, status: ok|thin|drift}], variants: [{step, variant, n, replies, rate, status: ok|thin|sibling}], alarms: [{kind, step, variant?, now, prior, suspect_dim?, split[]}], table: [{lane, step, variant, source, country, vertical, n, replies, rate}] }] }`. Ivan lane is `p_client_id = 'ivan'` mapped to `client_id IS NULL` inside the function (the tenancy rule).
2. `src/lib/outreachPerf.ts`: typed fetch of the RPC and pure helpers (`rankAlarms`, `formatAlert`, `filterActive`), unit tested with fixtures shaped from live rows.
3. `src/wb/content/OutreachBlock.tsx`: alerts first (cards), then `Lane × step` tiles, then the variant list per step, then a disclosure `All cells` with the raw table. Phone first; the view nav grid goes to three columns at ≤600px so five pills fit two rows. `.ct-card` opt-out `display:block` as documented in the Strategy tab memory.
4. `strategy.tsx`: add `{ id: 'outreach', label: 'Outreach' }` and mount `OutreachBlock` for that view.
5. n8n `Outreach - Perf Alerts (weekly)`: Monday 08:00 Warsaw, calls the RPC for the three lanes with the service key, posts one WhatsApp line per fired alarm through the existing `ivan-wa` sender, `[ARCH]` / `[RISE]` prefixes, nothing when no alarm fired. Created inactive, activated after one manual run reads correctly.

## Error handling

- RPC error: the block renders the existing `Failed` part with retry. No cached numbers shown as if fresh.
- Empty active lanes: the block says `No active lanes with DM sends in the last 90 days` and nothing else.
- Missing classification: positive rate renders a dash with the tooltip `no reply classification on this seat`.
- WhatsApp workflow: on RPC failure it posts one line `[perf] RPC failed: <head of error>` rather than silence.

## Verification (must pass before the view ships)

1. SQL unit run on the PGlite harness with a fixture that includes: a variant under the floor, a drift lane whose gap is explained by one source, a sibling loser, immature sends that must be excluded, and a reaction-only reply that must not count.
2. Replay against the LIVE corpus for all three lanes. Compare each lane's 14-day DM reply rate to `lane_chain_weekly` for the overlapping week. Any lane off by more than the maturation window explains is a failure. Report how often the threaded-reply branch vs the stamp fallback fires.
3. Playwright at 390px: tap into the Outreach view on each lane, alert card tappable, table disclosure opens, no overlap on `.ct-card`.
4. One forced run of the WhatsApp workflow with a known alarm in the fixture window.

## Out of scope (next adds, in order)

- Connection-note arm via `outreach_prospects.note_variant` (accept rate per variant per lane).
- Standardised `source` key across harvesters.
- Reply classification on the Ivan and ARCH seats (would extend positive rate to all lanes).
- Fixing the experiment ledger's step-level `variant_key` collision (`dm1_b_d2c` vs `dm1_h_d2c`), which this feature sidesteps by reading `ai_model` directly.
