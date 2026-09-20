// content-evidence / release / steps.mjs
//
// The ordered live release, as data. One object per step, each carrying the same six fields:
// native identity, before-snapshot, compare-before-write guard, apply, readback, rollback.
//
// This file performs nothing. It exists so the written release plan and the two CLIs over it
// (release.mjs, rollback.mjs) cannot drift from each other: the plan is generated from here, the
// dry run prints from here, and the rollback walks the same list backwards.
//
// EVERY IDENTITY BELOW WAS DISCOVERED READ-ONLY (OUT/PHASE-0-SURFACES.md) AND BOUND TO THE GRANT
// IN OUT/AUTHORITY.md. Anything not on this list is outside the grant and outside this release.
//
// `$OUT`, `$RUN2`, `$WORKTREE` and `$REPO` are the run's own paths and are substituted by the
// caller; no path here reaches outside them.

export const CLIENTS = Object.freeze(['ivan', 'risedtc', 'arch']);

export const WORKFLOW_ID = 'UGKZGBBM9332apHo';
export const WORKFLOW_NAME = 'Audience Review - Recommendation Writer';
export const WORKFLOW_FILE = 'workflows/default/audn-recommendation-writer.workflow.ts';
export const WORKFLOW_CRON = '0 5 * * 1';
export const PROMPT_SLUG = 'audn-recommendation-writer';
export const PROMPT_ROW_ID = 'd429f9b0-527c-42ac-bae2-2345d4a51db5';
export const PROMPT_VERSION_AT_DISCOVERY = 5;
export const PROMPT_BODY_SHA256_AT_DISCOVERY =
  '1cfa55b1e5bf4535cfaf378601d2ee01a1d99648e48ad53e09255128648fcfe0';
export const WRITER_JS_SHA256_AT_DISCOVERY =
  'e92043731046b51d9b1d46d7bea652a845e6cef911f6fece0d6b19c4cc259ae3';
export const ROLLOUT_KEY = 'weekly_evidence_selector_clients';
export const STUDY_IDS = Object.freeze({
  ivan: 'content-evidence-repair-2026-09-20-ivan',
  risedtc: 'content-evidence-repair-2026-09-20-risedtc',
  arch: 'content-evidence-repair-2026-09-20-arch',
});

const step = (s) => Object.freeze(s);

export const STEPS = Object.freeze([
  step({
    id: 'S1-db-103',
    title: 'Apply db/103_content_evidence.sql',
    identity: 'Supabase project bjbvqvzbzczjbatgmccb; tables client_research_studies, client_research_study_posts, client_research_findings; function content_evidence_pack(text, date)',
    before: "sbq-ro: select to_regclass('public.client_research_studies') as t1, to_regclass('public.client_research_study_posts') as t2, to_regclass('public.client_research_findings') as t3, to_regprocedure('public.content_evidence_pack(text,date)') as f1",
    guard: 'all four must read null. A non-null value means 103 is already applied: stop and compare definitions instead of re-applying.',
    apply: 'tools/client-research/sbq.sh $WORKTREE/db/103_content_evidence.sql',
    readback: "sbq-ro: the same four regclass/regprocedure reads, now all non-null, plus select count(*) from public.client_research_studies (expect 0)",
    rollback: 'drop function if exists public.content_evidence_pack(text, date); drop table if exists public.client_research_findings; drop table if exists public.client_research_study_posts; drop table if exists public.client_research_studies;',
    rollback_note: 'safe only while the tables are empty. After S3 to S5 the rollback is S3R (delete the imported rows) and the tables stay.',
  }),
  step({
    id: 'S2-db-104',
    title: 'Apply db/104_operator_content_evidence.sql',
    identity: 'function operator_content_evidence(text, text); one row in public.integration_config, key ' + ROLLOUT_KEY,
    before: "sbq-ro: select to_regprocedure('public.operator_content_evidence(text,text)') as f, (select count(*) from public.integration_config where key = '" + ROLLOUT_KEY + "') as k",
    guard: 'f must read null and k must read 0. The migration inserts the switch row only when absent, so a k of 1 means it is already there and its value must be read before anything is applied.',
    apply: 'tools/client-research/sbq.sh $WORKTREE/db/104_operator_content_evidence.sql',
    readback: "sbq-ro: select value from public.integration_config where key = '" + ROLLOUT_KEY + "' (expect []), and has_function_privilege('anon', 'public.operator_content_evidence(text, text)', 'execute') (expect false), has_function_privilege('authenticated', ...) (expect true)",
    rollback: "drop function if exists public.operator_content_evidence(text, text); delete from public.integration_config where key = '" + ROLLOUT_KEY + "';",
    rollback_note: 'dropping the reader hides the evidence views and restores the previous Strategy surface. It drops no evidence row and no decision.',
  }),
  ...CLIENTS.map((client) => step({
    id: `S3-import-${client}`,
    title: `Import the ${client} methods-v2 market study`,
    identity: `client_research_studies (${client}, ${STUDY_IDS[client]}) plus its posts and findings`,
    before: `sbq-ro: select count(*) from public.client_research_study_posts where client_id = '${client}'; select count(*) from public.client_research_findings where client_id = '${client}'`,
    guard: 'both counts must be 0 on a first import. A non-zero count means a previous import exists: run the dry run and compare its hashes to content_sha256 on the stored study before applying, because the upsert would overwrite.',
    apply: [
      `node $WORKTREE/automation/content-evidence/release/import-studies.mjs --client ${client}`,
      `  --study $RUN2/repair-round-2/studies/${client}.json`,
      `  --posts $RUN2/analysis/work/data/${client}-posts.json`,
      '  --apply --out $OUT/RELEASE-RECEIPTS/sql    (writes the transaction; $OUT is outside the repo)',
      `then: tools/client-research/sbq.sh $OUT/RELEASE-RECEIPTS/sql/import-${client}.sql`,
    ].join('\n'),
    readback: `sbq-ro: select state, content_sha256 from public.client_research_studies where client_id = '${client}'; counts of posts by population and of findings, compared to the dry run's printed counts`,
    rollback: `delete from public.client_research_findings where client_id = '${client}' and study_id = '${STUDY_IDS[client]}'; delete from public.client_research_study_posts where client_id = '${client}' and study_id = '${STUDY_IDS[client]}'; delete from public.client_research_studies where client_id = '${client}' and study_id = '${STUDY_IDS[client]}';`,
    rollback_note: 'scoped to this exact tenant and study id. It removes nothing another client owns and nothing a previous study wrote.',
  })),
  step({
    id: 'S4-prompt',
    title: 'The recommendation prompt row',
    identity: `public.content_prompts id ${PROMPT_ROW_ID}, slug ${PROMPT_SLUG}, version ${PROMPT_VERSION_AT_DISCOVERY} at discovery, body sha256 ${PROMPT_BODY_SHA256_AT_DISCOVERY}`,
    before: `sbq-ro: select id, version, is_active, updated_at, encode(digest(body,'sha256'),'hex') as sha from public.content_prompts where id = '${PROMPT_ROW_ID}'`,
    guard: `sha must equal ${PROMPT_BODY_SHA256_AT_DISCOVERY} and version must equal ${PROMPT_VERSION_AT_DISCOVERY}. A different value means the row moved after Phase 0 read it: stop and re-review before any write.`,
    apply: 'NO WRITE IS PLANNED. The evidence path changes the writer code, not the rubric. This step exists to prove the row was read, compared and left alone; if a later review decides a prompt change is needed, it is a new version through tools/weekly-topics/sql/deploy.py and a new receipt.',
    readback: 'the same select. prompt_before_sha256 must equal prompt_after_sha256 in $OUT/RELEASE-RECEIPTS/workflow.json.',
    rollback: 'none required while no write is made. If a version is ever deployed, the rollback is re-activating the prior version row by id.',
  }),
  step({
    id: 'S5-workflow',
    title: 'The weekly writer workflow, through the full n8nac protocol',
    identity: `n8n ${WORKFLOW_ID} "${WORKFLOW_NAME}", local ${WORKFLOW_FILE}, Code node Write Recommendations, jsCode sha256 ${WRITER_JS_SHA256_AT_DISCOVERY} at discovery, schedule ${WORKFLOW_CRON}`,
    before: [
      'npx --yes n8nac list                       (confirm TRACKED, note archived state)',
      `npx --yes n8nac pull ${WORKFLOW_ID}        (pull before edit; the UI may have moved)`,
      'record: active state, trigger list, cron, jsCode sha256',
    ].join('\n'),
    guard: `the pulled jsCode sha256 must equal ${WRITER_JS_SHA256_AT_DISCOVERY}. A different value means someone edited the workflow in the n8n UI after Phase 0: resolve that drift first (keep-incoming, then re-patch) and never force-push over it. The two triggers must be exactly the existing Weekly Monday 05:00 (${WORKFLOW_CRON}) and Run Now Webhook; no trigger is added and no cron is changed.`,
    apply: [
      'edit the local .workflow.ts only, replacing the Write Recommendations jsCode with the generated writer.js',
      'npx --yes n8nac skills validate <workflowDir>/audn-recommendation-writer.workflow.ts',
      `npx --yes n8nac push <workflowDir>/audn-recommendation-writer.workflow.ts --verify`,
      `npx --yes n8nac verify ${WORKFLOW_ID}`,
    ].join('\n'),
    readback: [
      `read-only GET /api/v1/workflows/${WORKFLOW_ID}: jsCode sha256 must equal the local writer.js sha256`,
      'active must be true, exactly as it was before',
      `schedule_before must equal schedule_after (${WORKFLOW_CRON})`,
      'write $OUT/RELEASE-RECEIPTS/workflow.json with workflow_id, name, active, triggers, prompt_slug, prompt_row_id, prompt_before_sha256, prompt_after_sha256, local_source_sha256, schedule_before, schedule_after',
    ].join('\n'),
    rollback: `restore the pre-release jsCode (sha256 ${WRITER_JS_SHA256_AT_DISCOVERY}) into the local file and push again with --verify. The workflow never needs deactivating: with the rollout switch empty the evidence path is unreachable, so the byte-level rollback is a belt over the switch's braces.`,
  }),
  step({
    id: 'S6-source-sync',
    title: 'Deployment source copies and the identical-hash check',
    identity: 'tools/weekly-topics/writer.js, tools/weekly-topics/prompt.md, workflows/default/audn-recommendation-writer.workflow.ts at the workspace root',
    before: 'shasum -a 256 tools/weekly-topics/writer.js tools/weekly-topics/prompt.md workflows/default/audn-recommendation-writer.workflow.ts and the worktree equivalents',
    guard: 'the root writer.js, the worktree automation/weekly-topics/writer.js and the live jsCode were three-way identical at discovery. Do not leave two different writer implementations labelled current.',
    apply: 'copy the released writer.js and the released .workflow.ts from the worktree to the root deployment paths in the same change',
    readback: 'shasum -a 256 the three copies plus the live jsCode: all four must print one identical hash. Record it in $OUT/RELEASE-RECEIPTS/workflow.json as local_source_sha256.',
    rollback: 'restore all three root copies from the pre-release hash in the same single change.',
  }),
  ...CLIENTS.map((client) => step({
    id: `S7-rollout-${client}`,
    title: `Enable the evidence path for ${client}`,
    identity: `public.integration_config row ${ROLLOUT_KEY}`,
    before: `sbq-ro: select value from public.integration_config where key = '${ROLLOUT_KEY}'`,
    guard: `${client} must appear in $OUT/ENABLED-CLIENTS.json. A client the review did not clear stays out of the array and keeps the legacy path; it is never enabled to make a number look better.`,
    apply: `update public.integration_config set value = <the reviewed array, with ${client} added>, updated_at = now() where key = '${ROLLOUT_KEY}';`,
    readback: `sbq-ro: select value from public.integration_config where key = '${ROLLOUT_KEY}'; then operator_content_evidence for ${client} must list the weekly writer under connected_consumers`,
    rollback: `update public.integration_config set value = '[]' where key = '${ROLLOUT_KEY}';  -- one statement returns every client to the legacy path and loses no evidence and no decision`,
  })),
  step({
    id: 'S8-ui',
    title: 'Deploy the Strategy evidence views',
    identity: 'repo ivan-inbox, branch main, .github/workflows/deploy.yml (push to main, GitHub Pages), served build id __BUILD__',
    before: 'git rev-parse origin/main; open the live app Settings and record the served Build value',
    guard: 'origin/main must be the commit the review read. The deploy pipeline is the existing one; no new workflow file is added.',
    apply: 'merge the release branch into main and push. The existing Deploy action builds and publishes.',
    readback: 'the served Build value must equal the deployed commit short sha. Record deployed_commit, enabled_clients, config_keys and served_version in $OUT/RELEASE-RECEIPTS/release.json.',
    rollback: 'revert the merge commit on main and push. The existing action redeploys the previous build; no data is touched.',
  }),
  step({
    id: 'S9-shortlist',
    title: 'The first reviewed shortlist per enabled client',
    identity: 'the existing RPC public.audn_recommendation_commit(text, text, jsonb, integer, boolean); rows land in public.ops_drafts kind audn_recommendation with approved_at and sent_at null',
    before: "sbq-ro: select client_id, cycle_id, cardinality(proposal_ids) from public.audn_writer_cycles where cycle_id like 'weekly:%'; and the nine preserved week-2026-09-21 row ids",
    guard: 'run the native preview first (the header-authed Run Now Webhook, preview mode) and read every card before anything is committed. The cycle must be a week the RPC itself accepts today, see D7 in the release plan. The nine existing rows are never edited, approved or cleared to make room.',
    apply: 'python3 tools/weekly-topics/commit-reviewed.py --preview <preview.json> --output $OUT/RELEASE-RECEIPTS/first-shortlist.json',
    readback: 'the commit tool reads every written row back and refuses on any mismatch; additionally sbq-ro the row ids and confirm approved_at and sent_at are still null.',
    rollback: 'the weekly path is idempotent per (client_id, cycle_id): a replay returns already true and writes nothing. To withdraw a choice use the existing decision path (audn_weekly_recommendation_decide) with a reason; rows are never deleted to undo a commit.',
  }),
]);

/** Every step must carry the same six fields. A step that skips one is not releasable. */
export const REQUIRED_STEP_FIELDS = Object.freeze([
  'id', 'title', 'identity', 'before', 'guard', 'apply', 'readback', 'rollback',
]);

export function validateSteps(steps = STEPS) {
  const problems = [];
  const seen = new Set();
  for (const s of steps) {
    for (const f of REQUIRED_STEP_FIELDS) {
      if (typeof s[f] !== 'string' || s[f].trim() === '') problems.push(`${s.id ?? '(unnamed)'} is missing ${f}`);
    }
    if (seen.has(s.id)) problems.push(`duplicate step id ${s.id}`);
    seen.add(s.id);
  }
  return problems;
}

/** The rollback runs the list backwards: a later step is undone before the one it depends on. */
export function rollbackOrder(steps = STEPS) {
  return [...steps].reverse();
}
