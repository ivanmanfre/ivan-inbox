# Move the learned-facts loop into the DMs surface (not Ops)

**Ivan, 2026-08-20:** *"I don't want to use the ops section for this. I want to use directly the
DMs, not the ops, because that's for other stuff, operations, which is not this."*

Ops is for operations. The learned-facts loop is about DM replies, so it belongs on the DMs surface.

## Where it currently lives (wrong home, keep until the new one ships)
`personal-site` → Client Ops → RISE DTC → Inbox tab:
- `components/dashboard-v2/sections/clientops2/OutreachInbox.tsx` → `LearnedFactsStrip`
- same file, `InlineDraft` → the `<details className="co4-ev">` Evidence panel
- `components/dashboard-v2/sections/clientops2/shared.tsx` → `LearnedFact`, `DraftEvidence`,
  `useClientLearnedFacts`, `resolveLearnedFact`

**Do not delete these until the DMs version is live** — three real facts are pending and Client Ops
is currently the only place to approve them.

## Target
`ivan-inbox` (the PWA), v2c Shell routes `job === 'dms'` → `DmsSurface`, `job === 'ops'` → `OpsBoard`.
- `src/exp/v2c/DmsSurface.tsx` (88 lines) — the pending learned-facts strip goes at the top
- `src/exp/v2c/DraftPane.tsx` (1479 lines) — the Evidence collapsible goes on the draft, near where
  `context_gap` is already rendered. **Read the whole file before editing; it is a live daily surface.**
- `src/lib/learnedFacts.ts` (new) + `src/lib/learnedFacts.test.ts` — every lib file in this repo has
  a colocated `.test.ts`; follow `src/lib/ops.ts` for the read/resolve shape.
- `src/exp/v2c/styles.css` — port the `.co4-ev-*` / `.co4-lf-*` rules, renamed to this repo's convention.

## Backend is already live, do not rebuild
- `learned_facts` table + `source_reasoning` column.
- `active_learned_facts(p_client_id)` — `distinct on (topic) order by source_sent_at desc`. This IS
  the recency rule: only Mattan's newest answer per topic reaches the drafter.
- `operator_learned_facts(p_gate, p_client_id)` → `{ok, facts:[{id, topic, fact_text, status,
  prospect_name, question, quote, reasoning, source_sent_at, chat_url}]}`
- `operator_resolve_learned_fact(p_gate, p_fact_id, p_decision, p_text)` — `approve` | `reject` |
  `retire`. Approving supersedes older approved facts on the same topic.
- `outreach_messages.draft_evidence` jsonb — keys: `at, facts, learned, exemplars, store_fact,
  anchor, scan_finding, scan_url, operator_note, voice_rows`.

🔴 `p_gate` in personal-site is `'clientops'`. **Check what gate string this PWA uses** —
`operator_gate_ok` will return `bad_gate` and the strip will render empty, not error.
🔴 `client_id` is **`risedtc`**, not `rise`. But `ops_drafts` writes `'rise'` for Slack kinds and
`DraftsScreen.tsx` already carries an `opsSeg()` shim for exactly that mismatch — do not copy the
shim here; `learned_facts` uses `risedtc` consistently.

## Definition of done
1. Pending facts render on the DMs surface with the judge's reasoning under "Why it proposed this".
2. Approve / discard writes through and the row leaves the pending list.
3. Evidence collapsible shows on a DM draft.
4. Then, and only then, remove `LearnedFactsStrip` from `OutreachInbox.tsx` so there is ONE approval
   surface. Leaving two is a double-approval hazard.

## Still open from the original build
`draft_evidence` has never been written by a live run — the RISE queue was empty all day
(`drafted: 0`). Confirm on the next real inbound reply.
