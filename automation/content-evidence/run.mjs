#!/usr/bin/env node
// content-evidence (staged, Run-3-ready) / run.mjs
//
// A file-based CLI over patterns.mjs / collect.mjs / report.mjs. No network, no provider calls, no
// DB -- every command reads its input from a JSON file the caller supplies and writes its output
// under `--out`. This is a staged, self-contained package (see patterns.mjs's header): Run 3 is
// the one that will eventually wire these commands to real stores and a real provider adapter.
//
// Two rules hold for every command:
//   * `--client` is required and must be one of the three registered tenants. There is no default.
//   * `--out` must resolve inside the `--out-root` the caller supplies. A relative `--out` resolves
//     AGAINST `--out-root` (matching this repo's own n8nac path convention: absolute, or
//     root-relative). Anything that resolves outside `--out-root` -- including `../` traversal --
//     is refused with a named error, a non-zero exit, and NOTHING WRITTEN: the path is checked
//     before any file is opened for writing.
//
// `main(argv, io)` is exported and returns an exit code rather than calling process.exit itself, so
// tests can drive it without spawning a subprocess. The bottom of this file calls process.exit only
// when the module is actually run as a script.

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { comparePatterns, PatternsError, DEFAULT_POLICY } from './patterns.mjs';
import { planCollection, CollectError, isSymlinkPath, realpathOfLongestExistingPrefix } from './collect.mjs';
import { renderReport, ReportError } from './report.mjs';

export const REGISTERED_CLIENTS = Object.freeze(['ivan', 'risedtc', 'arch']);
const COMMANDS = Object.freeze(['inventory', 'coverage', 'analyze', 'plan-collect', 'report']);

export class RunError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'RunError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new RunError(code, message, details); };

const USAGE = `usage: run.mjs <${COMMANDS.join('|')}> --client <ivan|risedtc|arch> --out <path> --out-root <path> [command-specific flags]`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv        e.g. process.argv.slice(2)
 * @param {{stdout?: Function, stderr?: Function}} [io]
 * @returns {number} process exit code
 */
export function main(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => console.log(line));
  const stderr = io.stderr ?? ((line) => console.error(line));

  const [command, ...rest] = argv;
  if (!command || !COMMANDS.includes(command)) {
    stderr(USAGE);
    return 2;
  }

  const flags = parseArgs(rest);
  try {
    const clientId = requireClient(flags);
    const outPath = resolveOutPath(flags);
    switch (command) {
      case 'inventory': return runInventory(flags, clientId, outPath, stdout);
      case 'coverage': return runCoverage(flags, clientId, outPath, stdout);
      case 'analyze': return runAnalyze(flags, clientId, outPath, stdout);
      case 'plan-collect': return runPlanCollect(flags, clientId, outPath, stdout);
      case 'report': return runReport(flags, clientId, outPath, stdout);
      default: return 2; // unreachable: guarded by COMMANDS.includes above
    }
  } catch (err) {
    const code = err && err.code ? ` [${err.code}]` : '';
    stderr(`${err && err.name ? err.name : 'Error'}${code}: ${err && err.message ? err.message : String(err)}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function runInventory(flags, clientId, outPath, stdout) {
  const records = readJsonInput(flags, 'input');
  requireArrayTenant(records, clientId, 'input');
  const summary = summarizeRecords(clientId, records);
  writeJsonAtomic(outPath, summary);
  stdout(`inventory written for ${clientId}: distinct_posts=${summary.distinctPosts} distinct_authors=${summary.distinctAuthors}`);
  return 0;
}

function runCoverage(flags, clientId, outPath, stdout) {
  const records = readJsonInput(flags, 'input');
  requireArrayTenant(records, clientId, 'input');
  const rows = records
    .filter((r) => typeof r.post_id === 'string' && typeof r.author_id === 'string')
    .map((r) => ({ postId: r.post_id, authorId: r.author_id }));
  const excludedCount = records.length - rows.length;
  const coverage = {
    clientId,
    rows,
    summary: {
      distinctPosts: new Set(rows.map((r) => r.postId)).size,
      distinctAuthors: new Set(rows.map((r) => r.authorId)).size,
    },
    excluded: excludedCount > 0 ? [{ reason: 'missing_identity', count: excludedCount }] : [],
  };
  writeJsonAtomic(outPath, coverage);
  stdout(`coverage written for ${clientId}: distinct_posts=${coverage.summary.distinctPosts} distinct_authors=${coverage.summary.distinctAuthors}`);
  return 0;
}

function runAnalyze(flags, clientId, outPath, stdout) {
  const posts = readJsonInput(flags, 'posts');
  const labels = readJsonInput(flags, 'labels');
  requireArrayTenant(posts, clientId, 'posts');
  requireOptionalArrayTenant(labels, clientId, 'labels');
  const partition = readJsonObjectInput(flags, 'partition');
  const policy = flags.policy ? readJsonObjectInput(flags, 'policy') : DEFAULT_POLICY;
  let result;
  try {
    result = comparePatterns({ posts, labels, partition, policy });
  } catch (err) {
    if (err instanceof PatternsError) throw err;
    throw err;
  }
  if (result.findings.some((row) => row.client_id !== clientId)) {
    fail('RUN_TENANT_MISMATCH', `analyze result belongs to a tenant other than ${JSON.stringify(clientId)}`);
  }
  result = { ...result, clientId };
  writeJsonAtomic(outPath, result);
  stdout(`analyze written for ${clientId}: findings=${result.findings.length} insufficient=${result.insufficient.length} holdout_status=${result.holdoutStatus}`);
  return 0;
}

function runPlanCollect(flags, clientId, outPath, stdout) {
  const gaps = readJsonInput(flags, 'gaps');
  requireOptionalArrayTenant(gaps, clientId, 'gaps');
  const rateCard = readJsonObjectInput(flags, 'rate-card');
  let plan;
  try {
    plan = planCollection({ clientId, gaps, rateCard });
  } catch (err) {
    if (err instanceof CollectError) throw err;
    throw err;
  }
  writeJsonAtomic(outPath, plan);
  // plan-collect never touches a provider and always reports zero approved spend: planning is a
  // quote, never a spend. Actual collection execution (runCollection) is a separate, budget-gated
  // step this command never invokes.
  stdout(`plan-collect written for ${clientId}: pages=${plan.pages.length} total_estimated_cost_usd=${plan.totalEstimatedCostUsd} approved_spend=0`);
  return 0;
}

function runReport(flags, clientId, outPath, stdout) {
  const coverage = flags.coverage ? readJsonObjectInput(flags, 'coverage') : undefined;
  const winners = flags.winners ? readJsonObjectInput(flags, 'winners') : undefined;
  const controls = flags.controls ? readJsonObjectInput(flags, 'controls') : undefined;
  const cost = flags.cost ? readJsonObjectInput(flags, 'cost') : undefined;
  const methods = flags.methods ? readJsonObjectInput(flags, 'methods') : undefined;
  for (const [name, value] of Object.entries({ coverage, winners, controls, cost, methods })) {
    if (value !== undefined) assertTenantMarkers(value, clientId, name);
  }
  let markdown;
  try {
    markdown = renderReport({ coverage, winners, controls, cost, methods });
  } catch (err) {
    if (err instanceof ReportError) throw err;
    throw err;
  }
  writeTextAtomic(outPath, `# Content Evidence Report — ${clientId}\n\n${markdown}\n`);
  stdout(`report written for ${clientId}: ${outPath}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Argument / path handling
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function requireClient(flags) {
  const clientId = flags.client;
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    fail('RUN_MISSING_CLIENT', '--client is required; there is no default tenant');
  }
  if (!REGISTERED_CLIENTS.includes(clientId)) {
    fail('RUN_UNKNOWN_CLIENT', `--client ${JSON.stringify(clientId)} is not one of ${REGISTERED_CLIENTS.join(', ')}`);
  }
  return clientId;
}

/**
 * `--out` resolves against `--out-root` when relative (this repo's own root-relative convention),
 * or is used as-is when absolute. Either way, the result MUST resolve inside `--out-root`; a path
 * that escapes it (via `../` or an absolute path elsewhere) is refused before anything is written.
 *
 * Symlink-safe (Sol review MF-1, fixed here): a LEXICAL path.resolve comparison alone accepts a
 * symlink that lives inside --out-root but points somewhere else -- the write then lands outside
 * OUT while this function reports success. The containment check instead realpaths the longest
 * EXISTING prefix of both the resolved --out path and --out-root (an ancestor symlink, e.g. macOS
 * /tmp -> /private/tmp, is followed transparently and still counts as contained -- see
 * collect.mjs's realpathOfLongestExistingPrefix, reused here so both files share one definition of
 * "inside"), and separately refuses outright when the exact resolved --out path already exists as
 * a symlink, whichever direction it points, since trusting that link would leave a TOCTOU window
 * between this check and the write that follows it.
 */
function resolveOutPath(flags) {
  const outRoot = flags['out-root'];
  const out = flags.out;
  if (typeof outRoot !== 'string' || outRoot.trim() === '') {
    fail('RUN_MISSING_OUT_ROOT', '--out-root is required');
  }
  if (typeof out !== 'string' || out.trim() === '') {
    fail('RUN_MISSING_OUT', '--out is required');
  }
  const resolvedRoot = path.resolve(outRoot);
  const resolvedOut = path.isAbsolute(out) ? path.resolve(out) : path.resolve(resolvedRoot, out);

  if (isSymlinkPath(resolvedOut)) {
    fail('RUN_OUT_IS_SYMLINK',
      `--out ${JSON.stringify(out)} resolves to ${resolvedOut}, which already exists as a symlink; refusing to write through it`);
  }

  const realRoot = realpathOfLongestExistingPrefix(resolvedRoot);
  const realOut = realpathOfLongestExistingPrefix(resolvedOut);
  const inside = realOut === realRoot || realOut.startsWith(realRoot + path.sep);
  if (!inside) {
    fail('RUN_OUT_OUTSIDE_ROOT',
      `--out ${JSON.stringify(out)} resolves (via realpath) to ${realOut}, which is outside --out-root ${resolvedRoot} (real: ${realRoot})`);
  }
  return resolvedOut;
}

function readJsonInput(flags, flagName) {
  const value = flags[flagName];
  if (typeof value !== 'string' || value.trim() === '') {
    fail('RUN_MISSING_INPUT', `--${flagName} is required (a path to a JSON file)`);
  }
  if (!existsSync(value)) {
    fail('RUN_INPUT_NOT_FOUND', `--${flagName} file not found: ${value}`);
  }
  const parsed = parseJsonFile(value, flagName);
  if (!Array.isArray(parsed)) {
    fail('RUN_BAD_INPUT', `--${flagName} must contain a JSON array`);
  }
  return parsed;
}

function readJsonObjectInput(flags, flagName) {
  const value = flags[flagName];
  if (typeof value !== 'string' || value.trim() === '') {
    fail('RUN_MISSING_INPUT', `--${flagName} is required (a path to a JSON file)`);
  }
  if (!existsSync(value)) {
    fail('RUN_INPUT_NOT_FOUND', `--${flagName} file not found: ${value}`);
  }
  const parsed = parseJsonFile(value, flagName);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('RUN_BAD_INPUT', `--${flagName} must contain a JSON object`);
  }
  return parsed;
}

function parseJsonFile(filePath, flagName) {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail('RUN_BAD_INPUT', `--${flagName} file ${filePath} is not valid JSON: ${err.message}`);
    return undefined; // unreachable
  }
}

function writeJsonAtomic(outPath, data) {
  writeTextAtomic(outPath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeTextAtomic(outPath, text) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, outPath);
}

// ---------------------------------------------------------------------------
// inventory helper
// ---------------------------------------------------------------------------

function summarizeRecords(clientId, records) {
  const posts = new Set();
  const authors = new Set();
  const dates = [];
  for (const r of records) {
    if (typeof r.post_id === 'string') posts.add(r.post_id);
    if (typeof r.author_id === 'string') authors.add(r.author_id);
    if (typeof r.published_at === 'string' && r.published_at !== '') dates.push(r.published_at);
  }
  dates.sort();
  return {
    clientId,
    recordCount: records.length,
    distinctPosts: posts.size,
    distinctAuthors: authors.size,
    dateSpan: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
  };
}

function requireArrayTenant(rows, clientId, flagName) {
  for (const [index, row] of rows.entries()) {
    if (!row || row.client_id !== clientId) {
      fail('RUN_TENANT_MISMATCH', `--${flagName} row ${index} must carry client_id ${JSON.stringify(clientId)}`);
    }
  }
}

function requireOptionalArrayTenant(rows, clientId, flagName) {
  for (const [index, row] of rows.entries()) {
    if (row && row.client_id !== undefined && row.client_id !== null && row.client_id !== clientId) {
      fail('RUN_TENANT_MISMATCH', `--${flagName} row ${index} belongs to another tenant`);
    }
  }
}

function assertTenantMarkers(value, clientId, flagName) {
  if (Array.isArray(value)) return value.forEach((row) => assertTenantMarkers(row, clientId, flagName));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'client_id' || key === 'clientId') && child !== clientId) {
      fail('RUN_TENANT_MISMATCH', `--${flagName} contains ${key} for another tenant`);
    }
    assertTenantMarkers(child, clientId, flagName);
  }
}

// ---------------------------------------------------------------------------
// Script entry point
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMain) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}
