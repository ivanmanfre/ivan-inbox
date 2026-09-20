#!/usr/bin/env node
// automation/content-evidence/preview-selector.mjs
//
// Offline preview: builds the weekly evidence pack for one client from the frozen Run 2 study
// JSON (the findings, exactly as stored) and the Phase 0 WINNER-DIGEST (source post refs --
// url, author, first line, likes/comments/reposts -- joined onto each finding_id). Both are
// read-only private inputs passed by path; this script never copies them into the repo and
// never writes the private study/digest content back into the output beyond what a candidate
// already cites. No network call, no model call, no DB read.
//
// Client facts are unavailable offline: no consent-checked founder/buyer source file exists
// for this run per PHASE-0-SURFACES.md A4/A6 (D4 requires reusing the writer's own live
// permission check, which needs a DB read this phase does not make). Every candidate below is
// therefore expected to come back flagged `needs_material` -- that is the correct offline
// answer, not a defect in the selector. own-result findings and previousTests history are
// likewise unavailable offline (no own-post/measurement store or writer-cycle history was
// read), so `ownResults` and `previousTests` are passed empty and that is recorded in the
// output rather than silently assumed complete.
//
// Usage:
//   node automation/content-evidence/preview-selector.mjs \
//     --client ivan --week 2026-09-28 \
//     --study /path/to/repair-round-2/studies/ivan.json \
//     --digest /path/to/WINNER-DIGEST.json \
//     --out /path/to/SELECTOR-PREVIEWS

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidencePack } from './selector-pack.mjs';

function parseArgs(argv) {
  const out = { limit: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}

/**
 * Pure builder: given the already-loaded study and digest JSON, returns the SELECTOR-PREVIEWS
 * document per verification/SELECTOR-CONTRACT.md's PREVIEWS section shape, plus additional
 * audit fields the contract does not forbid (coverage, rejected, missingInputs, sourceManifest,
 * a digest-ref lookup for the .md renderer, and an explicit offline_note).
 */
export function buildPreview({ clientId, weekStart, studyJson, digestJson, limit = 3 }) {
  const study = studyJson || {};
  const digestClient = (digestJson && digestJson.clients && digestJson.clients[clientId]) || null;
  const digestById = new Map();
  if (digestClient && Array.isArray(digestClient.findings)) {
    for (const f of digestClient.findings) digestById.set(f.finding_id, f);
  }

  // Findings go into buildEvidencePack exactly as the study stores them, PLUS the likes count
  // joined from the digest (the raw study file does not carry likes; the digest does, from the
  // same posts file the study was built against). No other numeric field is altered.
  const findings = (Array.isArray(study.findings) ? study.findings : []).map((f) => {
    const d = digestById.get(f.finding_id);
    return d && typeof d.likes === 'number' ? { ...f, likes: d.likes } : f;
  });

  const studies = study.study_id
    ? [{ study_id: study.study_id, state: study.state, study_kind: 'market' }]
    : [];

  const pack = buildEvidencePack({
    clientId, weekStart, studies, findings, ownResults: [], clientFacts: [], previousTests: [], limit,
  });

  const choices = pack.candidates; // untouched candidate objects -- exact contract shape
  const coverageGap = choices.length === 0
    ? ((pack.missingInputs[0] && pack.missingInputs[0].reason)
      || `no qualifying source for ${clientId} in ${weekStart}`)
    : null;

  const digestRefFor = (findingId) => {
    const d = digestById.get(findingId);
    if (!d) return { finding_id: findingId, note: 'no WINNER-DIGEST entry for this finding_id' };
    return {
      finding_id: findingId, source_url: d.source_url, author: d.author, first_line: d.first_line,
      published_at: d.published_at, likes: d.likes, comments: d.comments, reposts: d.reposts,
    };
  };
  const citedFindingIds = [...new Set(choices.flatMap((c) => c.source_finding_ids))];
  const citedAuthors = new Set(citedFindingIds.map((fid) => digestById.get(fid) && digestById.get(fid).author).filter(Boolean));

  // The contract forbids a non-null coverage_gap when choices is non-empty (D3 for ARCH: rows
  // may be shown, but a coverage gap is still the expected READINESS verdict). This does not
  // set coverage_gap -- it is a separate, honest caution alongside a non-empty shortlist, not a
  // substitute for one.
  let singleAuthorCaution = null;
  if (choices.length > 0 && citedAuthors.size === 1) {
    const rankedAuthors = study.summary && study.summary.ranked_authors;
    singleAuthorCaution = `Every shown candidate for ${clientId} comes from the same author `
      + `(${[...citedAuthors][0]})` + (typeof rankedAuthors === 'number' ? `, out of ${rankedAuthors} ranked author(s) in the study` : '')
      + '. Choices are shown, but this is a coverage gap for readiness purposes, not a broad market signal.';
  }

  return {
    client_id: clientId,
    week_start: weekStart,
    choices,
    coverage_gap: coverageGap,
    coverage: pack.coverage,
    missingInputs: pack.missingInputs,
    rejected: pack.rejected,
    sourceManifest: pack.sourceManifest,
    single_author_caution: singleAuthorCaution,
    source_posts_digest_refs: Object.fromEntries(citedFindingIds.map((fid) => [fid, digestRefFor(fid)])),
    offline_note: 'Offline preview: client facts, own-result history and previous-test history are all '
      + 'unavailable this phase (no consent-checked source file, own-post store or writer-cycle history was '
      + 'read). needs_material on every candidate below is the expected, honest result of that gap -- not a '
      + 'defect in the selector logic.',
  };
}

function fmtNum(n) {
  return typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(n);
}

export function toMarkdown(preview) {
  const lines = [];
  lines.push(`# Selector preview: ${preview.client_id} -- week ${preview.week_start}`);
  lines.push('');
  lines.push('> Offline preview. No model call. Client facts, own-result history and previous-test history '
    + 'were not read this phase; every candidate is expected to show `needs_material`.');
  lines.push('');
  if (preview.coverage_gap) {
    lines.push(`**Coverage gap:** ${preview.coverage_gap}`);
    lines.push('');
  }
  if (preview.single_author_caution) {
    lines.push(`**Single-author caution:** ${preview.single_author_caution}`);
    lines.push('');
  }
  lines.push('## Coverage');
  lines.push('');
  for (const [k, v] of Object.entries(preview.coverage || {})) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push(`## Choices (${preview.choices.length})`);
  lines.push('');
  if (!preview.choices.length) {
    lines.push('None.');
  }
  for (const [i, c] of preview.choices.entries()) {
    const ref = preview.source_posts_digest_refs[c.source_finding_ids[0]] || {};
    lines.push(`### ${i + 1}. ${c.label} -- ${c.draft_key}`);
    lines.push('');
    if (ref.author) lines.push(`- Source: ${ref.author} -- "${ref.first_line || ''}" (${ref.published_at || 'date unknown'})`);
    if (ref.source_url) lines.push(`- Link: ${ref.source_url}`);
    lines.push(`- Observed vs baseline: ${fmtNum(ref.likes)} likes` + (ref.comments !== undefined ? `, ${fmtNum(ref.comments)} comments, ${fmtNum(ref.reposts)} reposts` : ''));
    lines.push(`- proposed_angle: ${c.proposed_angle}`);
    lines.push(`- objective: ${c.objective} | test_metric: ${c.test_metric} | comparison_rule: ${c.comparison_rule}`);
    lines.push(`- observation_window: ${c.observation_window.days} days`);
    lines.push(`- needs_material: ${c.needs_material || 'none'}`);
    lines.push(`- client_fact_refs: ${JSON.stringify(c.client_fact_refs)}`);
    lines.push(`- adaptation_history: ${c.adaptation_history.length ? JSON.stringify(c.adaptation_history) : 'none on record'}`);
    lines.push(`- limitations: ${c.limitations.join(' | ')}`);
    if (c.label === 'experiment') lines.push(`- experiment_reason: ${c.experiment_reason}`);
    lines.push('');
  }
  lines.push(`## Rejected (${preview.rejected.length})`);
  lines.push('');
  if (!preview.rejected.length) lines.push('None.');
  for (const r of preview.rejected) lines.push(`- \`${r.finding_id}\`: ${r.code} -- ${r.reason}`);
  lines.push('');
  lines.push(`## Missing inputs (${preview.missingInputs.length})`);
  lines.push('');
  if (!preview.missingInputs.length) lines.push('None.');
  for (const m of preview.missingInputs) lines.push(`- ${m.code}: ${m.reason}`);
  lines.push('');
  lines.push(`_${preview.offline_note}_`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args.client;
  const weekStart = args.week || '2026-09-28';
  const limit = Number(args.limit) || 3;
  if (!clientId || !args.study || !args.digest || !args.out) {
    process.stderr.write('Usage: preview-selector.mjs --client <id> --week <YYYY-MM-DD> --study <path> --digest <path> --out <dir>\n');
    process.exit(1);
  }
  const studyJson = JSON.parse(readFileSync(args.study, 'utf8'));
  const digestJson = JSON.parse(readFileSync(args.digest, 'utf8'));
  const preview = buildPreview({ clientId, weekStart, studyJson, digestJson, limit });
  if (!existsSync(args.out)) mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, `${clientId}.json`), `${JSON.stringify(preview, null, 2)}\n`);
  writeFileSync(path.join(args.out, `${clientId}.md`), toMarkdown(preview));
  process.stdout.write(`${clientId}: ${preview.choices.length} choice(s), coverage_gap=${JSON.stringify(preview.coverage_gap)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
