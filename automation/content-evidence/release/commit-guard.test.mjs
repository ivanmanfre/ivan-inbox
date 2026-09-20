// Tests for release/commit-guard.mjs. Synthetic previews only; no commit tool is ever run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkPreview, main } from './commit-guard.mjs';

const ENABLED = ['ivan', 'risedtc'];

const row = (cid, withPackage) => ({
  client_id: cid, kind: 'audn_recommendation', body: 'b',
  context: {
    cycle_id: 'weekly:2026-09-28',
    audn: { title: 't', weekly: { week_start: '2026-09-28', topic_key: 'k' } },
    ...(withPackage ? { evidence_package: { schema_version: 1, source_finding_ids: ['f1'], label: 'evidence_backed' } } : {}),
  },
});

const preview = (blocks, over = {}) => ({ preview: true, week_start: '2026-09-28', clients: blocks, ...over });
const block = (cid, rows) => ({ client_id: cid, coverage: { requested: 3 }, rows });

test('one enabled client with evidence rows is allowed', () => {
  const v = checkPreview(preview([block('ivan', [row('ivan', true)])]), ENABLED);
  assert.equal(v.allowed, true, JSON.stringify(v.problems));
  assert.deepEqual(v.evidenceClients, ['ivan']);
});

test('an un-enabled client carrying an evidence package is refused', () => {
  const v = checkPreview(preview([block('arch', [row('arch', true)])]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /arch carries an evidence package but is not in the reviewed enabled list/.test(p)));
});

test('an un-enabled client with no evidence package is not refused for that reason', () => {
  const v = checkPreview(preview([block('arch', [row('arch', false)])]), ENABLED);
  assert.equal(v.allowed, true, JSON.stringify(v.problems));
  assert.deepEqual(v.evidenceClients, []);
});

test('a multi-client evidence preview is refused even when every client is enabled', () => {
  const v = checkPreview(preview([
    block('ivan', [row('ivan', true)]),
    block('risedtc', [row('risedtc', true)]),
  ]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /must cover exactly one client/.test(p)));
});

test('the all-clients webhook shape the audit found is refused', () => {
  // A preview with evidence:true and no client_id covers every registry client, including arch.
  const v = checkPreview(preview([
    block('ivan', [row('ivan', true)]),
    block('risedtc', [row('risedtc', true)]),
    block('arch', [row('arch', true)]),
  ]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /arch carries an evidence package/.test(p)));
  assert.ok(v.problems.some((p) => /must cover exactly one client/.test(p)));
});

test('a file that is not a preview is refused', () => {
  const v = checkPreview(preview([block('ivan', [row('ivan', true)])], { preview: false }), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /not a native preview/.test(p)));
});

test('a row stamped with another tenant is refused', () => {
  const v = checkPreview(preview([block('ivan', [row('risedtc', true)])]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /carries a row stamped/.test(p)));
});

test('an incomplete client block is refused by name', () => {
  const v = checkPreview(preview([{ client_id: 'ivan', writer_bail: true }]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /ivan has an incomplete block/.test(p)));
});

test('a package saved under the older audn path is seen too', () => {
  const legacyShaped = {
    client_id: 'arch', kind: 'audn_recommendation', body: 'b',
    context: { audn: { title: 't', evidence_package: { schema_version: 1 } } },
  };
  const v = checkPreview(preview([block('arch', [legacyShaped])]), ENABLED);
  assert.equal(v.allowed, false);
  assert.ok(v.problems.some((p) => /arch carries an evidence package/.test(p)));
});

test('a webhook response wrapper is unwrapped', () => {
  const v = checkPreview({ response: preview([block('ivan', [row('ivan', true)])]) }, ENABLED);
  assert.equal(v.allowed, true, JSON.stringify(v.problems));
});

test('an enabled list that is not an array is refused', () => {
  const v = checkPreview(preview([block('ivan', [row('ivan', true)])]), { ivan: true });
  assert.equal(v.allowed, false);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fixtureFiles(previewValue, enabledValue = ENABLED) {
  const dir = mkdtempSync(path.join(tmpdir(), 'commit-guard-'));
  const p = path.join(dir, 'preview.json');
  const e = path.join(dir, 'enabled.json');
  writeFileSync(p, JSON.stringify(previewValue));
  writeFileSync(e, JSON.stringify(enabledValue));
  return { dir, p, e };
}

function capture() {
  const lines = []; const errors = [];
  return { io: { log: (s) => lines.push(String(s)), error: (s) => errors.push(String(s)) }, lines, errors };
}

test('a refused preview never reaches the commit tool', () => {
  const { p, e } = fixtureFiles(preview([block('arch', [row('arch', true)])]));
  const c = capture();
  let ran = 0;
  const code = main(['--preview', p, '--enabled', e, '--apply', '--output', '/dev/null'], c.io, () => { ran += 1; return { status: 0 }; });
  assert.equal(code, 1);
  assert.equal(ran, 0);
  assert.ok(c.errors.join('\n').includes('REFUSED'));
});

test('the default run is check only and commits nothing', () => {
  const { p, e } = fixtureFiles(preview([block('ivan', [row('ivan', true)])]));
  const c = capture();
  let ran = 0;
  const code = main(['--preview', p, '--enabled', e], c.io, () => { ran += 1; return { status: 0 }; });
  assert.equal(code, 0);
  assert.equal(ran, 0);
  assert.ok(c.lines.join('\n').includes('Nothing was committed'));
});

test('an allowed preview with --apply runs the existing tool unchanged', () => {
  const { p, e, dir } = fixtureFiles(preview([block('ivan', [row('ivan', true)])]));
  const c = capture();
  const calls = [];
  const code = main(['--preview', p, '--enabled', e, '--apply', '--output', path.join(dir, 'out.json')],
    c.io, (cmd, cmdArgs) => { calls.push([cmd, cmdArgs]); return { status: 0, stdout: '{"ok":true}' }; });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'python3');
  assert.ok(calls[0][1][0].endsWith('commit-reviewed.py'));
  assert.deepEqual(calls[0][1].slice(1, 3), ['--preview', p]);
});

test('--apply without --output is refused before anything runs', () => {
  const { p, e } = fixtureFiles(preview([block('ivan', [row('ivan', true)])]));
  const c = capture();
  let ran = 0;
  assert.equal(main(['--preview', p, '--enabled', e, '--apply'], c.io, () => { ran += 1; return { status: 0 }; }), 2);
  assert.equal(ran, 0);
});

test('a non-zero exit from the commit tool is surfaced', () => {
  const { p, e, dir } = fixtureFiles(preview([block('ivan', [row('ivan', true)])]));
  const c = capture();
  const code = main(['--preview', p, '--enabled', e, '--apply', '--output', path.join(dir, 'o.json')],
    c.io, () => ({ status: 1, stderr: 'Commit refused: {"ok":false}' }));
  assert.equal(code, 1);
  assert.ok(c.errors.join('\n').includes('Commit refused'));
});

test('regression: preview-must-carry-rows -- an F06 summary receipt with choices[] and no rows[] is refused by name', () => {
  const receipt = {
    schema_version: 1, client: 'ivan', week: '2026-09-28', preview: true, committed: false,
    clients: [{ client_id: 'ivan', choices: [{ choice_id: 'c1', title: 'A title' }] }],
  };
  const result = checkPreview(receipt, ['ivan']);
  assert.equal(result.allowed, false);
  const problem = result.problems.find((p) => p.includes('carries no rows[]'));
  assert(problem, 'the refusal names the missing rows[] rather than saying "incomplete block"');
  assert(problem.includes('raw native preview capture'), 'the refusal says which file to hand over');
  // and a real capture with rows[] is not refused for this reason
  const capture = { preview: true, clients: [{ client_id: 'ivan', rows: [] }] };
  assert.equal(checkPreview(capture, ['ivan']).problems.some((p) => p.includes('carries no rows[]')), false);
});
