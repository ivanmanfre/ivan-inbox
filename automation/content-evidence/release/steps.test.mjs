// Tests for release/steps.mjs, release.mjs and rollback.mjs. Nothing here opens a connection.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS, CLIENTS, ENABLED_CLIENT_PROPOSAL, ROOT_FILES_TOUCHED, REQUIRED_STEP_FIELDS,
  validateSteps, rollbackOrder,
  WORKFLOW_ID, WORKFLOW_CRON, PROMPT_ROW_ID, PROMPT_SLUG, PROMPT_BODY_SHA256_AT_DISCOVERY,
  ROLLOUT_KEY, STUDY_IDS,
} from './steps.mjs';
import { main as releaseMain } from './release.mjs';
import { main as rollbackMain, FASTEST_ROLLBACK } from './rollback.mjs';

function capture() {
  const lines = [];
  const errors = [];
  return { io: { log: (s) => lines.push(String(s)), error: (s) => errors.push(String(s)) }, lines, errors };
}

test('every step carries all six release fields', () => {
  assert.deepEqual(validateSteps(), []);
  for (const s of STEPS) {
    for (const f of REQUIRED_STEP_FIELDS) assert.ok(s[f], `${s.id} missing ${f}`);
  }
});

test('there is one import step per client, but rollout and shortlist only for enabled clients', () => {
  for (const c of CLIENTS) assert.ok(STEPS.some((s) => s.id === `S3-import-${c}`));
  for (const c of ENABLED_CLIENT_PROPOSAL) {
    assert.ok(STEPS.some((s) => s.id === `S7-rollout-${c}`));
    assert.ok(STEPS.some((s) => s.id === `S9-shortlist-${c}`));
  }
  // arch is imported and shown, and is never enabled or committed on the evidence path.
  assert.ok(!ENABLED_CLIENT_PROPOSAL.includes('arch'));
  assert.ok(!STEPS.some((s) => s.id === 'S7-rollout-arch'));
  assert.ok(!STEPS.some((s) => s.id === 'S9-shortlist-arch'));
});

test('every root file this release touches is byte-copied before anything is edited', () => {
  const s0 = STEPS[0];
  assert.equal(s0.id, 'S0-before-copies');
  for (const f of ROOT_FILES_TOUCHED) {
    assert.ok(s0.identity.includes(f) || s0.before.includes(f) || s0.apply.includes(f), f);
  }
  assert.ok(/refusing to overwrite/.test(s0.before));
  assert.ok(/guarded on EXISTENCE/.test(s0.guard));
  assert.ok(s0.rollback.startsWith('cp '), 'a rollback must restore bytes, never a hash');
  const s6 = STEPS.find((x) => x.id === 'S6-source-sync');
  assert.ok(s6.rollback.includes('RELEASE-RECEIPTS/before/'));
  assert.ok(!/from the worktree/.test(s6.guard + s6.apply));
  assert.ok(/copied from nowhere/.test(s6.guard));
});

test('the order puts every prerequisite before the step that needs it', () => {
  const at = (id) => STEPS.findIndex((s) => s.id === id);
  assert.ok(at('S0-before-copies') < at('S4-prompt'));   // release.py prompt reads the root prompt.md
  assert.ok(at('S0-before-copies') < at('S5-workflow')); // release.py prepare reads the root writer.js
  assert.ok(at('S1-db-103') < at('S3-import-ivan'));
  assert.ok(at('S2-db-104') < at('S8-ui'));
  assert.ok(at('S3-import-arch') < at('S7-rollout-ivan'));
  assert.ok(at('S4-prompt') < at('S7-rollout-ivan'));    // v5 knows nothing of the evidence path
  assert.ok(at('S5-workflow') < at('S9-shortlist-ivan'));
});

test('the workflow step keeps the existing schedule and adds no trigger', () => {
  const s = STEPS.find((x) => x.id === 'S5-workflow');
  assert.ok(s.identity.includes(WORKFLOW_ID));
  assert.ok(s.identity.includes(WORKFLOW_CRON));
  assert.ok(/no trigger is added, none is removed, and no cron is changed/.test(s.guard));
  assert.ok(/schedule_before must equal schedule_after/.test(s.readback));
});

test('the workflow step follows the n8n protocol in full', () => {
  const s = STEPS.find((x) => x.id === 'S5-workflow');
  const text = [s.before, s.guard, s.apply, s.readback].join('\n');
  for (const required of [
    'n8nac-config.json', 'n8nac instance list --json', 'n8nac list', 'n8nac pull',
    '<workflow-map>', 'skills validate', 'n8nac push', '--verify', 'n8nac verify',
    'test-plan', 'workflow deactivate', 'workflow activate',
  ]) assert.ok(text.includes(required), 'S5 must carry ' + required);
});

test('the pinned test body is a preview and names exactly one client', () => {
  const s = STEPS.find((x) => x.id === 'S5-workflow');
  assert.ok(s.apply.includes('{"preview":true,"evidence":true,"client_id":"ivan","week_start":"2026-09-28"}'));
  assert.ok(/PREVIEW:TRUE IS NOT OPTIONAL/.test(s.apply));
  assert.ok(/live committing run/.test(s.apply));
});

test('the active version is proven rather than assumed', () => {
  const s = STEPS.find((x) => x.id === 'S5-workflow');
  assert.ok(/AFTER the deactivate\/activate cycle/.test(s.readback));
  assert.ok(!/there is no activate or deactivate call/.test([s.apply, s.readback, s.rollback].join('\n')));
});

test('the prompt step plans the write by the table own existing convention', () => {
  const s = STEPS.find((x) => x.id === 'S4-prompt');
  assert.ok(s.identity.includes(PROMPT_ROW_ID));
  assert.ok(s.identity.includes(PROMPT_SLUG));
  assert.ok(!/NO WRITE IS PLANNED/.test(s.apply));
  assert.ok(/release\.py prompt/.test(s.apply));
  assert.ok(/IN-PLACE body/.test(s.apply) && /version=version\+1/.test(s.apply));
  assert.ok(/no new-row plus/.test(s.apply), 'the plan must say which convention this table uses');
});

test('the prompt step compares sha and version before writing, and restores the saved v5 body', () => {
  const s = STEPS.find((x) => x.id === 'S4-prompt');
  assert.ok(s.guard.includes(PROMPT_BODY_SHA256_AT_DISCOVERY));
  assert.ok(/version 5/.test(s.guard));
  assert.ok(/Prompt drift; no update applied/.test(s.guard));
  assert.ok(/prompt-before-v5\.json/.test(s.before));
  assert.ok(s.rollback.includes(PROMPT_BODY_SHA256_AT_DISCOVERY));
  assert.ok(/prompt-before-v5\.json/.test(s.rollback));
});

test('the prompt step states with line references that a legacy run behaves exactly as v5', () => {
  const s = STEPS.find((x) => x.id === 'S4-prompt');
  assert.ok(/prompt\.md:37/.test(s.apply));
  assert.ok(/prompt\.md:45/.test(s.apply));
  assert.ok(/exactly as before/.test(s.apply));
});

test('the shortlist step is one preview per enabled client, behind the guard', () => {
  for (const c of ENABLED_CLIENT_PROPOSAL) {
    const s = STEPS.find((x) => x.id === `S9-shortlist-${c}`);
    assert.ok(s.before.includes(`"client_id":"${c}"`));
    assert.ok(s.before.includes('"preview":true'));
    assert.ok(/commit-guard\.mjs/.test(s.guard) && /commit-guard\.mjs/.test(s.apply));
    assert.ok(/--enabled \$OUT\/ENABLED-CLIENTS\.json/.test(s.apply));
    assert.ok(/commit-reviewed\.py unchanged/.test(s.apply));
    assert.ok(/"already":true/.test(s.readback));
  }
});

test('every import step is scoped to one tenant and one study id', () => {
  for (const c of CLIENTS) {
    const s = STEPS.find((x) => x.id === `S3-import-${c}`);
    assert.ok(s.rollback.includes(`client_id = '${c}'`));
    assert.ok(s.rollback.includes(STUDY_IDS[c]));
    for (const other of CLIENTS.filter((o) => o !== c)) {
      assert.ok(!s.rollback.includes(`client_id = '${other}'`), `${c} rollback must not touch ${other}`);
    }
  }
});

test('the rollout switch defaults to nobody and rolls back in one statement', () => {
  const s = STEPS.find((x) => x.id === 'S7-rollout-ivan');
  assert.ok(s.identity.includes(ROLLOUT_KEY));
  assert.ok(s.rollback.includes("set value = '[]'"));
  assert.ok(FASTEST_ROLLBACK.includes(ROLLOUT_KEY));
  assert.ok(FASTEST_ROLLBACK.includes("'[]'"));
});

test('rollback order is the reverse of release order', () => {
  assert.deepEqual(rollbackOrder().map((s) => s.id), [...STEPS].map((s) => s.id).reverse());
});

test('no rollback step deletes a decision row', () => {
  for (const s of STEPS) {
    assert.ok(!/delete from public\.ops_drafts/i.test(s.rollback), `${s.id} must not delete a decision`);
  }
});

test('the release tool prints every step and executes nothing', () => {
  const c = capture();
  assert.equal(releaseMain([], c.io), 0);
  assert.equal(c.errors.length, 0);
  const text = c.lines.join('\n');
  for (const s of STEPS) assert.ok(text.includes(s.id));
  assert.ok(/executes nothing/.test(text));
});

test('the release tool can print one step and refuses an unknown one', () => {
  const one = capture();
  assert.equal(releaseMain(['--step', 'S5-workflow'], one.io), 0);
  assert.ok(one.lines.join('\n').includes('S5-workflow'));
  assert.ok(!one.lines.join('\n').includes('S1-db-103'));
  const bad = capture();
  assert.equal(releaseMain(['--step', 'S99'], bad.io), 2);
});

test('the release tool emits machine readable steps', () => {
  const c = capture();
  assert.equal(releaseMain(['--json'], c.io), 0);
  const parsed = JSON.parse(c.lines.join('\n'));
  assert.equal(parsed.length, STEPS.length);
});

test('the rollback tool leads with the one statement that loses nothing', () => {
  const c = capture();
  assert.equal(rollbackMain([], c.io), 0);
  const text = c.lines.join('\n');
  assert.ok(text.indexOf(FASTEST_ROLLBACK) < text.indexOf('Full rollback'));
  assert.ok(/Preserved by every step/.test(text));
});
