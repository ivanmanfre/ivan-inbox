# Unipile V2 shadow ingress

This endpoint only saves authenticated events into `unipile_v2_shadow.events`. It has no message processor, production-table dependency, provider API client, reply handler, route switch, or send operation. It is disabled until both its environment binding and its private database endpoint record are explicitly enabled. Deployment alone cannot migrate messaging.

## Validation

Run from this repository:

```sh
deno test --allow-read supabase/functions/unipile-v2-shadow/
deno check supabase/functions/unipile-v2-shadow/index.ts
python3 -m unittest discover -s db/tests -p 'test_unipile_v2_shadow.py' -q
```

The Python tests start a new PostgreSQL cluster on an owner-only temporary Unix socket, with no TCP listener. They use `pg_config --bindir`, create synthetic roles/data, and remove that disposable cluster afterward. They do not connect to Supabase. Deno tests have no network permission; the storage-adapter contract uses an injected transport. Actual deployed PostgREST/Edge parity needs a separate smoke test.

## Acceptance contract

The handler allows one MiB, verifies raw bytes with the endpoint HMAC before parsing, and uses one four-second deadline across body receipt, authentication and the database request. An aborted request may have committed before its acknowledgement was lost: retrying the same event is safe. It never automatically retries a database request. Proxy/gateway latency and Edge cold starts are outside this handler deadline and must be measured live.

The documented envelope fields `application_id`, `account_id` and `application_production` must exactly match local configuration and the database binding. Mismatched scope returns HTTP403 without storing another account's payload. Malformed envelopes return HTTP400. New event types remain quarantined rather than being guessed into a business operation. `message.new` includes outbound messages; none are treated as inbound work here.

Deduplication is `(endpoint_id, event_id)` with immutable JSON content. Reformatting JSON does not create a conflict. Changed content under the same event ID returns HTTP409 and preserves the original. Distinct events describing one message remain distinct: durable cross-version semantic dedup is **not implemented** by this receiver.

The RPC locks the configured endpoint before checking/inserting or updating counters. A new event and its counters commit together. The cap is 10,000 events and 128 MiB of **raw body bytes** per endpoint, whichever comes first; JSONB/index/row overhead adds physical storage beyond that raw-byte budget. Duplicates do not consume capacity. Exceeding the cap returns failure, not a false ACK. Each endpoint has an explicit expiry. Raw events expire after seven days; `unipile_v2_shadow_prune()` deletes expired rows and releases their capacity under the same endpoint locks.

The schema is private with RLS enabled and no user policies. `anon` and `authenticated` cannot read/write it or execute the RPCs. `service_role` can execute accept/prune but cannot directly alter endpoint bindings or rows. Only database administration configures the binding; provider secrets stay in Edge secrets, never SQL or logs.

## Deployment sequence

1. Apply only `db/20261116_unipile_v2_shadow.sql`, after verifying these names do not already exist. It adds no endpoint row and schedules nothing.
2. Deploy only `unipile-v2-shadow` with `--no-verify-jwt`. The new function verifies its own endpoint signature; it does not reuse a production webhook.
3. Verify an ordinary POST gets `receiver_disabled`, and verify anon RPC access is denied. This disabled smoke test needs no connected account and writes no event.
4. Before enabling: confirm the Unipile application's actual environment and rate settings; verify the existing account/application mapping without reconnecting. Provision a dedicated endpoint restricted to that explicit account, with its signing secret. Pin the actual observed event envelope and product/message fields. Register no existing production automation URL.
5. Configure `UNIPILE_V2_SHADOW_SECRET` and JSON `UNIPILE_V2_SHADOW_BINDING` (`enabled`, `endpointId`, `appId`, `accountId`, `production`), matching one private DB row with `client_id='ivan'`, a bounded expiry and caps. Create the row disabled first. Arrange hourly execution of the dedicated prune RPC before enabling retention-bearing traffic; no cleanup schedule is created by this migration. Both enable switches are required.
6. Use only a synthetic signed event for deployed persistence/duplicate/failure checks before a single-account live subscription. Record the synthetic rows separately, preserve receipts and avoid provider sends. Then observe real traffic without waking automation. No arbitrary observation timer substitutes for actual delivery/freshness evidence.

## Stop / rollback

Disable the private endpoint row or set the binding's `enabled` to false. Either stops new acceptance. Disable the dedicated Unipile subscription if registered. Keep the isolated events for investigation; do not drop tables or replay them into production. Existing V1 routes and queues are never changed by this component.

This receiver is not a production cutover approval. Semantic message identity/aliases, incoming/outgoing processing, edits/media, recovery reconciliation, cache freshness, rate budget and route/queue rollback remain the migration's separate gates.
