#!/usr/bin/env node
// content-evidence / release / rollback.mjs
//
// Prints the rollback, in reverse release order, and says for each step what it preserves.
//
// IT EXECUTES NOTHING, for the same reason release.mjs does not.
//
// THE RULE THIS TOOL EXISTS TO STATE
//
//   A rollback restores the previous reader and the previous selector. It does NOT drop stored
//   evidence and it does NOT lose a decision. The nine preserved week-2026-09-21 rows, every
//   imported study row, every approval and every operator reason survive every step below.
//
//   The fastest and safest rollback is one statement:
//
//       update public.integration_config set value = '[]'
//        where key = 'weekly_evidence_selector_clients';
//
//   That returns every client to the legacy path with no schema change, no deploy and no data
//   loss. Everything further down this list is only needed when the schema or the deployed build
//   itself has to go back.
//
//   node automation/content-evidence/release/rollback.mjs
//   node automation/content-evidence/release/rollback.mjs --json

import { rollbackOrder, validateSteps, ROLLOUT_KEY } from './steps.mjs';

export const FASTEST_ROLLBACK =
  `update public.integration_config set value = '[]' where key = '${ROLLOUT_KEY}';`;

export function main(argv, io = console) {
  const json = argv.includes('--json');
  const problems = validateSteps();
  if (problems.length) {
    io.error('the release step list is incomplete:\n  ' + problems.join('\n  '));
    return 1;
  }
  const order = rollbackOrder();

  if (json) {
    io.log(JSON.stringify({
      fastest: FASTEST_ROLLBACK,
      order: order.map((s) => ({ id: s.id, rollback: s.rollback, note: s.rollback_note ?? null })),
    }, null, 2));
    return 0;
  }

  io.log('This tool executes nothing.\n');
  io.log('Fastest rollback, no schema change and no data loss:');
  io.log('  ' + FASTEST_ROLLBACK + '\n');
  io.log('Full rollback, in reverse release order:\n');
  for (const s of order) {
    io.log(`${s.id}  ${s.title}`);
    io.log(`  ${String(s.rollback).split('\n').join('\n  ')}`);
    if (s.rollback_note) io.log(`  note: ${s.rollback_note}`);
    io.log('');
  }
  io.log('Preserved by every step above: the nine week-2026-09-21 rows and their ids, every');
  io.log('imported study row, every approval, every operator reason, and the raw corpus files.');
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('rollback.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
