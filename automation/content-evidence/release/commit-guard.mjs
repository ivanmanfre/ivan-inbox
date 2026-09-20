#!/usr/bin/env node
// content-evidence / release / commit-guard.mjs
//
// The rollout switch in front of the SAVE, not just in front of the writer.
//
// WHY THIS EXISTS (pre-release audit F2)
//
// `tools/weekly-topics/commit-reviewed.py` commits every client in the preview summary and has
// no rollout check of its own. A webhook preview carrying `evidence: true` and NO `client_id`
// covers every registry client, so committing that one file would save evidence-path rows for a
// client the review did not clear. The writer's own `commitGuard` cannot catch it either: that
// guard runs inside the writer's live path, and a preview never reaches it.
//
// So this tool sits between the reviewed preview file and the existing commit route. It edits
// nothing in `tools/weekly-topics/` and reimplements no commit logic: it reads the preview,
// refuses or allows, and on `--apply` runs the existing tool unchanged.
//
// WHAT IT REFUSES
//
//   1. a preview that is not a preview (`summary.preview` not literally true)
//   2. any row carrying `evidence_package` whose client is not in the reviewed enabled list
//   3. an evidence preview covering more than one client, because S9 is one preview per enabled
//      client with an explicit `client_id`; a multi-client evidence file is exactly the shape
//      the audit found dangerous
//   4. a row whose `client_id` does not match the client block it sits in
//   5. an incomplete client block (writer bail, skipped, or no rows), the same condition the
//      existing tool refuses on, checked here first so the refusal names the client
//
// A refusal is an exit code and a printed reason. It never edits the preview to make it pass.
//
//   node automation/content-evidence/release/commit-guard.mjs \
//     --preview <preview.json> --enabled $OUT/ENABLED-CLIENTS.json          # check only
//
//   node automation/content-evidence/release/commit-guard.mjs \
//     --preview <preview.json> --enabled $OUT/ENABLED-CLIENTS.json \
//     --output $OUT/RELEASE-RECEIPTS/first-shortlist-<client>.json --apply  # check, then commit

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

export class CommitGuardError extends Error {
  constructor(code, message) { super(message); this.name = 'CommitGuardError'; this.code = code; }
}

/**
 * Pure. Returns every reason this preview may not be committed, in reading order.
 *
 * @param {object} preview        the preview file's parsed contents (or its `response` wrapper)
 * @param {string[]} enabled      the reviewed enabled client ids
 * @returns {{ allowed: boolean, problems: string[], evidenceClients: string[], clients: string[] }}
 */
export function checkPreview(preview, enabled) {
  const problems = [];
  if (!Array.isArray(enabled)) {
    return { allowed: false, problems: ['the enabled client list is not a JSON array'], evidenceClients: [], clients: [] };
  }
  const enabledSet = new Set(enabled);
  const summary = (preview && preview.response) ? preview.response : preview;
  if (!summary || typeof summary !== 'object') {
    return { allowed: false, problems: ['the preview file is not an object'], evidenceClients: [], clients: [] };
  }
  if (summary.preview !== true) {
    problems.push('the file is not a native preview (summary.preview is not literally true); a body without preview:true is a live committing run');
  }
  const clientBlocks = Array.isArray(summary.clients) ? summary.clients : [];
  if (clientBlocks.length === 0) problems.push('the preview carries no client block');

  const clients = [];
  const evidenceClients = new Set();

  for (const block of clientBlocks) {
    const cid = block && block.client_id;
    if (typeof cid !== 'string' || cid.trim() === '') {
      problems.push('a client block carries no client_id');
      continue;
    }
    clients.push(cid);
    if (block.writer_bail || block.skipped || !Array.isArray(block.rows)) {
      problems.push(`client ${cid} has an incomplete block (writer bail, skipped, or no rows); resolve it before committing`);
      continue;
    }
    for (const row of block.rows) {
      if (row.client_id !== cid) {
        problems.push(`client ${cid} carries a row stamped ${JSON.stringify(row.client_id)}`);
      }
      const pkg = row?.context?.evidence_package ?? row?.context?.audn?.evidence_package ?? null;
      if (pkg) {
        evidenceClients.add(cid);
        if (!enabledSet.has(cid)) {
          problems.push(`client ${cid} carries an evidence package but is not in the reviewed enabled list [${enabled.join(', ')}]`);
        }
      }
    }
  }

  // S9 is one preview per enabled client with an explicit client_id. An evidence preview that
  // covers several clients at once is the exact file the audit found dangerous, so it is refused
  // even when every client in it happens to be enabled.
  if (evidenceClients.size > 0 && clients.length > 1) {
    problems.push(`an evidence preview must cover exactly one client; this one covers ${clients.length} (${clients.join(', ')}). Re-run the preview with an explicit client_id.`);
  }

  return {
    allowed: problems.length === 0,
    problems,
    evidenceClients: [...evidenceClients].sort(),
    clients,
  };
}

const USAGE = `usage: node automation/content-evidence/release/commit-guard.mjs \\
    --preview <preview.json> --enabled <ENABLED-CLIENTS.json> \\
    [--output <receipt.json>] [--apply] [--commit-tool <commit-reviewed.py>]

  Without --apply this checks and prints only. With --apply it runs the existing
  tools/weekly-topics/commit-reviewed.py unchanged, and only after the check passes.`;

export function main(argv, io = console, runner = defaultRunner) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  }
  if (args.help) { io.log(USAGE); return 0; }
  for (const required of ['preview', 'enabled']) {
    if (!args[required]) { io.error(`missing --${required}\n\n${USAGE}`); return 2; }
  }

  let preview;
  let enabled;
  try {
    preview = JSON.parse(readFileSync(args.preview, 'utf8'));
    enabled = JSON.parse(readFileSync(args.enabled, 'utf8'));
  } catch (error) {
    io.error('could not read the preview or the enabled list: ' + error.message);
    return 1;
  }

  const verdict = checkPreview(preview, enabled);
  io.log(JSON.stringify({
    allowed: verdict.allowed,
    clients: verdict.clients,
    evidence_clients: verdict.evidenceClients,
    enabled,
    problems: verdict.problems,
  }, null, 2));

  if (!verdict.allowed) {
    io.error('REFUSED: this preview may not be committed.');
    return 1;
  }
  if (!args.apply) {
    io.log('check only. Nothing was committed. Re-run with --apply --output <receipt> to commit through the existing route.');
    return 0;
  }
  if (!args.output) { io.error('--apply requires --output'); return 2; }

  const tool = args['commit-tool']
    ?? path.resolve(REPO_ROOT, '..', 'tools/weekly-topics/commit-reviewed.py');
  const result = runner('python3', [tool, '--preview', args.preview, '--output', args.output]);
  if (result.stdout) io.log(String(result.stdout).trim());
  if (result.stderr) io.error(String(result.stderr).trim());
  return result.status === 0 ? 0 : 1;
}

function defaultRunner(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
}

if (process.argv[1] && process.argv[1].endsWith('commit-guard.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
