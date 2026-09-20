#!/usr/bin/env node
// content-evidence / release / release.mjs
//
// Prints the ordered live release, one step at a time, with its before-snapshot, its
// compare-before-write guard, its apply command, its readback and its rollback.
//
// IT EXECUTES NOTHING. There is no --apply, no credential and no network client here, on purpose:
// every step in this release has a different executor (sbq.sh, n8nac, git push, a python commit
// tool), each with its own authorization, and a single script that drove all of them would be one
// typo away from a live write nobody reviewed. This prints what to run and what to check; a human
// or a later, separately authorized step runs it.
//
//   node automation/content-evidence/release/release.mjs            list every step
//   node automation/content-evidence/release/release.mjs --step S2  one step in full
//   node automation/content-evidence/release/release.mjs --json     machine readable

import { STEPS, validateSteps } from './steps.mjs';

export function main(argv, io = console) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  }

  const problems = validateSteps();
  if (problems.length) {
    io.error('the release step list is incomplete:\n  ' + problems.join('\n  '));
    return 1;
  }

  const steps = args.step
    ? STEPS.filter((s) => s.id === args.step || s.id.startsWith(args.step + '-') || s.id.split('-')[0] === args.step)
    : STEPS;
  if (steps.length === 0) { io.error(`no step matches ${JSON.stringify(args.step)}`); return 2; }

  if (args.json) { io.log(JSON.stringify(steps, null, 2)); return 0; }

  io.log('This tool executes nothing. Each step is run by its own executor, under its own authorization.\n');
  for (const s of steps) {
    io.log(`${s.id}  ${s.title}`);
    io.log(`  identity : ${indent(s.identity)}`);
    io.log(`  before   : ${indent(s.before)}`);
    io.log(`  guard    : ${indent(s.guard)}`);
    io.log(`  apply    : ${indent(s.apply)}`);
    io.log(`  readback : ${indent(s.readback)}`);
    io.log(`  rollback : ${indent(s.rollback)}`);
    if (s.rollback_note) io.log(`             ${indent(s.rollback_note)}`);
    io.log('');
  }
  return 0;
}

function indent(text) { return String(text).split('\n').join('\n             '); }

if (process.argv[1] && process.argv[1].endsWith('release.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
