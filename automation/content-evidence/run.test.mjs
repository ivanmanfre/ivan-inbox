// CLI tests for run.mjs. No network, no provider calls, no DB -- every command reads a local JSON
// fixture and writes under a throwaway --out-root. main() returns an exit code instead of calling
// process.exit, so these tests drive it in-process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

function makeOutRoot() {
  return mkdtempSync(path.join(tmpdir(), 'content-evidence-run-test-'));
}

function captureIo() {
  const out = [];
  const err = [];
  return { io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }, out, err };
}

function tenantInventoryInput(outRoot, clientId = 'ivan') {
  const source = JSON.parse(readFileSync(path.join(FIXTURES, 'inventory-input.json'), 'utf8'));
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'content-evidence-tenant-input-')), 'tenant-inventory.json');
  writeFileSync(target, JSON.stringify(source.map((row) => ({ ...row, client_id: clientId }))));
  return target;
}

// ---------------------------------------------------------------------------
// --client is required and validated
// ---------------------------------------------------------------------------
test('missing --client exits non-zero with a named error, writes nothing', () => {
  const outRoot = makeOutRoot();
  const { io, err } = captureIo();
  const code = main(['plan-collect', '--out', 'plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_MISSING_CLIENT/);
  assert.equal(readdirSync(outRoot).length, 0);
});

test('an unregistered --client exits non-zero with a named error', () => {
  const outRoot = makeOutRoot();
  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'not-a-client', '--out', 'plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_UNKNOWN_CLIENT/);
});

// ---------------------------------------------------------------------------
// --out must resolve inside --out-root
// ---------------------------------------------------------------------------
test('a path-traversal --out outside --out-root is refused, nothing is written', () => {
  const outRoot = makeOutRoot();
  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', '../../etc/evil.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_OUT_OUTSIDE_ROOT/);
  assert.equal(readdirSync(outRoot).length, 0);
  assert.ok(!existsSync(path.resolve(outRoot, '..', '..', 'etc', 'evil.json')));
});

test('an absolute --out outside --out-root is refused', () => {
  const outRoot = makeOutRoot();
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'content-evidence-elsewhere-'));
  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', path.join(elsewhere, 'plan.json'), '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_OUT_OUTSIDE_ROOT/);
  assert.ok(!existsSync(path.join(elsewhere, 'plan.json')));
});

test('a root-relative --out resolves inside --out-root and writes exactly there', () => {
  const outRoot = makeOutRoot();
  const { io } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'nested/plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 0);
  assert.ok(existsSync(path.join(outRoot, 'nested/plan.json')));
});

// ---------------------------------------------------------------------------
// unknown command
// ---------------------------------------------------------------------------
test('an unknown command prints usage and exits non-zero', () => {
  const { io, err } = captureIo();
  const code = main(['not-a-real-command'], io);
  assert.equal(code, 2);
  assert.match(err.join('\n'), /usage:/);
});

test('no command at all prints usage and exits non-zero', () => {
  const { io, err } = captureIo();
  const code = main([], io);
  assert.equal(code, 2);
  assert.match(err.join('\n'), /usage:/);
});

// ---------------------------------------------------------------------------
// plan-collect never touches a provider and always reports approved_spend=0
// ---------------------------------------------------------------------------
test('plan-collect writes a plan and reports approved_spend=0, touching no provider', () => {
  const outRoot = makeOutRoot();
  const { io, out } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);
  assert.equal(code, 0);
  assert.match(out.join('\n'), /approved_spend=0/);
  const written = JSON.parse(readFileSync(path.join(outRoot, 'plan.json'), 'utf8'));
  assert.equal(written.clientId, 'ivan');
  assert.equal(written.pages.length, 3);
});

test('plan-collect with a missing rate exits non-zero with a named error and writes nothing', () => {
  const outRoot = makeOutRoot();
  const badRateCard = path.join(outRoot, 'bad-rate-card.json');
  writeFileSync(badRateCard, JSON.stringify({ some_other_unit: 0.1 }), 'utf8');
  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', badRateCard], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /COLLECT_MISSING_RATE/);
  assert.ok(!existsSync(path.join(outRoot, 'plan.json')));
});

// ---------------------------------------------------------------------------
// Each command writes only under --out
// ---------------------------------------------------------------------------
test('inventory writes a summary JSON file under --out and nothing else', () => {
  const outRoot = makeOutRoot();
  const { io } = captureIo();
  const code = main(['inventory', '--client', 'ivan', '--out', 'inventory.json', '--out-root', outRoot,
    '--input', tenantInventoryInput(outRoot)], io);
  assert.equal(code, 0);
  const entries = readdirSync(outRoot);
  assert.deepEqual(entries, ['inventory.json']);
  const written = JSON.parse(readFileSync(path.join(outRoot, 'inventory.json'), 'utf8'));
  assert.equal(written.distinctPosts, 3); // p1, p2, p3 (p3 duplicated once)
  assert.equal(written.distinctAuthors, 3); // author-a, author-b, author-c (the last has no post_id)
});

test('coverage writes a coverage JSON file with recomputable rows', () => {
  const outRoot = makeOutRoot();
  const { io } = captureIo();
  const code = main(['coverage', '--client', 'ivan', '--out', 'coverage.json', '--out-root', outRoot,
    '--input', tenantInventoryInput(outRoot)], io);
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(path.join(outRoot, 'coverage.json'), 'utf8'));
  assert.equal(written.summary.distinctPosts, 3);
  assert.equal(written.excluded[0].reason, 'missing_identity');
  assert.equal(written.excluded[0].count, 1); // the author-c row with no post_id
});

test('analyze writes a comparePatterns result JSON file', () => {
  const outRoot = makeOutRoot();
  const { io, out } = captureIo();
  const code = main(['analyze', '--client', 'ivan', '--out', 'analyze.json', '--out-root', outRoot,
    '--posts', path.join(FIXTURES, 'analyze-posts.json'),
    '--labels', path.join(FIXTURES, 'analyze-labels.json'),
    '--partition', path.join(FIXTURES, 'analyze-partition.json')], io);
  assert.equal(code, 0);
  // Symmetric fixture: 3 authors x (5 'one-change-one-number' + 5 'generic-narrative') means BOTH
  // labels qualify as a candidate pattern against the other as its comparator population.
  assert.match(out.join('\n'), /findings=2/);
  const written = JSON.parse(readFileSync(path.join(outRoot, 'analyze.json'), 'utf8'));
  assert.equal(written.findings.length, 2);
  assert.ok(written.findings.some((f) => f.pattern === 'one-change-one-number'));
});

test('report writes a markdown file built from the supplied source data', () => {
  const outRoot = makeOutRoot();
  const sample = JSON.parse(readFileSync(path.join(FIXTURES, 'report-sample.json'), 'utf8'));
  for (const key of ['coverage', 'winners', 'controls', 'cost', 'methods']) {
    writeFileSync(path.join(outRoot, `${key}.json`), JSON.stringify(sample[key]), 'utf8');
  }
  const { io } = captureIo();
  const code = main(['report', '--client', 'ivan', '--out', 'REPORT.md', '--out-root', outRoot,
    '--coverage', path.join(outRoot, 'coverage.json'),
    '--winners', path.join(outRoot, 'winners.json'),
    '--controls', path.join(outRoot, 'controls.json'),
    '--cost', path.join(outRoot, 'cost.json'),
    '--methods', path.join(outRoot, 'methods.json')], io);
  assert.equal(code, 0);
  const md = readFileSync(path.join(outRoot, 'REPORT.md'), 'utf8');
  assert.match(md, /## Coverage/);
  assert.match(md, /## Winners/);
});

test('report with a corrupted summary count exits non-zero and writes nothing', () => {
  const outRoot = makeOutRoot();
  const sample = JSON.parse(readFileSync(path.join(FIXTURES, 'report-sample.json'), 'utf8'));
  sample.coverage.summary.distinctPosts = 999;
  writeFileSync(path.join(outRoot, 'coverage.json'), JSON.stringify(sample.coverage), 'utf8');
  const { io, err } = captureIo();
  const code = main(['report', '--client', 'ivan', '--out', 'REPORT.md', '--out-root', outRoot,
    '--coverage', path.join(outRoot, 'coverage.json')], io);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /REPORT_CORRUPTED_COUNT/);
  assert.ok(!existsSync(path.join(outRoot, 'REPORT.md')));
});

// ---------------------------------------------------------------------------
// MF-1 (Sol review): symlink escape. A lexical path.resolve containment check accepts a symlink
// that lives inside --out-root but points outside it. The fix must realpath the longest EXISTING
// prefix of both the resolved --out path and --out-root before comparing, and separately refuse
// when the exact final --out path component is itself an existing symlink.
// ---------------------------------------------------------------------------

test('MF-1(a): a directory symlink inside --out-root used as --out\'s parent is refused, nothing written anywhere', () => {
  const outRoot = makeOutRoot();
  const outsideTarget = mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-run-outside-'));
  symlinkSync(outsideTarget, path.join(outRoot, 'escape-link'), 'dir'); // symlink INSIDE --out-root, pointing OUTSIDE it

  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'escape-link/plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);

  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_OUT_OUTSIDE_ROOT|RUN_OUT_IS_SYMLINK/);
  assert.deepEqual(readdirSync(outsideTarget), [], 'nothing must land in the real directory the symlink points to');
});

test('MF-1(b): a file symlink as the --out target itself is refused, victim file left untouched', () => {
  const outRoot = makeOutRoot();
  const victimDir = mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-run-victim-'));
  const victim = path.join(victimDir, 'victim.json');
  writeFileSync(victim, JSON.stringify({ untouched: true }), 'utf8');
  symlinkSync(victim, path.join(outRoot, 'plan.json'), 'file'); // --out's exact target already exists as a symlink

  const { io, err } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'plan.json', '--out-root', outRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);

  assert.equal(code, 1);
  assert.match(err.join('\n'), /RUN_OUT_IS_SYMLINK/);
  assert.equal(JSON.parse(readFileSync(victim, 'utf8')).untouched, true, 'the victim file must be untouched');
});

test('MF-1(c): an --out-root itself reached through a symlink still works (macOS /tmp -> /private/tmp shape)', () => {
  const realOutRoot = mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-run-real-'));
  const linkRoot = path.join(mkdtempSync(path.join(tmpdir(), 'content-evidence-mf1-run-linkparent-')), 'out-root-link');
  symlinkSync(realOutRoot, linkRoot, 'dir'); // linkRoot is a symlink TO realOutRoot, not inside it

  const { io, out } = captureIo();
  const code = main(['plan-collect', '--client', 'ivan', '--out', 'plan.json', '--out-root', linkRoot,
    '--gaps', path.join(FIXTURES, 'collect-gaps.json'), '--rate-card', path.join(FIXTURES, 'collect-rate-card.json')], io);

  assert.equal(code, 0, out.join('\n'));
  assert.ok(existsSync(path.join(realOutRoot, 'plan.json')), 'the file must exist at the REAL location behind the symlinked --out-root');
});

test('inventory refuses foreign tenant rows instead of relabelling them', () => {
  const outRoot = makeOutRoot(); const input = path.join(outRoot, 'foreign.json');
  writeFileSync(input, JSON.stringify([{ client_id: 'arch', post_id: 'p', author_id: 'a' }]));
  const { io, err } = captureIo();
  const code = main(['inventory', '--client', 'ivan', '--out', 'inventory.json', '--out-root', outRoot, '--input', input], io);
  assert.equal(code, 1); assert.match(err.join('\n'), /RUN_TENANT_MISMATCH/); assert.ok(!existsSync(path.join(outRoot, 'inventory.json')));
});

test('analyze rejects posts outside the requested tenant', () => {
  const outRoot = makeOutRoot(); const posts = path.join(outRoot, 'posts.json'); const labels = path.join(outRoot, 'labels.json'); const partition = path.join(outRoot, 'partition.json');
  writeFileSync(posts, JSON.stringify([{ client_id: 'arch', author_id: 'a', post_id: 'p', value: 1 }])); writeFileSync(labels, JSON.stringify([{ post_id: 'p', pattern: 'x', label_version: 'v' }])); writeFileSync(partition, JSON.stringify({ discovery: ['p'], holdout: [], exposure: 'retrospective' }));
  const { io, err } = captureIo(); const code = main(['analyze', '--client', 'ivan', '--out', 'result.json', '--out-root', outRoot, '--posts', posts, '--labels', labels, '--partition', partition], io);
  assert.equal(code, 1); assert.match(err.join('\n'), /RUN_TENANT_MISMATCH/);
});
