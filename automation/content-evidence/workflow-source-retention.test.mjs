import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retainWorkflowItems } from './workflow-source-retention.mjs';
import { planPlatformSourceAppend } from './continuing-platform-sources.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../../../content-brain-07-repair-2026-09-22-out/private/platform-normalization-requests.json', import.meta.url), 'utf8'));
const cells = [
  ['ivan', 'reddit', 'ivan-reddit-agency-owner-v1'], ['ivan', 'x', 'ivan-x-agency-owner-v1'],
  ['risedtc', 'reddit', 'risedtc-reddit-founder-pain-v1'], ['risedtc', 'x', 'risedtc-x-topic-and-reaction-v1'],
  ['arch', 'reddit', 'arch-reddit-ua-pain-v1'], ['arch', 'x', 'arch-x-mobile-games-ua-v1'],
];

test('six staged workflow sidecars retain actual raw response fields through an inert append mock', async () => {
  for (const [clientId, platform, queryConfigId] of cells) {
    const captured = fixture.find(x => x.clientId === clientId && x.platform === platform && x.queryConfigId === queryConfigId);
    const writes = [];
    const original = [{ json: captured.row }];
    const output = await retainWorkflowItems({ clientId, platform, queryConfigId, observedAt: captured.observedAt, items: original,
      append: async normalized => { const plan = planPlatformSourceAppend({ normalized, latest: null }); writes.push(plan.row); return plan; } });
    assert.strictEqual(output.items, original, `${clientId}/${platform} preserves existing branch items`);
    assert.equal(writes.length, 1, `${clientId}/${platform} one append request`);
    assert.equal(writes[0].passage, captured.row.text ?? captured.row.body ?? captured.row.selftext);
    assert.equal(writes[0].source_url, captured.row.url ?? captured.row.source_url);
    assert.equal(writes[0].candidate_fields.source_identity.native_id, captured.row.id ?? captured.row.platform_id ?? captured.row.reddit_id);
    assert.equal(writes[0].permission_state, 'public_source');
    assert.ok(writes[0].candidate_fields.acquisition.provider_run_id);
  }
});
