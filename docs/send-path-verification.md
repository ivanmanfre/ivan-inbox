# Send-path verification (2026-07-22)

Decisions locked from the live n8n probe (full receipts below):

1. One dispatcher only: `Outreach - Send Messages` (kFYlfnWd98YaiErH, every 2 min) is the sole queue reader. Pickup predicate: `approved_at NOT NULL AND sent_at NULL` with no message_type/channel filter. Approving a draft or inserting a `manual_reply` row with `approved_at` stamped gets sent within ~2 min. NO n8n change was needed or made.
2. App-side guard A (ThreadScreen): compose is disabled for threads whose prospect stage is `engaged` — the dispatcher would send the text as a connection invite, not a chat message.
3. App-side guard B (ThreadScreen): email compose is disabled in v1 with truthful copy. Reason: composed rows lack the `recipient_email` + `Subject:` plumbing the Gmail lane expects. Approving existing EMAIL drafts stays enabled (pipeline-authored drafts carry recipient_email). Smartlead reply-to-lead sender remains a v1.1 item.
4. Status honesty: the dispatcher's preSendGate can block copy (bans `!`, certain phrases, >1500 chars) — it nulls `approved_at` and writes `send_blocked_reason`, which the app renders as a red failed chip. Nothing silently disappears.
5. Seat routing: seat = prospect.campaign_id -> client seat map inside the dispatcher. The view only shows prospects with a campaign (inner join), so composed replies inherit the correct seat. Seat routing was NOT touched.
6. `manual_reply` sends consume the dispatcher's daily DM cap (shared limit=5 per 2-min cycle across lanes).

---

# Phase 7 — Sender Pickup Probe (READ-ONLY)

Date: 2026-07-22 · Method: fetched all 7 workflow JSONs via n8n public REST API, analyzed every
Postgres/Supabase/UniPile node. No workflow modified, activated, executed, or DB-written.
(No outbound-action-guard block was triggered; no `#allow-danger` needed.)

## TL;DR
- **Only ONE workflow is a message-queue dispatcher: `Outreach - Send Messages` (Poll + Send).**
  Its pickup predicate is `approved_at IS NOT NULL AND sent_at IS NULL` — **NO** filter on
  `message_type`, `channel`, `campaign is_active`, `client_id`, `scorer_version`, or `stage`.
- The other 4 senders (DM Sequence, RISE InMail, Connection Request, InMail Audit) are all
  **prospect-driven** — they SELECT from `outreach_prospects`, generate their own copy, and only
  write to `outreach_messages` as SEND LOGS (`sent_at` already set). None reads `approved_at`.
- Smartlead Sync is **inbound-only** (mirrors email replies in). Pending Approvals is **read-only**.
- **A `manual_reply` row IS picked up** by Poll + Send with zero filter change. Pickup is not the
  risk — **send-path routing is**: two mis-send vectors (stage=`engaged` → invite; null campaign_id
  → Ivan's seat) plus a copy gate that silently blocks natural human text.
- **Email IS sent** from `outreach_messages`: Poll + Send routes `channel='email'` approved rows to
  Gmail (`im@ivanmanfredi`). The "Smartlead is inbound-only" assumption is TRUE for Smartlead but
  does NOT mean nothing sends email — Poll + Send does.

---

## 1. `Outreach - Send Messages` (kFYlfnWd98YaiErH) — THE DISPATCHER · active · every 2 min (LinkedIn+email), every 6h (email follow-up gen, disabled)

### a. Exact pickup predicate (node "Poll + Send", verbatim)
```js
var messages = await this.helpers.httpRequest({ method: "GET",
  url: sbUrl + "/rest/v1/outreach_messages?approved_at=not.is.null&sent_at=is.null&select=id,prospect_id,message_text,message_type,channel,recipient_email,ai_model&limit=5",
  headers: { apikey: sbKey, Authorization: "Bearer " + sbKey } });
```
- **Filters: `approved_at=not.is.null` AND `sent_at=is.null` ONLY.** `limit=5` per run (~150 rows/hr
  ceiling shared across ALL channels/lanes). No message_type / channel / campaign / client / stage gate.
- Atomic claim before dispatch (concurrency-safe): `PATCH ...?id=eq.<id>&sent_at=is.null` body `{sent_at: now}`; empty result ⇒ another run already claimed ⇒ skip. No double-send from concurrency.

### Pre-send copy gate — applies to EVERY row incl. manual_reply
`preSendGate(message_text)` hard-blocks: any em-dash/en-dash `[–—]`, any `!`, banned openers
("Thanks for connecting", "Saw your profile", "I help X"…), banned closers/hedges ("Worth a chat",
"I'd love to", "Just curious/Curious if/Wondering if", "Resonate"…), buzzwords (leverage, harness,
seamless, unlock, streamline…), and `length > 1500`. On block:
```js
body: { sent_at: null, approved_at: null, send_blocked_reason: gate.hits.join(","), send_blocked_at: now }
```
⚠️ **Nulls `approved_at`** → row silently leaves the queue. A human reply with "Thanks!" or an
em-dash gets blocked and never sent, with only a `send_blocked_reason` to show for it.
(`dm`-type rows also trigger a prospect self-heal rollback to `stage=connected,dm_count=0`;
`manual_reply` is NOT `dm` so it escapes that rollback — good.)

### Routing after gate
```js
var channel = msg.channel || "linkedin";          // null channel defaults to linkedin
if (channel === "email") { ...Gmail path... }
else {
  var actionType = (msg.message_type === "connection_note") ? "connection_request" : "dm";  // manual_reply → "dm" cap bucket
  // cap: RPC linkedin_check_and_increment(actionType); cap hit ⇒ unclaim (sent_at=null), leave queued for tomorrow
  ...
  if (msg.message_type === "connection_note" || prospect.stage === "engaged") { ...send as INVITE (message_text = connection note)... }
  else { ...look up existing chat by profileId, append message (or create chat); PATCH prospect stage=dm_sent... }
}
```

### Seat selection (verbatim)
```js
var seat = uniAccount;                              // "rm-WNhwaS1m7VcZoYLRrJA" (Ivan)
var _clientId = (prospect && campClient[prospect.campaign_id]) || null;   // campaign_id → client_id
if (_clientId) { seat = integration_config[`${_clientId}_unipile_account_id`]; if (!seat) { unclaim; continue; } }  // fail-closed
```
- Seat is chosen from **`prospect.campaign_id → client_id`**, NOT from anything on the message row.
- ⚠️ **WRONG-SEAT VECTOR:** if `prospect.campaign_id` is null or not in the active-campaign map,
  `_clientId` = null ⇒ **seat = Ivan's `rm-WNhwaS1m7VcZoYLRrJA`**. A client-inbound thread whose
  prospect row lacks a client campaign_id would have its reply SENT FROM IVAN'S LINKEDIN.

### c. Draft-approve of existing AI draft — YES, correct
Existing `dm`/`connection_note` drafts already carry `channel=linkedin`, `prospect_id`, `sequence_step`.
Stamping `approved_at` (and editing `message_text`) ⇒ picked up ≤2 min. Edited text MUST pass the gate.
Cadence: 2 min. Seat: as above.

### d. Email — YES this workflow sends it
`channel='email'` + `approved_at` ⇒ Gmail node (cred `gmailOAuth2 qkw4OHjtMonK7u5G` = `im@ivanmanfredi`).
Subject parsed from a leading `Subject:` line (else defaults `"Quick question"`); body sent to
`recipient_email`. "Generate Email Follow-ups" node is **disabled by policy** (early return), but the
SEND path is fully live.

---

## 2. `Outreach - DM Sequence` (joU7VaM5OiRAwLwP) — active · every 30 min — PROSPECT-DRIVEN (drafter, not queue reader)
- SELECTs `outreach_prospects` (stage `connected`/accept-detected, active campaigns only), drafts DM1/DM2/bump.
- INSERT convention (this is the row shape the inbox should mirror):
```js
body: { prospect_id: d.id, direction: "outbound", message_text: _msg, message_type: "dm",
        channel: "linkedin", sequence_step: _seq, sent_at: null,
        approved_at: (_seq === 1 ? now : null), ai_model: _model, unipile_chat_id: d.unipileChatId || null }
```
- **Auto-approve (only its OWN DM1):** `approved_at=now` for `sequence_step===1` scan-DM drafts. DM2 and
  bumps stay `approved_at=null`. **Not a phantom-approve risk to app rows** — it only stamps rows it just created.

## 3. `Outreach - RISE InMail Sender` (lJO8NIcByrMpdLnd) — active · hourly — PROSPECT-DRIVEN
- Pulls `outreach_prospects` on RISE orbit campaign; sends InMail from `risedtc_unipile_account_id`
  (Mattan's seat). Caps self-scoped by `ai_model like 'template/rise_inmail*'`. Writes a send-LOG row:
  `message_type:"inmail", channel:"linkedin_inmail", sent_at: now, approved_at: now`. **Never re-picked**
  by Poll + Send (sent_at set). Does not read `approved_at`. Won't touch `manual_reply`.

## 4. `Outreach - Connection Request Sender` (5ZXtArhobWrDDpfJ) — active · hourly — PROSPECT-DRIVEN
- Reads `outreach_messages` ONLY to COUNT already-sent notes for rate-limiting
  (`?direction=eq.outbound&message_type=eq.connection_note&sent_at=gte...`). Sends invites from prospect
  query; logs `message_type:"connection_note", sent_at: now`. Does not read `approved_at`.

## 5. `Outreach - InMail Audit Sender` (73SU0w4HbG9AVPdG) — active · 7×/day business hrs — PROSPECT-DRIVEN
- Pulls `outreach_prospects` (`stage in (enriched,archived)`, `icp_score>=7`, `scorer_version in (7..cur)`,
  active campaign, client_id NULL only). Seat = Ivan `rm-WNhwaS1m7VcZoYLRrJA`. Logs `sent_at:now, approved_at:now`
  `channel:"linkedin_inmail"`. Does not read `approved_at`. Won't touch `manual_reply`.

## 6. `Outreach - Smartlead Sync + Guardrails` (7HHsX094EuDxib0Y) — active · every 30 min — INBOUND ONLY
- Polls Smartlead for email replies, mirrors them into `outreach_messages` as `channel='email',
  direction='inbound'`. Triggers the Warm Reply Drafter (writes `approved_at=null` drafts to Review).
  **Sends nothing.** Does not write `approved_at`.

## 7. `Outreach - Pending Approvals Reminder` (nmdNybdOc32wxA5s) — active · 10am+6pm BA — READ-ONLY
```js
url: ".../outreach_messages?sent_at=is.null&send_blocked_at=is.null&approved_at=is.null&email_sequence_stopped_at=is.null&message_type=in.(dm,email,connection_note)&select=id,ai_model,outreach_prospects(name)..."
```
- Only sends a WhatsApp digest. **Does NOT write `approved_at`** (no phantom-approve).
- Note: `message_type in (dm,email,connection_note)` — **`manual_reply` is excluded**, so unapproved
  manual_reply drafts (approved_at=null) will NOT appear in this reminder. Non-blocking, but note it.

---

## Verdict table

| Sender | Reads msg queue? | draft-approve pickup | manual_reply pickup | Seat |
|---|---|---|---|---|
| Send Messages (Poll+Send) | YES (`approved_at not null & sent_at null`) | **YES** | **YES — with RISK** (see below) | prospect.campaign_id→client seat; null⇒Ivan `rm-WNhwaS1m7VcZoYLRrJA` |
| DM Sequence | no (drafter) | n/a | no | writes drafts only |
| RISE InMail | no (prospect-driven) | no | no | Mattan `risedtc_unipile_account_id` |
| Connection Request | no (count only) | no | no | Ivan / per-client |
| InMail Audit | no (prospect-driven) | no | no | Ivan `rm-WNhwaS1m7VcZoYLRrJA` |
| Smartlead Sync | inbound write only | no | no | n/a (inbound) |
| Pending Approvals | read-only | no | no | n/a |

### manual_reply RISK detail (all in Poll + Send)
1. ⚠️ **MIS-SEND (wrong send type):** if `prospect.stage === 'engaged'`, a `manual_reply` is dispatched
   as a **CONNECTION INVITE** (reply text becomes the connection note), not a chat message.
2. ⚠️ **WRONG-SEAT:** `prospect.campaign_id` null / not-in-active-map ⇒ reply sent from **IVAN'S seat**,
   even for a client thread.
3. ⚠️ **SILENT BLOCK:** natural human copy (`!`, em-dash, "I'd love to", "curious if", buzzwords, >1500
   chars) ⇒ `preSendGate` nulls `approved_at`, row leaves queue with only `send_blocked_reason`.
4. **Cap contention:** manual_reply consumes the daily **"dm"** cap slot; if cold-DM cap is exhausted a
   time-sensitive human reply is deferred to next day.
5. **Throughput:** `limit=5` per 2-min run shared across cold DMs + notes + emails + manual replies.
6. Side-effect: on success PATCHes `prospect.stage=dm_sent, last_dm_sent_at=now` — overwrites thread stage.

### Email-send answer (d)
**Yes, `channel='email'` rows ARE sent** — by Poll + Send via Gmail (`im@ivanmanfredi`), NOT by Smartlead
(which is inbound-only). An email `manual_reply` with `approved_at` set will be Gmail-sent to
`recipient_email`; requires `recipient_email` non-null and ideally a leading `Subject:` line.

### Phantom-approve audit (e)
**No phantom-approve risk to app-inserted rows.** Only DM Sequence stamps `approved_at` and only on the
DM1 rows it itself creates. RISE/InMail Audit stamp `approved_at=now` but WITH `sent_at=now` (send logs,
never re-picked). Pending Approvals and Smartlead never write `approved_at`.

---

## Recommendation

### (1) Pickup-filter widening for manual_reply — NOT NEEDED
The queue filter is already permissive (`approved_at not null & sent_at null` only); `manual_reply`
rows are picked up with **no change**. The exposure is the opposite — the send-path can MIS-SEND.
**Recommended (optional, WRITE — NOT APPLIED by this probe) surgical guard**, in node **"Poll + Send"**
of `Outreach - Send Messages`:

- Current condition (invite branch):
  ```js
  if (msg.message_type === "connection_note" || prospect.stage === "engaged") {
  ```
- Proposed condition (prevents an engaged-stage manual_reply from firing as a connection invite):
  ```js
  if (msg.message_type === "connection_note" || (prospect.stage === "engaged" && msg.message_type !== "manual_reply")) {
  ```
This is a single-line guard against mis-send vector #1. The seat vector (#2) is better solved on the
APP side by ensuring composed rows target a prospect whose `campaign_id` correctly maps to the client
(or by the app resolving+validating the seat before insert), not by editing the sender.

### (2) Fields composeReply MUST set on a manual_reply row
Required for correct pickup + send:
- `prospect_id` — **required** (sender fetches prospect by it; null ⇒ unclaim/skip). FK.
- `message_text` — **required**, non-empty, **MUST pass preSendGate** (no `!`, no `–—`, ≤1500 chars,
  none of the banned opener/closer/hedge/buzzword phrases). Surface this constraint in the composer UI.
- `approved_at` — set to a timestamp (this is what triggers pickup).
- `sent_at` — **null**.
- `direction` — `"outbound"`.
- `channel` — `"linkedin"` (or `"email"`; null defaults to linkedin in-sender).
- `message_type` — `"manual_reply"` (sender treats it as the `"dm"` cap bucket / append path).

For EMAIL manual replies additionally:
- `recipient_email` — **required** (Gmail sendTo).
- `message_text` should begin with a `Subject: …` line (else subject defaults to "Quick question").

Recommended (not strictly required):
- `unipile_chat_id` — if known; used only in the failure-verify fallback (send path still re-resolves
  the chat by profileId), so it aids traceability/recovery but isn't needed for the happy path.
- Ensure the target `prospect.campaign_id` resolves to the intended seat, and `prospect.stage != 'engaged'`
  before inserting a linkedin manual_reply (guards seat + mis-send at the source).
- Do NOT set `ai_model` to `template/gift_dm_v1|v2` (those are the gate-whitelist keys; anything else fine).

Inferred column defaults from code: `channel` null → treated as linkedin; `message_type` null → treated
as "dm" append path; `prospect_id` is the only clearly hard-required FK for the LinkedIn path.
