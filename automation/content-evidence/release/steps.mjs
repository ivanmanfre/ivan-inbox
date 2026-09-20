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

/**
 * The reviewed-ready proposal, mirroring $OUT/ENABLED-CLIENTS.json. ARCH is deliberately absent:
 * 2 findings from 1 ranked author out of 314, which D3 named in advance as a coverage gap.
 * The rollout and shortlist steps are generated from THIS list, so an un-enabled client has no
 * shortlist step to run by accident.
 */
export const ENABLED_CLIENT_PROPOSAL = Object.freeze(['ivan', 'risedtc']);

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

/**
 * THE ROOT TREE HAS NO VERSION CONTROL. An overwrite there is permanent and there is no Time
 * Machine behind it, so every root file this release touches is byte-copied into
 * $OUT/RELEASE-RECEIPTS/before/ first, and the copy is guarded on EXISTENCE: an existing
 * before-copy is never overwritten, because the second copy would be of the already-edited file.
 */
export const ROOT_FILES_TOUCHED = Object.freeze([
  'tools/weekly-topics/writer.js',
  'tools/weekly-topics/prompt.md',
  'workflows/default/audn-recommendation-writer.workflow.ts',
]);

const step = (s) => Object.freeze(s);

export const STEPS = Object.freeze([
  step({
    id: 'S0-before-copies',
    title: 'Byte-copy every root file this release touches, then place the new deployment sources',
    identity: ROOT_FILES_TOUCHED.map((p) => '$REPO/' + p).join(', ')
      + '; plus the prompt row snapshot, saved as $OUT/RELEASE-RECEIPTS/before/prompt-before-v5.json',
    before: [
      'mkdir -p $OUT/RELEASE-RECEIPTS/before',
      'for f in ' + ROOT_FILES_TOUCHED.join(' ') + '; do',
      '  dest=$OUT/RELEASE-RECEIPTS/before/$(basename "$f")',
      '  [ -e "$dest" ] && { echo "refusing to overwrite $dest"; exit 1; }',
      '  cp -p "$REPO/$f" "$dest"',
      'done',
      'shasum -a 256 $OUT/RELEASE-RECEIPTS/before/*',
      'sbq-ro the full prompt row and save it to $OUT/RELEASE-RECEIPTS/before/prompt-before-v5.json',
    ].join('\n'),
    guard: 'the copy is guarded on EXISTENCE, never on mtime and never on a hash: an existing before-copy means a previous attempt already edited the root tree, and copying again would save the edited bytes as the "before". The root tree has no git and no Time Machine, so a lost original cannot be recovered.',
    apply: [
      'cp $WORKTREE/automation/weekly-topics/writer.js  $REPO/tools/weekly-topics/writer.js',
      'cp $WORKTREE/automation/weekly-topics/prompt.md  $REPO/tools/weekly-topics/prompt.md',
      '',
      'The third root file, workflows/default/audn-recommendation-writer.workflow.ts, is NOT copied',
      'from anywhere: no worktree tracks it. It is edited IN PLACE by tools/weekly-topics/release.py',
      'prepare (S5), which splices the new writer.js into its jsCode literal.',
    ].join('\n'),
    readback: 'shasum -a 256 the two copied root files against their worktree sources: identical. The before/ directory holds one copy of each of the three root files plus prompt-before-v5.json, and nothing in it has been overwritten.',
    rollback: 'cp $OUT/RELEASE-RECEIPTS/before/writer.js $REPO/tools/weekly-topics/writer.js; cp $OUT/RELEASE-RECEIPTS/before/prompt.md $REPO/tools/weekly-topics/prompt.md; cp $OUT/RELEASE-RECEIPTS/before/audn-recommendation-writer.workflow.ts $REPO/workflows/default/audn-recommendation-writer.workflow.ts',
    rollback_note: 'a real file copy, not a hash. A hash restores nothing, which is why the bytes are saved rather than fingerprinted.',
  }),
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
    title: 'Version the recommendation prompt row to v6',
    identity: `public.content_prompts id ${PROMPT_ROW_ID}, slug ${PROMPT_SLUG}, version ${PROMPT_VERSION_AT_DISCOVERY} at discovery, body sha256 ${PROMPT_BODY_SHA256_AT_DISCOVERY}`,
    before: [
      "sbq-ro: select id, slug, title, body, kind, variables, version, is_active, source_page,",
      `         updated_at, updated_by, category, scope from public.content_prompts where id = '${PROMPT_ROW_ID}'`,
      'save the whole row to $OUT/RELEASE-RECEIPTS/before/prompt-before-v5.json (guarded on existence)',
      'save the same bytes to $REPO/out/weekly-topics-2026-09-19/prompt-before-v5.json (new file, never overwritten)',
      'then write $REPO/out/weekly-topics-2026-09-19/prompt-before.json with that same v5 row, because',
      "release.py's prompt mode reads exactly that path; the v4 receipt it replaces is already preserved",
      'as prompt-before-v4.json, which is the convention the 09-19 release itself used (v2, v3, v4).',
    ].join('\n'),
    guard: `the saved row must carry version ${PROMPT_VERSION_AT_DISCOVERY} and body sha256 ${PROMPT_BODY_SHA256_AT_DISCOVERY} and is_active true. release.py enforces the same comparison inside the write itself: its UPDATE carries "where id=<id> and version=<old> and body=<old body> and is_active=true returning id,version,updated_at", so a row that moved matches zero rows and the tool raises "Prompt drift; no update applied" rather than writing.`,
    apply: [
      'python3 $REPO/tools/weekly-topics/release.py prompt',
      '',
      'This is the 09-19 release convention exactly, read from release.py:64-77: an IN-PLACE body',
      'update on the SAME row id with version=version+1, updated_at=now() and a stamped updated_by.',
      'content_prompts holds ONE row per slug and versions it in place; there is no new-row plus',
      'is_active flip for this slug, which prompt-before-v2/v3/v4.json confirm (one id, versions 2,',
      '3, 4, is_active true throughout). The body written is $REPO/tools/weekly-topics/prompt.md,',
      'which S0 placed from the reviewed worktree copy.',
      '',
      'ORDER: this runs AFTER S0 (the root prompt.md must already be the reviewed one) and BEFORE',
      'S7 and S9. On v5 the model never returns an evidence_candidate_key, so an evidence-path run',
      'would commit ordinary legacy rows with no package.',
      '',
      'A LEGACY RUN ON v6 BEHAVES EXACTLY AS ON v5. prompt.md:37 opens the new section with',
      '"Evidence-backed candidates (only when the input pack carries a non-empty `evidence_candidates`',
      'array)", and prompt.md:45 states "A choice with no `evidence_candidate_key` is validated',
      'exactly as before -- this section adds a citation path, it does not replace the existing',
      'evidence/competitor/founder rules above." prompt.md:52 keeps evidence_candidate_key optional',
      'and prompt.md:55 defaults it to null in the required object shape. With the rollout switch at',
      '[] no pack carries evidence_candidates, so the section is inert for every client.',
    ].join('\n'),
    readback: [
      'release.py prompt does its own readback and raises "Prompt readback mismatch" unless the',
      'stored body equals prompt.md and the stored version equals old version + 1. It prints',
      '{"deployed": true, "prompt": {id, version, updated_at}, "body_matches": true}: save that to',
      '$OUT/RELEASE-RECEIPTS/prompt-deployment.json.',
      "sbq-ro: select version, encode(digest(body,'sha256'),'hex') from public.content_prompts",
      `        where id = '${PROMPT_ROW_ID}'  -- expect version 6 and the sha256 of the reviewed prompt.md`,
      'record prompt_before_sha256 and prompt_after_sha256 in $OUT/RELEASE-RECEIPTS/workflow.json.',
      'These two now DIFFER by design; the equal-before-and-after rule applies to the schedule, not',
      'to the prompt.',
    ].join('\n'),
    rollback: [
      'restore the saved v5 body by the same in-place convention, guarded the same way:',
      '',
      '  update public.content_prompts',
      "     set body = <the body from $OUT/RELEASE-RECEIPTS/before/prompt-before-v5.json>,",
      "         version = version + 1, updated_at = now(), updated_by = 'content-evidence-03-rollback'",
      `   where id = '${PROMPT_ROW_ID}'::uuid and version = 6 and is_active = true`,
      '  returning id, version, updated_at;',
      '',
      "then read back that the stored body's sha256 equals " + PROMPT_BODY_SHA256_AT_DISCOVERY + '.',
    ].join('\n'),
    rollback_note: 'the version column is a monotonic counter in this table, so the rollback lands the v5 TEXT as v7 rather than setting version back to 5. That keeps every prior receipt readable and matches what the 09-19 release did on every bump.',
  }),
  step({
    id: 'S5-workflow',
    title: 'The weekly writer workflow, through the full n8nac protocol',
    identity: `n8n ${WORKFLOW_ID} "${WORKFLOW_NAME}", local ${WORKFLOW_FILE}, Code node Write Recommendations, jsCode sha256 ${WRITER_JS_SHA256_AT_DISCOVERY} at discovery, schedule ${WORKFLOW_CRON}`,
    before: [
      'PROTOCOL BOOTSTRAP (n8n-workflow-protocol "Workspace Bootstrap" and "Required Order" 1-2):',
      '  1. confirm $REPO/n8nac-config.json exists and carries a projectId and projectName',
      '     (it does: environment default, projectId personal, projectName Personal,',
      '      syncFolder workflows, target https://n8n.ivanmanfredi.com, verification status verified)',
      '  2. npx --yes n8nac instance list --json     (reuse the saved config; never add a duplicate)',
      '  3. read workflowDir from the ACTIVE instance in n8nac-config.json; never rebuild the path',
      '',
      'SYNC STATE:',
      `  4. npx --yes n8nac list                    (expect ${WORKFLOW_ID} TRACKED, not [archived];`,
      '                                              an archived workflow is read-only and cannot be pushed)',
      `  5. npx --yes n8nac pull ${WORKFLOW_ID}     (pull before edit; the UI may have moved)`,
      '  6. read the pulled file\'s <workflow-map> block FIRST, locate WriteRecommendations in the',
      '     NODE INDEX, and open only that section',
      '  7. record: active state, the full trigger list, the cron, and the jsCode sha256',
    ].join('\n'),
    guard: `the pulled jsCode sha256 must equal ${WRITER_JS_SHA256_AT_DISCOVERY}. A different value means someone edited the workflow in the n8n UI after Phase 0: resolve that drift first (npx --yes n8nac resolve ${WORKFLOW_ID} --mode keep-incoming, then re-patch) and never force-push over it. The two triggers must be exactly the existing Weekly Monday 05:00 (${WORKFLOW_CRON}) and Run Now Webhook; no trigger is added, none is removed, and no cron is changed. release.py prepare independently refuses on "Live workflow drift" for nodes, connections, settings or active.`,
    apply: [
      'EDIT (the same injection release.py already uses, so the splice is not reinvented):',
      '  8. python3 $REPO/tools/weekly-topics/release.py prepare',
      '     It hashes the live Write Recommendations jsCode, refuses on drift, then splices',
      '     $REPO/tools/weekly-topics/writer.js into the jsCode literal of',
      '     $REPO/workflows/default/audn-recommendation-writer.workflow.ts in place',
      '     (release.py:57-63). Only that node\'s jsCode changes.',
      '     It prints {"prepared": true, "writer_sha256": ...}: save it.',
      '',
      'VALIDATE AND UPLOAD:',
      '  9. npx --yes n8nac skills validate <workflowDir>/audn-recommendation-writer.workflow.ts',
      ' 10. npx --yes n8nac push <workflowDir>/audn-recommendation-writer.workflow.ts --verify',
      `     (full path from workflowDir, never a bare filename)`,
      ` 11. npx --yes n8nac verify ${WORKFLOW_ID}`,
      '',
      'PROVE THE ACTIVE VERSION CARRIES THE NEW CODE (house rule: an upload alone does not',
      'republish the active version, so the saved bytes and the running bytes can differ):',
      ` 12. npx --yes n8nac workflow deactivate ${WORKFLOW_ID}`,
      ` 13. npx --yes n8nac workflow activate ${WORKFLOW_ID}`,
      '     n8nac only, never the REST API and never the editor UI',
      ' 14. re-read the live workflow and sha256 the Write Recommendations jsCode again',
      '',
      'TEST (protocol steps 6 and 7):',
      ` 15. npx --yes n8nac test-plan ${WORKFLOW_ID} --json`,
      '     expect a Webhook trigger, HTTP testable, path audn-recommendation-writer-run.',
      '     The suggested payload is heuristic: ignore it and use the pinned body below.',
      ' 16. the workflow is already active (step 13), so test with --prod and this EXACT body:',
      '',
      `     npx --yes n8nac test ${WORKFLOW_ID} --prod --data '{"preview":true,"evidence":true,"client_id":"ivan","week_start":"2026-09-28"}'`,
      '',
      '     PREVIEW:TRUE IS NOT OPTIONAL. A body without it is a live committing run against the',
      '     production weekly queue. Never send one from this step. client_id is explicit so the',
      '     call covers one client and cannot sweep an un-enabled lane (audit F2).',
      '     The Run Now Webhook uses headerAuth (credential MePaNQPbI2XY2v3T). If n8nac test does',
      '     not attach that header and the call returns 401 or 403, send the byte-identical body',
      '     over an authenticated POST instead; the body never changes to make a call succeed.',
      '     Classify the result by the protocol: a Class A configuration gap is reported, not',
      '     re-edited; a runtime-state issue is a state problem, not a code problem; only a Class B',
      '     wiring error is fixed, pushed and re-tested.',
    ].join('\n'),
    readback: [
      `read-only GET /api/v1/workflows/${WORKFLOW_ID} AFTER the deactivate/activate cycle:`,
      '  the live Write Recommendations jsCode sha256 must equal the local writer.js sha256 and the',
      '  writer_sha256 release.py prepare printed',
      '  active must be true, exactly as it was before',
      `  the trigger list must still be exactly two: Weekly Monday 05:00 (${WORKFLOW_CRON}) and Run Now Webhook`,
      `  schedule_before must equal schedule_after (${WORKFLOW_CRON})`,
      'python3 $REPO/tools/weekly-topics/release.py verify  (refuses on node count, unrelated node,',
      '  connections, settings or active drift, and on a code readback mismatch)',
      'write $OUT/RELEASE-RECEIPTS/workflow.json with workflow_id, name, active, triggers,',
      '  prompt_slug, prompt_row_id, prompt_before_sha256, prompt_after_sha256, local_source_sha256,',
      '  schedule_before, schedule_after',
    ].join('\n'),
    rollback: [
      `restore the pre-release jsCode (sha256 ${WRITER_JS_SHA256_AT_DISCOVERY}) by copying`,
      '$OUT/RELEASE-RECEIPTS/before/writer.js back to $REPO/tools/weekly-topics/writer.js, running',
      'release.py prepare again, then:',
      '  npx --yes n8nac push <workflowDir>/audn-recommendation-writer.workflow.ts --verify',
      `  npx --yes n8nac workflow deactivate ${WORKFLOW_ID}`,
      `  npx --yes n8nac workflow activate ${WORKFLOW_ID}`,
      'then re-read and hash the live node again.',
    ].join('\n'),
    rollback_note: 'the deactivate is a one-step cycle inside the rollback, not a state the workflow is left in: leaving it inactive would stop the weekly recommendations entirely, which is a larger outage than any defect this rollback addresses. With the rollout switch empty the evidence path is already unreachable, so this byte-level rollback is a belt over that switch\'s braces.',
  }),
  step({
    id: 'S6-source-sync',
    title: 'The identical-hash check across the deployment sources',
    identity: 'tools/weekly-topics/writer.js, tools/weekly-topics/prompt.md and workflows/default/audn-recommendation-writer.workflow.ts at the workspace root; their before-copies in $OUT/RELEASE-RECEIPTS/before/',
    before: 'the byte-copies taken in S0. shasum -a 256 $OUT/RELEASE-RECEIPTS/before/* and the three live root files.',
    guard: 'the root writer.js, the worktree automation/weekly-topics/writer.js and the live jsCode were three-way identical at discovery (e92043...259ae3). Do not leave two different writer implementations labelled current. The .workflow.ts is edited in place by release.py prepare and is copied from nowhere: no worktree tracks that file.',
    apply: 'nothing new. S0 placed writer.js and prompt.md at the root and S5 edited the .workflow.ts in place. This step is the verification that those three and the live instance agree.',
    readback: [
      'shasum -a 256:',
      '  $REPO/tools/weekly-topics/writer.js',
      '  $WORKTREE/automation/weekly-topics/writer.js',
      '  the live Write Recommendations jsCode',
      'all three must print one identical hash. Record it as local_source_sha256 in',
      '$OUT/RELEASE-RECEIPTS/workflow.json.',
      'shasum -a 256 $REPO/tools/weekly-topics/prompt.md against the live content_prompts body:',
      'identical, and equal to prompt_after_sha256.',
    ].join('\n'),
    rollback: 'cp $OUT/RELEASE-RECEIPTS/before/writer.js $REPO/tools/weekly-topics/writer.js; cp $OUT/RELEASE-RECEIPTS/before/prompt.md $REPO/tools/weekly-topics/prompt.md; cp $OUT/RELEASE-RECEIPTS/before/audn-recommendation-writer.workflow.ts $REPO/workflows/default/audn-recommendation-writer.workflow.ts  -- then re-run the identical-hash check.',
    rollback_note: 'real file copies out of before/. A hash restores nothing, and the root tree has no version control to fall back on.',
  }),
  ...ENABLED_CLIENT_PROPOSAL.map((client) => step({
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
  ...ENABLED_CLIENT_PROPOSAL.map((client) => step({
    id: `S9-shortlist-${client}`,
    title: `The first reviewed shortlist for ${client}, one preview, one client`,
    identity: 'the existing RPC public.audn_recommendation_commit(text, text, jsonb, integer, boolean); rows land in public.ops_drafts kind audn_recommendation with approved_at and sent_at null',
    before: [
      "sbq-ro: select client_id, cycle_id, cardinality(proposal_ids) from public.audn_writer_cycles",
      "         where cycle_id like 'weekly:%'",
      'and the nine preserved week-2026-09-21 row ids from PHASE-0-SURFACES A4',
      '',
      'ONE NATIVE PREVIEW PER ENABLED CLIENT, with an explicit client_id:',
      `  body: {"preview":true,"evidence":true,"client_id":"${client}","week_start":"2026-09-28"}`,
      `  save it to $OUT/RELEASE-RECEIPTS/preview-${client}.json`,
      '',
      'A preview carrying evidence:true and NO client_id covers every registry client, ARCH',
      'included, and committing that one file would save evidence-path rows for a client the',
      'review did not clear (audit F2). The explicit client_id is what makes that impossible.',
    ].join('\n'),
    guard: [
      'read every card in the preview before anything is committed, then run the guard:',
      '',
      '  node $WORKTREE/automation/content-evidence/release/commit-guard.mjs \\',
      `    --preview $OUT/RELEASE-RECEIPTS/preview-${client}.json \\`,
      '    --enabled $OUT/ENABLED-CLIENTS.json',
      '',
      'It refuses a file that is not a preview, any row carrying an evidence package whose client',
      'is not in the reviewed enabled list, an evidence preview covering more than one client, a',
      'row stamped with another tenant, and an incomplete client block. It edits nothing in',
      'tools/weekly-topics/ and reimplements no commit logic.',
      '',
      'The cycle must be a week audn_recommendation_commit itself accepts on the day it runs: see',
      'D7 in the release plan and $OUT/RESUME.md. The nine existing week-2026-09-21 rows are never',
      'edited, approved or cleared to make room.',
    ].join('\n'),
    apply: [
      'node $WORKTREE/automation/content-evidence/release/commit-guard.mjs \\',
      `  --preview $OUT/RELEASE-RECEIPTS/preview-${client}.json \\`,
      '  --enabled $OUT/ENABLED-CLIENTS.json \\',
      `  --output $OUT/RELEASE-RECEIPTS/first-shortlist-${client}.json --apply`,
      '',
      'With --apply and only after the check passes, the guard runs the existing',
      '$REPO/tools/weekly-topics/commit-reviewed.py unchanged.',
    ].join('\n'),
    readback: [
      'commit-reviewed.py reads every written row back and refuses on a count or content mismatch,',
      'on a tenant or kind mismatch, and on any unexpected approval or dispatch.',
      `sbq-ro the returned ids: client_id = '${client}', approved_at is null, sent_at is null, and`,
      "context->'evidence_package' present on every row this run wrote.",
      'idempotency: re-run the same command once. audn_recommendation_commit returns',
      '{"ok":true,"already":true,"written":0} for the same (client_id, cycle_id) and writes nothing.',
    ].join('\n'),
    rollback: `the weekly path is idempotent per (client_id, cycle_id): a replay returns already true and writes nothing. To withdraw a choice use the existing decision path, select public.audn_weekly_recommendation_decide('${client}', '<proposal_id>'::uuid, '<reason>'), which records the reason and leaves the row in place. Rows are never deleted to undo a commit.`,
  })),
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
