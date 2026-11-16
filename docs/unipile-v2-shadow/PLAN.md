# V2 shadow receiver: deployment-runtime increment

Scope: add a disabled-by-default Supabase Edge receiver and private PostgreSQL quarantine inbox for Ivan's existing account. No production messaging tables, triggers, queues, routes, sessions or n8n workflows change. No send code or worker is imported. Real event delivery is a later gate after deployment prerequisites pass.

Contract source: https://developer.unipile.com/v2.0/reference/event-types-1 and https://developer.unipile.com/v2.0/docs/configure-a-webhook (read 2026-11-16). Event envelope has id, created_at, account_id, account_provider, application_id, application_production, type and payload. message.new includes inbound and outbound. Preserve unknown event types in quarantine rather than guessing their business meaning.

1. Deno Request handler: authenticate raw bytes before parsing, one four-second total deadline, one-MiB streaming cap, exact configured application/account/environment checks, disabled-by-default configuration, sanitized failures, ACK only after database receipt. Write failing Deno tests first.
2. PostgreSQL: separate private schema, deny anon/authenticated access, service-role-only RPC. Locally administered endpoint binding is required and disabled by default. Transactional event-ID dedup compares jsonb content so whitespace-only replays match; conflicting reuse fails without overwrite. Exact original bytes retained. Config-row lock serializes capacity counters and retries. Cap 10,000 events / 128 MiB per endpoint; explicit seven-day expiry and service-only prune function. No production business tables referenced.
3. Run handler tests, real PostgreSQL schema/ACL/dedup/failure/restart tests, Deno entrypoint typecheck, repository checks and one independent review. Keep source committed on a dedicated branch; live deployment/register only after these checks and concrete access/config evidence.

Review focus: ACK ordering, total deadlines including slow body, retries after ambiguous commit, conflicting event IDs, scope mismatch, anon/authenticated/service-role grants, storage caps, expired receiver/retention, raw-body secrecy, absence of sends/production writes, and deployment configuration.

Ruling: native worktree handoff only targets the current Content System project, which has no Git root. Use a separate ivan-inbox worktree from origin/main instead, preserving its dirty main checkout. Cost: the T3 thread remains attached to Content System; all commands use the explicit worktree path.

Baseline: source 73e6545f. Initial npm test had 300 failing files / 28 failing assertions, mostly missing VITE_SUPABASE_URL, plus external fixtures. Installed Node23 is unsupported by several dependencies. Corrected baseline uses installed Node20.19.6 and synthetic Supabase configuration; unrelated failures will be recorded rather than silently treated as a green project gate.

No real provider account/session calls are needed for offline tests. Management API function listing returned 112 deployed functions and no V2 receiver. Dashboard access previously reached sign-in; no environment or limit values are assumed.
