# Validation ledger

Source base: 73e6545f.

New Deno tests: 11 passed; Deno entrypoint typecheck passed. Real PostgreSQL17 tests: 8 passed (including concurrency, ACLs, insert failure, capacity, retention and immediate restart). Test-first runs recorded missing handler/adapter/migration failures before implementation.

Corrected repository baseline, before implementation: Node20.19.6, synthetic VITE_SUPABASE_URL/key, `vitest run --maxWorkers=2`: 592 passing files, 15 failing files, one skipped; 6770 passing assertions, 25 failing, six skipped, one unhandled error. These are pre-existing failures in the source base, not a green repository suite.

Failing files:

- `src/d/dms/dms4.test.tsx`
- `src/d/lanes/ClientCost.test.tsx`
- `src/d/lanes/clientCostData.test.ts`
- `src/d/lanes/replySources.mounts.test.tsx`
- `src/d/swishdmSeat.test.ts`
- `src/d/x/desk.test.tsx`
- `src/lib/editorialSelection.test.ts`
- `src/sql/editorialGenerationRoutes.test.ts`
- `src/sql/editorialImport.pglite.test.ts`
- `src/sql/editorialNativeBridge.pglite.test.ts`
- `src/sql/editorialRefresh.pglite.test.ts`
- `src/sql/replySourcesAccess.pglite.test.ts`
- `src/wb/content/LeadMagnetsBlock.retry.test.tsx`
- `supabase/functions/content-plan-quotes/quotes.test.ts`
- `supabase/functions/content-poland-read/read.test.ts`

Live preflight: Supabase PostgreSQL17.6, migration role postgres, explicit client_registry entry ivan, pg_cron available; receiver schema and RPC names absent. Function list:112 functions, no unipile-v2-shadow. No live mutation yet.

Independent review: approved merge and disabled deployment, no critical/important findings. Reviewer independently reran 11 Deno and 8 PostgreSQL tests plus entrypoint typecheck. Frontend production build and git diff whitespace check passed.

Deferred minor: the handler accepts the malformed event ID `evt_` while PostgreSQL requires a suffix. That signed malformed input is rejected by storage but reported as HTTP503 instead of HTTP400. It cannot overwrite or authorize an event. Fix before enabling if desired; this is not a disabled-deployment blocker.

Review rulings: actual provider signature/envelope interoperability remains an enablement gate; disabled deployed Edge/PostgREST/ACL smoke tests are next; prune scheduling is required before enabling retention-bearing traffic; full migration and the existing frontend failures remain outside this isolated increment. Cost of these exclusions: this receiver may be deployed disabled but cannot yet justify live ingestion or a V2 cutover.

Automatic approval review initially stopped schema creation via consumer-gate, requiring `who-reads events` and identification of unfiltered/indirect readers before the same command may be retried. The change was not applied by that attempt. The gate is being satisfied through its required read-only investigation, not bypassed.

Final full-suite verification: identical to corrected baseline — 15 failing files / 25 assertions / one unhandled error, 592 passing files / 6770 assertions. No new failing file; no baseline failure disappeared. Full run completed in 412.69 seconds. This remains a red whole-repository gate, so the implementation is kept in draft PR171 rather than represented as a fully green merge.

Consumer gate resolution: completed the direct generic-word scan (507 workflow/112 Edge snapshots; approximately4h28m old;43 unfiltered textual candidates; no source errors), plus live namespace-specific catalog and qualified-source checks. No existing events relation, private-schema/function/view reference or known reader of the exact new target existed.389 generic indirect candidates and252 dynamic/unreadable cases were documented without claiming exhaustive arbitrary-SQL absence. The original broad indirect source scan was stopped after expanding generic identifiers into costly unrelated git searches. No approval bypass was used; required facts were presented before repeating the identical guarded migration command, which succeeded.

Deployed on2026-11-16: only unipile-v2-shadow, version1, ACTIVE, verify_jwt=false; no other pre-existing Edge function version changed. The private migration was applied after the absent-name guard. No endpoint row, signing secret, environment binding, subscription or cleanup schedule was created. Live POST returned503 receiver_disabled. Live anon RPC returned401/42501. Live catalog: endpoint_rows=0, event_rows=0, RLS=true, anon/authenticated RPC=false, service RPC=true, direct service schema access=false. This proves disabled deployment and ACLs; enabled signed persistence and provider delivery remain untested live.

User reports an existing dashboard login. T3 preview reached login in its separate session; requested which browser holds the user's session. No credential request or client reconnection was attempted. Environment/limits remain unverified until that session is inspected.
