#!/usr/bin/env node
// automation/weekly-topics/sync-selector.mjs
//
// automation/weekly-topics/writer.js is one n8n Code-node body: it cannot `import` anything.
// automation/content-evidence/selector-pack.mjs is the tested, dependency-free source of truth
// for buildEvidencePack/commitGuard (D6). This script copies that module's functions verbatim
// into a generated region of writer.js, between markers that carry the source module's sha256:
//
//   // <selector-pack:begin sha256=...>
//   ...generated body, byte-for-byte the exported functions of selector-pack.mjs...
//   // <selector-pack:end>
//
// writer.test.mjs's drift test recomputes the sha256 of the live selector-pack.mjs and asserts
// it matches the sha256 recorded in writer.js's begin marker -- so an edit to selector-pack.mjs
// that is not re-synced into writer.js fails the test suite instead of silently diverging.
//
// The transform is intentionally narrow: strip the leading `export ` off top-level
// `function`/`const` declarations (Code nodes have no module system, so every export just
// becomes a plain in-scope declaration) and drop the module's own file-level ESM imports (this
// module has none -- it is dependency-free by contract). Nothing else about the source changes:
// no minification, no renaming, no reordering. A reviewer can diff the generated region against
// selector-pack.mjs by eye.
//
// Usage: node automation/weekly-topics/sync-selector.mjs [--check]
//   (no flag)  regenerate the region in writer.js and rewrite the file.
//   --check    verify the region is already in sync; exit 1 and print the diff hint if not.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELECTOR_PATH = path.join(HERE, '../content-evidence/selector-pack.mjs');
const WRITER_PATH = path.join(HERE, 'writer.js');

const BEGIN_RE = /\/\/ <selector-pack:begin sha256=([0-9a-f]{64})>\n([\s\S]*?)\n\/\/ <selector-pack:end>/;
const ANCHOR = '// Pure projection: full evidence remains local for validation and saved provenance.';

export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** selector-pack.mjs source -> writer.js-embeddable source (no export keywords, no imports). */
export function transformForWriter(selectorSource) {
  const withoutImports = selectorSource
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line))
    .join('\n');
  const withoutExports = withoutImports
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'const ');
  return withoutExports.trim();
}

export function buildRegion(selectorSource) {
  const sha = sha256Hex(selectorSource);
  const body = transformForWriter(selectorSource);
  return `// <selector-pack:begin sha256=${sha}>\n`
    + '// GENERATED from automation/content-evidence/selector-pack.mjs by sync-selector.mjs.\n'
    + '// Do not hand-edit this block -- edit selector-pack.mjs and rerun the sync script.\n'
    + `${body}\n`
    + '// <selector-pack:end>';
}

export function currentRegionSha(writerSource) {
  const m = writerSource.match(BEGIN_RE);
  return m ? m[1] : null;
}

export function syncWriterSource(writerSource, selectorSource) {
  const region = buildRegion(selectorSource);
  if (BEGIN_RE.test(writerSource)) {
    return writerSource.replace(BEGIN_RE, region);
  }
  if (!writerSource.includes(ANCHOR)) {
    throw new Error(`sync-selector: anchor comment not found in writer.js: ${JSON.stringify(ANCHOR)}`);
  }
  return writerSource.replace(ANCHOR, `${region}\n\n${ANCHOR}`);
}

function main() {
  const check = process.argv.includes('--check');
  const selectorSource = readFileSync(SELECTOR_PATH, 'utf8');
  const writerSource = readFileSync(WRITER_PATH, 'utf8');
  const wantSha = sha256Hex(selectorSource);
  const haveSha = currentRegionSha(writerSource);

  if (check) {
    if (haveSha === wantSha) {
      process.stdout.write('sync-selector: writer.js selector-pack region is in sync.\n');
      process.exit(0);
    }
    process.stderr.write(`sync-selector: writer.js selector-pack region is STALE (have ${haveSha}, want ${wantSha}). `
      + 'Run `node automation/weekly-topics/sync-selector.mjs` to regenerate.\n');
    process.exit(1);
  }

  const next = syncWriterSource(writerSource, selectorSource);
  writeFileSync(WRITER_PATH, next);
  process.stdout.write(`sync-selector: writer.js selector-pack region synced to sha256=${wantSha}.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
