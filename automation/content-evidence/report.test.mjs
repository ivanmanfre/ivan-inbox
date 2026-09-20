// Report renderer tests. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderReport, ReportError } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(readFileSync(path.join(HERE, 'fixtures/report-sample.json'), 'utf8'));

test('renders coverage, winners, controls, cost, exclusions and method sections from source data', () => {
  const md = renderReport(SAMPLE);
  assert.match(md, /## Coverage/);
  assert.match(md, /## Winners/);
  assert.match(md, /## Controls/);
  assert.match(md, /## Cost/);
  assert.match(md, /## Method records/);
  assert.match(md, /### Exclusions/);
  assert.match(md, /reshare: 2/);
  assert.match(md, /missing_canonical_id: 1/);
});

test('recomputes displayed counts from rows rather than trusting the caller', () => {
  const md = renderReport(SAMPLE);
  assert.match(md, /Distinct posts: 3/);
  assert.match(md, /Distinct authors: 2/);
});

test('a corrupted summary count (disagrees with its own rows) throws a named error', () => {
  const corrupted = JSON.parse(JSON.stringify(SAMPLE));
  corrupted.coverage.summary.distinctPosts = 999; // rows only support 3
  assert.throws(
    () => renderReport(corrupted),
    (err) => err instanceof ReportError && err.code === 'REPORT_CORRUPTED_COUNT',
  );
});

test('a corrupted winners.summary.count throws the same named error', () => {
  const corrupted = JSON.parse(JSON.stringify(SAMPLE));
  corrupted.winners.summary.count = 5; // only 1 winner row supplied
  assert.throws(
    () => renderReport(corrupted),
    (err) => err instanceof ReportError && err.code === 'REPORT_CORRUPTED_COUNT',
  );
});

test('a correct summary that matches its rows renders without error', () => {
  assert.doesNotThrow(() => renderReport(SAMPLE));
});

test('null values render as "unknown", never as 0', () => {
  const withNulls = {
    coverage: { rows: [{ postId: 'p1', authorId: 'a' }], summary: {} },
    winners: {
      rows: [{ sourceId: 'p1', author: 'a', openingLine: 'short line', publishedAt: null, observedValue: null, baselineValue: 0, liftValue: null, sampleN: null }],
    },
    cost: { approvedUsd: 0, actualUsd: null, paidProviderRequestsMade: 0 },
  };
  const md = renderReport(withNulls);
  const rows = md.split('\n').filter((l) => l.startsWith('| p1'));
  assert.equal(rows.length, 1);
  // publishedAt/observedValue/liftValue/sampleN are null -> unknown; baselineValue is a genuine 0.
  assert.match(rows[0], /\| unknown \| unknown \|/, 'a null publishedAt/observedValue must render as unknown, not blank or 0');
  assert.match(rows[0], /\| 0 \|/, 'a real 0 baselineValue must render as 0, not unknown');
  assert.match(md, /Actual spend: unknown/);
});

test('a genuine zero cost renders as 0, not unknown', () => {
  const md = renderReport({ cost: { approvedUsd: 0, actualUsd: 0, paidProviderRequestsMade: 0 } });
  assert.match(md, /Approved spend: \$0\.00/);
  assert.match(md, /Actual spend: \$0\.00/);
  assert.match(md, /Paid provider requests made: 0/);
});

test('legacy figures are labeled "reported (legacy), not verified"', () => {
  const md = renderReport(SAMPLE);
  assert.match(md, /reported \(legacy\), not verified/);
  // The non-legacy method row must NOT carry the legacy label.
  const lines = md.split('\n').filter((l) => l.startsWith('- public-weighted-v1'));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('reported (legacy)'));
});

test('body text never appears beyond a 12-word opening fragment, even if the caller supplies more', () => {
  const longBody = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen this-should-never-appear';
  const md = renderReport({
    winners: {
      rows: [{ sourceId: 'p1', author: 'a', openingLine: longBody, publishedAt: '2026-01-01', observedValue: 10, baselineValue: 5, liftValue: 2, sampleN: 10 }],
    },
  });
  assert.ok(!md.includes('this-should-never-appear'));
  assert.ok(!md.includes('fourteen fifteen'));
  assert.match(md, /one two three four five six seven eight nine ten eleven twelve…/);
});

test('missing sections render a plain "no data supplied" message rather than crashing', () => {
  const md = renderReport({});
  assert.match(md, /No coverage data supplied\./);
  assert.match(md, /No winner data supplied\./);
  assert.match(md, /No control data supplied\./);
  assert.match(md, /No cost data supplied\./);
  assert.match(md, /No method records supplied\./);
});
