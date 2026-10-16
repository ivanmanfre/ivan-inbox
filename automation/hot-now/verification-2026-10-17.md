# Hot now rollout verification · 17 October 2026

Scope: Jonathan / SwishDM. The Inbox card is compact and full post review opens in the shared drawer. The existing operator and client approval stages remain.

## Evidence gate

The market-v1 policy requires three independent people across two original discussions, including two attributable practitioners or buyers, factual primary support, a verifiable event date, and observed growth or substantive replies. Vendor releases, copies, syndication and likes alone cannot qualify. Counted X quotes must also match public oEmbed text. Saved receipts and each decision are immutable to the service writer. Read and approval checks reject stale evidence, duplicates and edits without a matching exact-text quality review.

## Checks

- All 51 focused policy, collector, rendered-workflow, SQL permission/approval, exact-edit review and UI tests pass. The three workflow tests execute the actual generated Code node against deterministic fixtures.
- Production build passes. Lint has no errors; the existing combined component/hook export carries a Fast Refresh warning.
- Full repository suite: 461 files passed, eight failed and one skipped; 5,478 tests passed, eight failed and six skipped. The same eight test failures occurred on the pre-change baseline. Missing private workflow mirrors / fixtures affect editorial routes, import, native bridge, selection and content-plan-quotes; remaining failures are existing editorial refresh, rate-comparison and timezone snapshot cases. No unrelated tests were changed.
- Actual component at 1280px viewport: approximately 163px card height. At 375px: approximately 230px, no horizontal overflow, 44px buttons. Phone drawer fills 375×812 viewport and receives focus. Editor tests cover focus retention and QA refresh recovery.
- Independent review found eight important issues and no critical issues; all were addressed with regression coverage in one fix pass.

## Rollout and calibration

Migration 290 was applied to production. Authenticated operator reads returned no qualified legacy cards and no evidence for a missing event. Evidence/run tables have RLS enabled, with service SELECT/INSERT only. No qualified event existed at rollout.

The radar is deployed in shadow mode. Broad discovery runs hourly at :07; evidence/watch rechecks at :37, 07–21 Europe/London. Shadow does not create posts or send suggestions. There is no automatic switch to live mode.

Seven days is the first review point. At least 30 independently adjudicated events, ten reserved before tuning and ten qualifying positives are required before evaluating the 90% precision bar. Historical rows lack retained full social evidence and cannot establish retrospective heat. Source failures and empty result sets are recorded separately. A seven-day follow-up audit will report quality, coverage and actual provider usage before any live-mode decision.
