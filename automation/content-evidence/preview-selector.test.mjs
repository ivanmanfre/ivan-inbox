// preview-selector.mjs tests. Synthetic study/digest JSON only -- no private post bodies, no
// real profile URLs. F6 (PRELEASE-AUDIT.md): the markdown renderer must not print
// "[object Object]" for an object-valued coverage field (author_pool_cap, small_author_baseline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview, toMarkdown } from './preview-selector.mjs';

const studyJson = {
  study_id: 's1', state: 'validated',
  findings: [{
    client_id: 'ivan', finding_id: 'f1', kind: 'market', source_ids: ['p1'],
    observed_value: 400, baseline_value: 50, baseline_n: 30,
  }],
};
const digestJson = {
  clients: { ivan: { findings: [{
    finding_id: 'f1', likes: 90, author: 'Synthetic Author',
    source_url: 'https://example.org/p1', first_line: 'A synthetic first line.', published_at: '2026-01-01',
  }] } },
};

test('the markdown renderer never prints [object Object] for an object-valued coverage field', () => {
  const preview = buildPreview({ clientId: 'ivan', weekStart: '2026-09-28', studyJson, digestJson });
  const md = toMarkdown(preview);
  assert(!md.includes('[object Object]'));
  assert(md.includes('author_pool_cap'));
  assert(typeof preview.coverage.author_pool_cap === 'object');
});

test('the rendered test_metric is plain words, not the raw metric_id/policy id', () => {
  const preview = buildPreview({ clientId: 'ivan', weekStart: '2026-09-28', studyJson, digestJson });
  const md = toMarkdown(preview);
  assert(preview.choices.length > 0);
  assert(!/test_metric: new-policy-v1/.test(md));
});
