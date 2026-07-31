# Phase 1 — PHANTOM-PUBLISH SKEPTIC

Read-only adversarial verification of safety claims about write actions in the AgentOps/content/styles/LM port
(personal-site → ivan-inbox). Default posture: REFUTED on ambiguous/thin evidence. All citations verified
directly against the code in this session (not trusted from the phase1a-d audits, though they were used as a
map). Repos touched: `/Users/ivanmanfredi/Desktop/personal-site`, `/Users/ivanmanfredi/Desktop/ivan-inbox`,
`/Users/ivanmanfredi/Desktop/ivan-listener`. No DB access this session (supabase-ivan MCP unauthenticated) —
anything requiring a live query is marked UNVERIFIABLE-FROM-REPOS, never asserted as fact.

---

## Claim 1 — "Ivan-lane post approve (status→'approved') does NOT publish"

**VERDICT: CONFIRMED-SAFE (repo scope), with one caveat.**

- `setStatus()` — `personal-site/lib/studioActions.ts:250-255` — plain `supabase.from('carousel_drafts').update({status}).eq('id', id)`. No webhook fired, no other side write in the same function body.
- The only two things that write `carousel_drafts.scheduled_at` are `scheduleCarousel()` (`lib/studioActions.ts:259-267`, sets `status:'scheduled'` + `scheduled_at` together) and the Calendar drag path (`Calendar.tsx:65-109`, same pair, plus a direct `scheduled_posts` insert for instant effect). Comment at `studioActions.ts:258-259` names the consumer explicitly: "Bridge workflow yzXqLDIpuNzuhUQq picks up status='scheduled' rows and INSERTs the publisher queue row."
- `publishPostNow()` (`studioActions.ts:269-289`) is the one immediate-publish path, and it is an explicit named button firing an n8n webhook (`publish-now`, shared secret) — not something `setStatus('approved')` reaches.
- Hunted for a trigger/watcher on `status='approved'` for `carousel_drafts`: grepped every `.sql` in `personal-site/migrations/*.sql` and `personal-site/supabase/migrations/*.sql` for `carousel_drafts` + `approved` together — **zero hits**. No `CREATE TRIGGER` in any migration file references `carousel_drafts` at all.
- Caveat (why not a clean CONFIRMED): the live Supabase schema was not queryable this session. A trigger created directly in the Supabase SQL editor (not tracked in either repo's migrations — this exact pattern is called out as a known trap for `dashboard_action`, `n8nclaw_dashboard_send`, `append_agent_log`, `get_recent_outreach_clicks`, none of which have bodies in-repo) cannot be ruled out from static code alone. The claim is well-supported by every file that IS readable, but "does NOT publish" is a claim about server-side behavior that only a live probe (Phase 1e / access matrix) can fully close.

## Claim 2 — "LM approve is a plain status write"

**VERDICT: REFUTED as stated — the claim overclaims what the repo can prove; UNVERIFIABLE-FROM-REPOS on the actual external-publish risk.**

- Code-level fact, confirmed: `LmWorkSurface.tsx:175` — `supabase.from('lm_drafts_v2').update({status:'approved'}).eq('id', id)`. Plain write, no webhook in that function. This part matches the claim.
- BUT: the memory trap this claim is trying to pre-empt ("approved=publishes" exists in "SOME lane (LM watchers)") is about an **n8n-side poller reading `lm_drafts_v2.status`**, not about this button. Searched exhaustively for the string `below_digest_threshold` across both repos (`personal-site`, `ivan-inbox`) — **zero hits**. It does not appear anywhere in code, migrations, or comments in either repo. That means the mechanism the trap warns about is entirely outside what's readable here (an n8n workflow body), so there is **no way to confirm from these repos whether a poller elsewhere treats `lm_drafts_v2.status='approved'` as a publish signal** for some subset of rows (e.g. a specific `format`, or client-board LMs specifically).
- Do not let "the button's own code is a plain write" get rounded up to "approving an LM draft is safe." Those are different claims. The button is safe; whether the *value it writes* is safe to have written is unverified.
- Separately, `LmWorkSurface.tsx:174-180` calls this the "SECONDARY" approve path — the "PRIMARY" approve (`studioActions.ts:362-377`) flips `status='generating'` and fires `lm-gen-v2` immediately. If the port ever collapses these two buttons into one, or if a retry/optimistic-update double-fires, that's a live risk, but nothing in this pass found that bug — flagging as a port-time hazard, not a confirmed defect.

## Claim 3 — "n8nClaw chat send fallback POSTs to webhook/n8nclaw-whatsapp spoofing an inbound WhatsApp message"

**VERDICT: CONFIRMED, and worse than the one-line claim states.**

- Exact fallback, `personal-site/hooks/useAgentData.ts:135-155`:
  ```
  const { error: rpcError } = await supabase.rpc('n8nclaw_dashboard_send', { p_message: trimmed });
  if (rpcError) {
    const resp = await window.fetch(N8NCLAW_WEBHOOK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      event: 'messages.upsert',
      data: { key: { fromMe: false, remoteJid: '5491159385939@s.whatsapp.net', id: `dash-${Date.now()}` }, message: { conversation: trimmed }, pushName: 'Ivan (Dashboard)' },
    })});
    if (!resp.ok) throw new Error(...);
  }
  ```
  `N8NCLAW_WEBHOOK_URL = 'https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp'` (`useAgentData.ts:7`).
- **Fires on ANY rpc error**, not just "RPC not deployed" — a transient network blip, an auth hiccup, a malformed message, or a temporary Supabase outage all take the same fallback branch. There is no error-type discrimination.
- Payload has `fromMe: false` and the real `remoteJid` for Ivan's own WhatsApp number — indistinguishable server-side from an actual inbound WhatsApp message. No auth header, no secret, no signature on this POST.
- **A second, un-audited instance of the exact same webhook exists**: `personal-site/lib/sendToEngineer.ts` (used by `components/dashboard/WorkflowsPanel.tsx` and `components/dashboard-v2/sections/rebuilt/health/WorkflowsTab.tsx`, confirmed via grep) posts to the same `https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp` with the same spoofed-inbound shape (`remoteJid: IVAN_JID`, `fromMe: false`, `pushName:'Dashboard'`). This was NOT in scope of phase1a's file list and is not part of what's being ported today — but it proves the vulnerability pattern isn't confined to the chat-send fallback; it's a repo-wide convention for "make the agent do something" that any future port of Workflows-health surfaces would carry over verbatim.
- No retry loop resends this specific fallback (blocked by `sendingRef.current` re-entrancy guard, `useAgentData.ts:127-128`), so a stray double-post from *that* function specifically is not demonstrated — the risk is single-fire-but-unauthenticated-and-error-triggered, not a runaway loop.
- **Ported-surface status confirmed**: grepped `ivan-inbox/src/` for `n8nclaw|whatsapp|N8NCLAW|remoteJid` — zero hits. The port has not yet touched this surface. If/when it does, this exact fallback (verbatim, if copied) would ship the same unauthenticated spoof capability into a second app.

## Claim 4 — "ops_drafts approve for escalation/update kinds only posts to Slack via n8n dispatcher; newsjack approve writes+schedules a post"

**VERDICT: CONFIRMED for what the repo can show; the dispatcher's actual filter behavior is UNVERIFIABLE-FROM-REPOS (it's an n8n workflow, not in any repo read).**

- `ivan-inbox/db/015_ops_drafts.sql:6-9` (comment): "Approve in inbox stamps `approved_at`; the n8n dispatcher (q2min) is the ONLY writer of `sent_at` and only processes `approved_at NOT NULL AND sent_at NULL AND send_blocked_reason NULL`, gated by `integration_config.ops_drafts_enabled`."
- `ivan-inbox/db/020_newsjack_cards.sql:1-7` (comment): newsjack is explicitly NOT Slack-bound; "The Slack dispatcher (`4B3D9O9gvAaAWBe2`) is filtered to escalation/update so it can never pick these up; the slot-claim workflow owns them." Same assertion repeated verbatim in `021_weekly_report_cards.sql:8-9` and `022_comment_reply_cards.sql:9-10` for weekly_report/comment_reply.
- Client-side wiring confirmed correct (`ivan-inbox/src/screens/OpsScreen.tsx:141-176`, `onApprove()`): `comment_reply` → `postCommentReply()` (edge function, external post); `weekly_report` → `approveWeeklyReport()` (double-stamps `approved_at`+`sent_at` immediately, `ops.ts:178-184`, no dispatcher exists for this kind by design); everything else (`escalation`/`update`/`newsjack`) → `approveOpsDraft()` (`ops.ts:122-127`, stamps `body`+`approved_at` ONLY — never `sent_at`). This is correct: newsjack does NOT get double-stamped client-side, so its `sent_at` really is left for the separate slot-claim workflow, matching the migration comment.
- **What's actually unverifiable**: the Slack dispatcher's `kind IN ('escalation','update')` filter, and the slot-claim workflow's `kind='newsjack'` scoping, live entirely in n8n workflow `4B3D9O9gvAaAWBe2` (and whatever polls newsjack) — neither workflow body is present in `ivan-inbox`, `personal-site`, or `ivan-listener`. The SQL comments assert the filter three times across three migration files (015/020/021/022), which is a good consistency signal, but a comment is not code — if that filter were ever silently widened in n8n (the exact failure mode the user's own memory calls out — "🔴 Slack dispatcher 4B3D9O9gvAaAWBe2 filters kind=in.(escalation,update) — NEVER widen"), no repo here would show it. Treat the SQL comments as documented *intent*, not verified *behavior*.
- One arithmetic check worth flagging: `approveOpsDraft` (`ops.ts:122-127`) does `.eq('id', id).is('sent_at', null)` — a real guard against double-approving an already-sent row, good. But it does NOT check `send_blocked_reason IS NULL` before allowing an approve-write — a discarded/blocked row could in theory be re-approved by re-editing and hitting Approve again (the UI groups it out of the pending list, but nothing in `approveOpsDraft` itself refuses the write server-side; RLS policy on `ops_drafts` — `db/015_ops_drafts.sql:27-29` — is `for all to authenticated using (true) with check (true)`, i.e. no column/value-level check at all, purely app-gated). This is a thin edge (Ivan is the only authenticated user, and the UI hides blocked rows from Pending), not a phantom-publish vector on its own, but it means the DB layer provides zero independent backstop if the UI ever mis-renders a blocked row into the pending list.

## Claim 5 — "dashboard_action RPC is allowlisted"

**VERDICT: REFUTED as a blanket safety claim — it IS allowlisted by field name, but the allowlist itself includes fields that can arm/cascade to external sends, and there is zero value-level validation.**

- Only definition found: `personal-site/migrations/client_autofix.sql:17-63` (`CREATE OR REPLACE FUNCTION dashboard_action`, dated March 30 per file mtime — this is the ONLY `CREATE OR REPLACE FUNCTION dashboard_action` in either repo; no later migration redefines it). `supabase/migrations/20260719_rls_closure_waves.sql:450` references it only to revoke `anon`/`public` execute and grant `authenticated` execute — confirms it is NOT anon-callable today, consistent with Ivan's dashboard sitting behind Supabase Auth OTP (phase1b's finding), but this is the only independent confirmation available; the RPC body itself has not been touched by any migration since March.
- The allowlist (`client_autofix.sql:23-40`) gates by `(table, field)` pair only — it validates **which column** can be written, never **what value**. `EXECUTE format('UPDATE %I SET %I = $1...', p_table, p_field) USING p_value, p_id::uuid` — `p_value` is whatever string the caller sends, cast blind.
- Fields in the allowlist that are NOT cosmetic dashboard toggles and DO touch outbound-send-adjacent state:
  - `outreach_prospects.stage` — memory itself documents `stage='ballot_hold'` as a send-pause lever; this RPC lets any authenticated caller write literally any string into `stage` for any prospect row, with no enum/CHECK enforcement visible in this RPC.
  - `outreach_prospects.next_touch_after` — controls when the next automated touch fires; writable to any value (including a past timestamp, which would make a prospect immediately eligible for the next automated send).
  - `outreach_prospects.blacklisted` / `needs_manual_reply` — both booleans that gate automated sends per the memory ledger.
  - `outreach_campaigns.is_active` — flipping a paused campaign's `is_active` to `true` through this same generic RPC would resume automated sending for every prospect in that campaign; the RPC has no special-casing or extra confirmation for this field versus, say, `client_workflow_errors.is_resolved`.
- None of these fields are exercised by the AgentOps/content/styles/LM surfaces actually being ported (those only use `n8nclaw_proactive_alerts.sent` and `n8nclaw_reminders.status` through this RPC, per phase1a rows 3/5) — so the CURRENT port does not itself trigger this risk. But "the RPC is allowlisted" is being used in the mission as shorthand for "safe to call generically," and that is false: the allowlist is real but promiscuous, sharing one function and one blast radius across cosmetic UI state and outbound-campaign arming switches. Any future reuse of `dashboard_action` in the ported app (e.g. wiring a new button to a `p_table`/`p_field` pair already on this list, believing "it's in the allowlist so it's safe") inherits that full blast radius, not just the two fields currently used.
- `p_id::integer` special-case for `n8nclaw_reminders` (`client_autofix.sql:47-49,55-57`) means the RPC also silently assumes a caller passes an integer-parseable string for that one table — a `p_id` mismatch on any other allowlisted table falls to `::uuid` (line 52/59-60) and throws instead of silently misrouting, which is the correct failure mode, just noting the coupling is fragile if a new integer-PK table is ever added to the allowlist without updating this branch.

## Claim 6 — Any OTHER write path in the audited surfaces reaching LinkedIn/WhatsApp/Slack/email not flagged

**VERDICT: CONFIRMED — found one.**

- `personal-site/lib/sendToEngineer.ts` (see Claim 3) — a second unauthenticated POST to the exact same `n8nclaw-whatsapp` webhook, spoofing an inbound WhatsApp message from Ivan's real number, used by `WorkflowsPanel.tsx` / `WorkflowsTab.tsx`. Not in phase1a's scoped file list (which only covers AgentPanel/AgentReadyPanel/AgentLogFeed/AgentRebuilt/useAgentData), not currently part of the ivan-inbox port, but it is the same repo, the same webhook, the same trust model, and it demonstrates the "spoof an inbound WhatsApp message from the dashboard" pattern is a convention here, not a one-off — a future "add the health/Workflows tab to the mobile app" ask would carry this forward silently unless someone remembers to re-flag it.
- Everything else the audits already called "external": `publish-now`, `lm-gen-v2` (assets/content/repost phases — these are generation triggers, not raw publish, per phase1b's own review — confirmed by reading `studioActions.ts:362-421`, no LinkedIn/Slack/email call sits directly in those functions, they only POST to n8n which does the actual generation), `video-gen-v2`, `lm-regen-cover-v2`, `carousel-style-create` (visual-kit generation, no publish), `send-newsletter-test` (explicitly a *test* send webhook, `lib/dashboardActions.ts:82/97` — confirmed named `send-newsletter-test`, distinguishable from the real `newsletter_issue_send_now` RPC), and the Bridge/Publisher n8n workflow IDs (named only, not called directly from either repo) — none of these are additional undiscovered paths; they match what phase1a/1b already flagged.
- `ivan-inbox` side: full external-write inventory is exactly `rise-comment-reply` (LinkedIn comment post, gated hard per Claim 4/phase1d) and `push_subscriptions` upsert/delete (`lib/push.ts` — this is push-notification subscription management, not an outbound send to a third party; not a phantom-publish vector). No other `fetch()`/`.rpc()` call in `ivan-inbox/src/lib/*.ts` reaches an external send surface — confirmed via `grep -rn "fetch(\|webhook\|\.rpc(" src/lib/*.ts`, only three matches: `kpis.ts` (2 read-only RPCs), `ops.ts:154` (the comment-reply edge fn, already covered), `today.ts:278` (morning-brief read, not a write).

---

## Verdict list (one line each)

1. Post approve (`carousel_drafts.status='approved'`) does not publish — **CONFIRMED-SAFE** (repo scope only; no in-repo trigger found, but live-schema triggers can't be ruled out without a DB probe — `personal-site/lib/studioActions.ts:250-255`).
2. LM approve is a plain status write — **REFUTED as a safety claim**: the button's own write is plain (`LmWorkSurface.tsx:175`), but whether any n8n watcher treats `lm_drafts_v2.status='approved'` as a publish trigger is **UNVERIFIABLE-FROM-REPOS** (`below_digest_threshold` — zero hits anywhere in either repo).
3. n8nClaw chat fallback spoofs inbound WhatsApp to an unauthenticated webhook — **CONFIRMED**, fires on ANY rpc error not just "not deployed," and a second identical unauthenticated instance exists at `personal-site/lib/sendToEngineer.ts` outside the audited scope (`useAgentData.ts:135-155`).
4. ops_drafts kind-routing (Slack dispatcher vs newsjack slot-claim vs weekly/comment self-service) — **CONFIRMED** client-side wiring is correct (`OpsScreen.tsx:141-176`, `ops.ts:122-184`); the n8n dispatcher's actual filter enforcement is **UNVERIFIABLE-FROM-REPOS** (workflow body not present; only asserted 3x in SQL comments).
5. `dashboard_action` RPC is safely allowlisted — **REFUTED**: field-name allowlisted, but zero value validation, and the same allowlist includes `outreach_campaigns.is_active` / `outreach_prospects.stage,next_touch_after,blacklisted` — fields that can arm/cascade to automated outbound sends (`migrations/client_autofix.sql:17-63`).
6. No other unflagged write path reaches LinkedIn/WhatsApp/Slack/email — **REFUTED**: `personal-site/lib/sendToEngineer.ts` is a second, un-audited, unauthenticated spoofed-WhatsApp-send path on the same webhook, outside phase1a's scoped file list.
