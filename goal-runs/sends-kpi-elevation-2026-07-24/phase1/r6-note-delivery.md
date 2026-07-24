# F6 — Connection-note delivery distinction (audit, read-only)

## Question
Does the system record whether an invite note actually went out, vs LinkedIn/UniPile
silently rejecting/dropping it (free-seat note-cap), so the inbox Sends log can show
"connection sent without note" instead of asserting a note that may never have landed?

## Verdict: (b)/(c) hybrid — the sender KNOWS how to branch on a thrown UniPile error and
DOES persist a distinguishing signal in that case, but empirically this pathway has
**never fired** across current production volume. The DB rows for the 7 named prospects
(and 143/143 current `connection_sent` rows system-wide) show zero evidence the
fallback-without-note branch has ever executed. That means either (i) the seat in use has
enough note quota that it never hits the LinkedIn cap, or (ii) LinkedIn/UniPile silently
accepts/strips the note without throwing an error the code can catch — in which case the
"note text = delivered" claim in the DB is unverified for every row.

**For the UI today: the honest render is "note text = what we ATTEMPTED to send," not a
delivery certainty.** Per-row certainty does not exist in the data as it stands, except in
the rare case `note_variant = 'F'` (see below), which has never yet occurred.

## 1. DB evidence

### outreach_messages — full column list (bjbvqvzbzczjbatgmccb, GET one row)
`id, prospect_id, direction, message_text, message_type, sequence_step,
unipile_message_id, unipile_chat_id, sent_at, read_at, prompt_page_id, ai_model,
created_at, matched_content_type, matched_content_title, matched_content_url,
industry_cluster, channel, approved_at, recipient_email, email_step,
email_sequence_stopped_at, email_sequence_stopped_reason, send_blocked_reason,
send_blocked_at, replies_to_message_id, is_reaction, qa_total, qa_decision,
qa_dim_scores, qa_banned_hits, qa_run_at, qa_retry_count, qa_rewrite_hint,
qa_regex_hits, qa_floor_fails, matched_offer`

No column here records UniPile/LinkedIn delivery status of a connection note
(`unipile_message_id` is null on every connection_note row — invites don't return a chat
message id regardless of note success, so it's not usable as a signal).

### outreach_prospects — relevant columns
`connection_sent_at, connection_note, connected_at, note_variant, stage,
send_priority, skip_reason, blacklisted`

`note_variant` is the one column that CAN carry a fallback signal (see code below), but it
is **overloaded**: for every non-RISE campaign it's used to tag which note *template*
was picked (`gift_v1`, `wins_gift`, `hiring_intercept`, `kyle_anchor`, `agency_v2`, …), and
for RISE it's tagged `rise_cold_v2_custom` / `rise_orbit_v1` / `rise_orbit_v2` /
`rise_orbit_custom` / `rise_warm_v1`. The Send Connection node overwrites this column with
literal `"F"` ONLY when the with-note UniPile call throws and the bare retry succeeds.

Live query, `outreach_prospects` where `stage=connection_sent` (143 rows, all campaigns):
```
Counter({'rise_cold_v2_custom': 40, 'IF': 23, 'wins_gift': 17, 'gift_v2': 15, 'gift_v1': 10,
'rise_orbit_v1': 8, 'gift_v3': 7, 'gift_v1_ctl': 5, 'rise_orbit_custom': 5, 'gift_v2_ctl': 4,
'wins_plays_v1': 4, 'gift_v3_ctl': 3, 'wins_plays_v2': 1, 'rise_orbit_v2': 1})
```
**Zero rows carry `note_variant = 'F'`.** The fallback path has never completed once,
in this table, across any campaign.

### Named 7 prospects (Betta Carrano, Jennifer Malouf, Amar Behura, David Jacobowitz,
Angel Kho, Teressa Foglia, Michelle Zuchowicki) — client `risedtc`, campaign
`9a9ee3a5-c3a6-452d-8442-52285248d70c` (RISE cold):
All 7 have `note_variant = 'rise_cold_v2_custom'`, `connection_note` populated with the
exact text the operator saw in the log, `connected_at = null` (none accepted yet). The
corresponding `outreach_messages` rows (message_type=connection_note) mirror the same
text with no metadata field indicating delivery confidence. No row shows `note_variant='F'`
or a null `connection_note` that would indicate a bare-invite fallback.

### outreach_engagement_log (the only place errors are logged)
- `success=false, action_type=connection_request` (last 30, all-time): every single one is
  `provider_id_resolve_failed: Request failed with status code 422` — a *different* failure
  mode (Apollo/Apify slug never resolved to a UniPile internal provider_id), unrelated to
  note delivery.
- Zero rows anywhere match `error_message ilike '%note_quota_fallback%'`.
- Zero rows anywhere match `error_message ilike '%invite_422_treated_sent%'` (the
  "already_invited" silent-422-treated-as-success marker also never fired).
- `success=true, action_type=connection_request`: capped at 1000 by REST default limit
  (real total is higher) — i.e. the with-note call has reported unconditional success at
  volume, with the note branch never once needing to catch anything.

### RISE seat / cap context (relevant to why the note-cap may never trip)
`integration_config`: `risedtc_unipile_account_id = WkWcYGueQvy_atKCNFz2ng` (Mattan's own
seat, per go-live memory), `risedtc_connect_monthly_cap = 400`,
`risedtc_connect_weekly_cap = 100`, `risedtc_connect_daily_cap = 20`. RISE cold+orbit
campaigns have sent **57 connection notes in the current month** (query:
`outreach_prospects` where `campaign_id in (RISE_COLD, RISE_ORBIT)` and
`connection_sent_at >= 2026-07-01`). That is well above LinkedIn's documented free-seat
note allowance (~5 notes/month, see §3) with zero fallback events recorded — which is only
consistent with either (a) Mattan's seat carrying a materially higher note quota than a
bare free seat, or (b) UniPile/LinkedIn not surfacing an error when a note is
rejected/dropped past quota, in which case the code's catch-based branch is a no-op safety
net for this exact failure mode and the DB has been asserting "note sent" all month without
verification.

## 2. n8n evidence — `Outreach - Connection Request Sender` (workflow `5ZXtArhobWrDDpfJ`,
active, n8n.ivanmanfredi.com; hourly Schedule Trigger)

Nodes: Every Hour → Check Flag + Skip → Should Run? → Initial Delay →
**Query + Build Notes** (Code) → Has Prospects? → Loop Prospects (SplitInBatches) →
**Send Connection** (Code) → Request Delay.

`Query + Build Notes` assigns `noteVariant` as a **template tag** per campaign branch
(RISE cold: `noteVariant = "rise_cold_v2_custom"`, RISE orbit: `rise_orbit_v1` /
`rise_orbit_v2` / `rise_orbit_custom`, plus `gift_v1..v3`, `wins_gift`, `hiring_intercept`,
`kyle_anchor`, `agency_v2`, `rise_warm_v1`, etc. across ~34K chars of branch logic) and sets
`senderClientId: "risedtc"` for RISE rows so the RISE-specific seat resolves downstream.

`Send Connection` — the actual invite call and the ONLY place that could distinguish
note-sent from note-dropped:

```js
// Send connection request via UniPile
try {
  const body = { account_id: uniAccount, provider_id: inviteId };
  if (d.connectionNote) body.message = d.connectionNote;

  await this.helpers.httpRequest({
    method: "POST",
    url: uniBase + "/users/invite",
    headers: { "X-API-KEY": uniKey, "Content-Type": "application/json" },
    body
  });
} catch (e) {
  const msg = e.message || "";
  firstError = msg;
  // already_invited / 422 -> treat as success
  if (msg.includes("already_invited") || msg.includes("422")) {
    silent422 = true; // treated as success; marker makes it measurable (Phase-1 gap (g))
  } else if (d.connectionNote) {
    // Note attached and call failed -> retry without note (covers note-quota / note-too-long / note-rejected)
    try {
      await this.helpers.httpRequest({
        method: "POST",
        url: uniBase + "/users/invite",
        headers: { "X-API-KEY": uniKey, "Content-Type": "application/json" },
        body: { account_id: uniAccount, provider_id: inviteId }
      });
      noteFallback = true;
      d.connectionNote = null;
    } catch (e2) { /* ... already_invited/422 -> noteFallback=true too, else hard fail ... */ }
  } else { /* hard fail, no note was attempted */ }
}

// Update prospect stage
await this.helpers.httpRequest({
  method: "PATCH", url: sbUrl + "/rest/v1/outreach_prospects?id=eq." + d.id,
  headers: { ...headers, Prefer: "return=minimal" },
  body: { stage: "connection_sent", connection_sent_at: new Date().toISOString(),
          connection_note: d.connectionNote,
          note_variant: noteFallback ? "F" : (d.noteVariant || "A"),
          updated_at: new Date().toISOString() }
});

// Log connection note as message (only if note actually went through)
if (d.connectionNote) {
  await this.helpers.httpRequest({
    method: "POST", url: sbUrl + "/rest/v1/outreach_messages",
    headers: { ...headers, Prefer: "return=minimal" },
    body: { prospect_id: d.id, direction: "outbound", message_text: d.connectionNote,
            message_type: "connection_note", sequence_step: 0,
            sent_at: new Date().toISOString() }
  });
}

return [{ json: { ...d, success: true, hadNote: !!d.connectionNote, noteFallback } }];
```

**So the branch DOES exist and DOES record correctly when it fires**: on a caught
note-related error, it retries bare, sets `d.connectionNote = null`, writes
`note_variant = "F"` to `outreach_prospects`, and — because the `outreach_messages` insert
is gated on `if (d.connectionNote)` — **skips writing the connection_note message row
entirely**. That combination (`outreach_prospects.note_variant = 'F'` AND no
corresponding `outreach_messages` row with `message_type='connection_note'` for that
`sent_at`) is a clean, already-wired predicate for "sent without note."

**The problem is empirical, not architectural**: this branch requires UniPile's
`POST /users/invite` call to *throw* (a caught exception) when the note is rejected. Across
143 current `connection_sent` rows and ≥1000 logged `connection_request` successes,
that has never happened — 0 rows with `note_variant='F'`, 0 `note_quota_fallback` log
entries. There is also a second gap: the `already_invited`/422 branch (`silent422`) does
**not** null the note or set `note_variant='F'` — it treats the with-note call as fully
successful (keeps `d.connectionNote`, writes the message row) even when the actual UniPile
response was "already invited," which conflates "already-invited (no new send happened at
all)" with "note delivered." This has also never been observed live (0 matching log rows),
but it's a second latent inaccuracy in the same code path.

No other node (Request Delay, Loop Prospects, etc.) touches note/delivery state.

## 3. UniPile / LinkedIn ground truth (light web check)
Per UniPile docs and LinkedIn's own invitation-restriction help page: **free LinkedIn
seats get roughly 5 invitations/month with a note (≤200 chars) and up to ~150/week without
one**; paid/active seats get materially higher note allowances (~80-100/day, ~200/week
with up to 300-char notes). UniPile does not enforce this on its side — "you'll have the
exact same limit [and errors] as in the LinkedIn UI," and the LinkedIn-side error can
surface late (at the last step of the invite call), which is exactly the shape the
`Send Connection` node's try/catch is designed to catch. The documented error family is
`422 / cannot_resend_yet`-style responses; whether a note-specific rejection always throws
a catchable error (vs. LinkedIn silently accepting the invite without the note) was not
confirmed in the docs surfaced by search — this is the open uncertainty that matters most
here, since it decides whether the fallback path's 0 firings mean "never needed" or
"never worked."

## Recommendation (not executed — read-only run)
If Ivan wants per-row certainty, the exact write-back point already exists:
**`Send Connection` node, the `noteFallback = true; d.connectionNote = null;` branch** —
this is where a first-class column (e.g. `outreach_prospects.note_delivery_status` or
reusing `note_variant='F'` but with the overload removed from the template-tag use case)
should be written and where the Sends-log UI should key its "sent without note" caption.
Until that branch actually fires at least once, or someone confirms with UniPile support
whether over-quota note rejections always throw, **historical and current rows are
indistinguishable** — every note shown in the log is "attempted," not "confirmed
delivered."

## Evidence pointers
- Supabase (bjbvqvzbzczjbatgmccb): `outreach_messages`, `outreach_prospects`,
  `outreach_engagement_log`, `integration_config` (keys `risedtc_unipile_account_id`,
  `risedtc_connect_*_cap`) — queried live via REST, 2026-07-24.
- n8n workflow `5ZXtArhobWrDDpfJ` ("Outreach - Connection Request Sender"),
  node `Send Connection` (Code) and `Query + Build Notes` (Code) — fetched live via
  `GET /api/v1/workflows/5ZXtArhobWrDDpfJ` on n8n.ivanmanfredi.com, 2026-07-24.
- Note: the n8n MCP connector available in this session (`mcp__n8n-mcp__*`) is scoped to
  an unrelated personal project (`Fractional Magic`, 4 test workflows) and cannot see
  `n8n.ivanmanfredi.com` workflows at all (see `~/.claude/memory/shared/n8n-mcp-wrong-instance.md`)
  — read access for this audit was obtained instead via the `n8n-execs` skill /
  direct REST GET with the read-only API key in project memory `integrations.md`. No
  writes were made to n8n or to Supabase.
