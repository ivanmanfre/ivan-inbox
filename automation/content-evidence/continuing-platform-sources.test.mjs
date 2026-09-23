import test from 'node:test';
import assert from 'node:assert/strict';

import { PlatformAppendError, planPlatformSourceAppend } from './continuing-platform-sources.mjs';

const normalized = Object.freeze({
  client_id: 'arch', source_id: 'reddit:fixture-1', seen_version: 1,
  snapshot_hash: 'snapshot-a', source_kind: 'public_post', passage: 'Captured original body.',
});

test('plans the first immutable append at version one', () => {
  const plan = planPlatformSourceAppend({ normalized, latest: null });
  assert.equal(plan.action, 'insert');
  assert.equal(plan.row.seen_version, 1);
  assert.equal(plan.row.snapshot_hash, 'snapshot-a');
});

test('replays an identical snapshot without a second append', () => {
  const plan = planPlatformSourceAppend({ normalized, latest: { client_id: 'arch', source_id: 'reddit:fixture-1', seen_version: 3, snapshot_hash: 'snapshot-a' } });
  assert.equal(plan.action, 'replay');
  assert.equal(plan.row, null);
  assert.equal(plan.seen_version, 3);
});

test('appends a changed capture at the next immutable version', () => {
  const plan = planPlatformSourceAppend({ normalized: { ...normalized, snapshot_hash: 'snapshot-b' }, latest: { client_id: 'arch', source_id: 'reddit:fixture-1', seen_version: 3, snapshot_hash: 'snapshot-a' } });
  assert.equal(plan.action, 'insert');
  assert.equal(plan.row.seen_version, 4);
});

test('rejects cross-client and malformed latest-reader responses before any sink call', () => {
  assert.throws(() => planPlatformSourceAppend({ normalized, latest: { client_id: 'ivan', source_id: 'reddit:fixture-1', seen_version: 1, snapshot_hash: 'snapshot-a' } }),
    error => error instanceof PlatformAppendError && error.code === 'PLATFORM_APPEND_TENANT_MISMATCH');
  assert.throws(() => planPlatformSourceAppend({ normalized, latest: { client_id: 'arch', source_id: 'reddit:fixture-1', seen_version: 0, snapshot_hash: 'snapshot-a' } }),
    error => error instanceof PlatformAppendError && error.code === 'PLATFORM_APPEND_BAD_VERSION');
});
