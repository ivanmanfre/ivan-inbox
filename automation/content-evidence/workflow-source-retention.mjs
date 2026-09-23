// Candidate collector sidecar. It normalizes actual collector items, calls an injected immutable
// append boundary, and returns the original items unchanged so existing candidate/model branches
// keep their prior inputs, caps and scheduling semantics.
import { normalizePlatformSource } from './platform-sources.mjs';

export async function retainWorkflowItems({ clientId, platform, queryConfigId, observedAt, items, append }) {
  if (!Array.isArray(items)) throw new TypeError('collector items must be an array');
  if (typeof append !== 'function') throw new TypeError('append boundary must be a function');
  const retained = [];
  for (const item of items) {
    const row = item?.json ?? item;
    const normalized = await normalizePlatformSource({ clientId, platform, queryConfigId, observedAt, row });
    const result = await append(normalized);
    retained.push({ source_id: normalized.source_id, source_kind: normalized.source_kind,
      snapshot_hash: normalized.snapshot_hash, append_action: result.action, seen_version: result.seen_version });
  }
  return { items, retained };
}
