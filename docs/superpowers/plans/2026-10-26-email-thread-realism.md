# Email thread realism implementation plan

**Goal:** Show readable email conversations and an accurate outgoing preview, and match address changes safely.

**Scope:** Existing inbox React/TypeScript app and tenant-scoped inbound n8n email flows. The user's request authorizes these reversible changes. Preserve existing send approval, forwarding, scheduling, held-message actions, mixed LinkedIn history, and per-client sender identities.

**Design:** Email history uses full-width light email sheets with subject, sender, recipients, date, and body. Draft and manual reply editors show the envelope and a preview of the current edited body. The manual reply subject and verified thread headers stay attached to the selected inbound. Missing historical metadata is explicit. LinkedIn messages retain their current presentation.

## Tasks

- [ ] Read metadata and reconstruct exact historical subjects from uniquely matching sent mirror bodies. Add pure presentation and transport tests, implement a bounded thread-only reader, and hydrate the open thread without full-inbox reads.
- [ ] Build native email history, draft editors and previews, preserving existing actions. Verify subject/body separation, current edits and mixed history with component tests.
- [ ] Show manual reply subject and recipients before send; carry the displayed target into confirmation and reject a changed target before queuing. Test transport and component behavior without sending real email.
- [ ] Add safe alternate-address matching with tenant, ambiguity and authentication tests. Validate and verify exact live workflow source.
- [ ] Run relevant regressions, full test suite and build. Inspect desktop and phone screenshots, get a fresh full-diff review, then merge/deploy and verify the live bundle.

## Review focus

The preview must match the actual sender's Subject-line/body contract, including email mirrors and companion drafts. Never fabricate a historical subject, sender or delivery claim. A matching address/domain alone must not attach one colleague's reply to another prospect. Do not use real prospect sends or bookings as tests.
