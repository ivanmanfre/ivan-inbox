# SwishDM Hot now: market-v1

Discovery nominates an event. The tested `validation.ts` policy requires three independent people across two discussions, two attributable practitioners/buyers, factual support, a real event date and observed traction. Candidate-specific searches retain full source text and identities; an independent public oEmbed quote match is required before X commentary can count. A vendor announcement alone cannot promote.

`market-check.ts` checks public evidence. `render-workflow.mjs` compiles the same evaluator into the existing five-node n8n radar from a fresh private workflow snapshot. It never contains service credentials. `review-edits.js` checks operator-edited text without shipping a rewrite. The database binds exact reviewed text and immutable service-written evidence to each Home card.

The original collector CJdippxWmn9uRfooo documents mock padding for empty results. The replacement is the existing Apify account's pay-per-use apidojo/tweet-scraper, using its inspected `searchTerms`, `maxItems`, `sort: Latest` contract. No subscription was added. Returned posts still require a public text match; dates, independent identities and counts are evaluated in code.

Broad scans stay hourly at minute 07; watch/evidence rechecks run at minute 37. The source mode remains `shadow` during calibration. Shadow runs do not create new posts, surface Home cards or ring. Manual picks remain intentional drafts outside the validated feed.

## Verification

- `npx vitest run src/lib/hotNow*.test.ts src/d/home/HotNow.test.tsx`
- `HOT_NOW_WORKFLOW_REPLAY=1 npx vitest run src/lib/hotNowWorkflow.test.ts` with an explicitly provided private `.superpowers/hot-now/workflow-before.json` snapshot.
- `npm run build`
- DB migration: `db/290_hot_now_market_validation.sql`. Rollback restores previous read/push behavior while retaining evidence history.

## Calibration

On 17 October 2026 only 16 historical event rows existed, below the planned 30-event sample. Their original full social receipts were not retained. They cannot establish retrospective market heat. Keep their private export as context and collect new timestamped evidence prospectively. Do not backfill historical positive labels using current engagement. Continue until at least 30 independently adjudicated events exist; reserve ten before tuning. Seven days and ten qualifying positives are minimum observation criteria, not a guarantee that the rubric is ready.

Track source failures separately from empty searches, direct permalink failures, late detection, watch-to-qualified transitions and duplicate events. Review provider usage from Apify run records, rather than estimating charges from a code comment. No automated transition to live mode is included.

## Runtime correction

The first shadow run (`tr-mvbkr87s`) finished without drafts but the new X actor silently rejected `since_time` and returned no posts. Its empty X results cannot establish source health or missed-topic coverage. The collector now strips the actor’s forbidden timestamp/ID operators, uses Latest, and enforces the six-hour evidence window from retained post timestamps in code. Exclude that first run’s X empties from calibration. Regression checks cover generated and model-suggested queries.
