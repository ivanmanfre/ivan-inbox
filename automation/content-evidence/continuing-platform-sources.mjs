// Pure append planner for collector bridges. The caller owns its authenticated
// `editorial_sources` version read and service-role insert; this module never opens a network
// or database connection, so fixture tests cannot mutate a live lane.

export class PlatformAppendError extends Error {
  constructor(code, message) { super(message); this.name = 'PlatformAppendError'; this.code = code; }
}

const fail = (code, message) => { throw new PlatformAppendError(code, message); };
const positiveInteger = (value) => Number.isInteger(value) && value >= 1;

/**
 * Given one normalized source and the single latest immutable row returned by the existing
 * authenticated reader, return either a safe insert payload or an idempotent replay result.
 */
export function planPlatformSourceAppend({ normalized, latest } = {}) {
  if (!normalized || typeof normalized !== 'object') fail('PLATFORM_APPEND_BAD_SOURCE', 'normalized source is required.');
  const { client_id: clientId, source_id: sourceId, snapshot_hash: snapshotHash } = normalized;
  if (typeof clientId !== 'string' || !clientId || typeof sourceId !== 'string' || !sourceId || typeof snapshotHash !== 'string' || !snapshotHash) {
    fail('PLATFORM_APPEND_BAD_SOURCE', 'normalized source must include client_id, source_id and snapshot_hash.');
  }
  if (latest === null || latest === undefined) {
    return { action: 'insert', seen_version: 1, row: { ...normalized, seen_version: 1 } };
  }
  if (typeof latest !== 'object' || latest.client_id !== clientId || latest.source_id !== sourceId) {
    fail('PLATFORM_APPEND_TENANT_MISMATCH', 'latest reader row must match the normalized client and source.');
  }
  if (!positiveInteger(latest.seen_version)) fail('PLATFORM_APPEND_BAD_VERSION', 'latest reader row must include a positive seen_version.');
  if (typeof latest.snapshot_hash !== 'string' || !latest.snapshot_hash) fail('PLATFORM_APPEND_BAD_HASH', 'latest reader row must include snapshot_hash.');
  if (latest.snapshot_hash === snapshotHash) {
    return { action: 'replay', seen_version: latest.seen_version, row: null };
  }
  const seenVersion = latest.seen_version + 1;
  return { action: 'insert', seen_version: seenVersion, row: { ...normalized, seen_version: seenVersion } };
}
