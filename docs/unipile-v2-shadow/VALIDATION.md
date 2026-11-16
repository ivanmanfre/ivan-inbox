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
