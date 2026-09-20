// Tests for release/steps.mjs, release.mjs and rollback.mjs. Nothing here opens a connection.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS, CLIENTS, REQUIRED_STEP_FIELDS, validateSteps, rollbackOrder,
  WORKFLOW_ID, WORKFLOW_CRON, PROMPT_ROW_ID, PROMPT_SLUG, ROLLOUT_KEY, STUDY_IDS,
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

test('there is one import step and one rollout step per client', () => {
  for (const c of CLIENTS) {
    assert.ok(STEPS.some((s) => s.id === `S3-import-${c}`));
    assert.ok(STEPS.some((s) => s.id === `S7-rollout-${c}`));
  }
});

test('the schema steps run before the imports that need them', () => {
  const at = (id) => STEPS.findIndex((s) => s.id === id);
  assert.ok(at('S1-db-103') < at('S3-import-ivan'));
  assert.ok(at('S2-db-104') < at('S8-ui'));
  assert.ok(at('S3-import-arch') < at('S7-rollout-ivan'));
  assert.ok(at('S5-workflow') < at('S9-shortlist'));
});

test('the workflow step keeps the existing schedule and adds no trigger', () => {
  const s = STEPS.find((x) => x.id === 'S5-workflow');
  assert.ok(s.identity.includes(WORKFLOW_ID));
  assert.ok(s.identity.includes(WORKFLOW_CRON));
  assert.ok(/no trigger is added and no cron is changed/.test(s.guard));
  assert.ok(/schedule_before must equal schedule_after/.test(s.readback));
  assert.ok(/n8nac pull/.test(s.before) && /n8nac push/.test(s.apply) && /--verify/.test(s.apply));
});

test('the prompt step names the exact row and plans no write', () => {
  const s = STEPS.find((x) => x.id === 'S4-prompt');
  assert.ok(s.identity.includes(PROMPT_ROW_ID));
  assert.ok(s.identity.includes(PROMPT_SLUG));
  assert.ok(/NO WRITE IS PLANNED/.test(s.apply));
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
