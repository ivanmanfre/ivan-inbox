// content-evidence (staged, Run-3-ready) / report.mjs
//
// renderReport: turns already-computed SOURCE DATA objects (coverage rows, winner rows, control
// rows, a cost record, method-version records) into one markdown digest. It never accepts or
// prints pre-written prose as if it were the report -- every number on the page is recomputed from
// the rows the caller supplied, not copied from a caller-declared summary. That is the whole
// reason this module exists as code rather than a template a caller fills in by hand: a summary
// count that disagrees with its own rows is a corrupted report, and this module refuses to render
// it rather than display two different counts as if they agreed.
//
// Three display rules, straight from the spec's Clear inbox view section:
//   * A missing/unknown number renders as the word "unknown", never as 0 -- a real zero and an
//     unmeasured gap must never look the same on the page.
//   * A `reported_legacy` / `isLegacy` figure is always suffixed "reported (legacy), not verified"
//     -- it can never silently pass for a verified number.
//   * A post's own words never appear on this page beyond a 12-word opening fragment, however long
//     the `openingLine`/`firstLine` field the caller supplies actually is; this module truncates
//     defensively rather than trusting the caller already did.
//
// Self-contained (see patterns.mjs's header): no import from any repaired/production module.

export class ReportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ReportError(code, message, details); };

const MAX_OPENING_WORDS = 12;

/**
 * @param {object} args
 * @param {{rows?: object[], summary?: object, excluded?: object[]}} [args.coverage]
 * @param {{rows?: object[], summary?: object}} [args.winners]
 * @param {{rows?: object[], summary?: object}} [args.controls]
 * @param {{approvedUsd?: number|null, actualUsd?: number|null, paidProviderRequestsMade?: number|null}} [args.cost]
 * @param {{rows?: object[], summary?: object}} [args.methods]
 * @returns {string} markdown
 */
export function renderReport({ coverage, winners, controls, cost, methods } = {}) {
  const sections = [];
  sections.push(renderCoverage(coverage));
  sections.push(renderWinners(winners));
  sections.push(renderControls(controls));
  sections.push(renderCost(cost));
  sections.push(renderMethods(methods));
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Coverage + exclusions
// ---------------------------------------------------------------------------

function renderCoverage(coverage) {
  const lines = ['## Coverage'];
  if (!isObject(coverage) || !Array.isArray(coverage.rows)) {
    lines.push('', 'No coverage data supplied.');
    return lines.join('\n');
  }
  const rows = coverage.rows;
  const distinctPosts = new Set(rows.map((r) => r.postId)).size;
  const distinctAuthors = new Set(rows.map((r) => r.authorId)).size;

  if (isObject(coverage.summary)) {
    if ('distinctPosts' in coverage.summary) {
      reconcile('coverage', 'distinctPosts', coverage.summary.distinctPosts, distinctPosts);
    }
    if ('distinctAuthors' in coverage.summary) {
      reconcile('coverage', 'distinctAuthors', coverage.summary.distinctAuthors, distinctAuthors);
    }
  }

  lines.push(
    '',
    `- Distinct posts: ${fmtNum(distinctPosts)}`,
    `- Distinct authors: ${fmtNum(distinctAuthors)}`,
    `- Date span: ${fmtStr(coverage.summary?.dateSpan?.from)} – ${fmtStr(coverage.summary?.dateSpan?.to)}`,
  );

  if (Array.isArray(coverage.excluded) && coverage.excluded.length > 0) {
    const totalExcluded = coverage.excluded.reduce((s, e) => s + (Number.isFinite(e.count) ? e.count : 0), 0);
    if (isObject(coverage.summary) && 'excludedTotal' in coverage.summary) {
      reconcile('coverage', 'excludedTotal', coverage.summary.excludedTotal, totalExcluded);
    }
    lines.push('', '### Exclusions');
    for (const e of coverage.excluded) {
      lines.push(`- ${fmtStr(e.reason)}: ${fmtNum(e.count)}`);
    }
  } else {
    lines.push('', '### Exclusions', '', 'None reported.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Winners
// ---------------------------------------------------------------------------

function renderWinners(winners) {
  const lines = ['## Winners'];
  if (!isObject(winners) || !Array.isArray(winners.rows)) {
    lines.push('', 'No winner data supplied.');
    return lines.join('\n');
  }
  const rows = winners.rows;
  if (isObject(winners.summary) && 'count' in winners.summary) {
    reconcile('winners', 'count', winners.summary.count, rows.length);
  }
  if (rows.length === 0) {
    lines.push('', 'No verified winners yet.');
    return lines.join('\n');
  }
  lines.push('', '| Source | Author | Opening | Date | Observed | Baseline | Lift | Sample n | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const w of rows) {
    const opening = truncateOpening(w.openingLine ?? w.firstLine);
    const legacyNote = isLegacy(w) ? legacySuffix('') : '';
    const noteParts = [];
    if (Array.isArray(w.limitations)) noteParts.push(...w.limitations.map((l) => fmtStr(l)));
    if (legacyNote) noteParts.push(legacyNote);
    lines.push([
      fmtStr(w.sourceId), fmtStr(w.author), opening, fmtStr(w.publishedAt),
      fmtNum(w.observedValue), fmtNum(w.baselineValue), fmtNum(w.liftValue), fmtNum(w.sampleN),
      noteParts.length > 0 ? noteParts.join('; ') : 'unknown',
    ].map((c) => `| ${c} `).join('') + '|');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function renderControls(controls) {
  const lines = ['## Controls'];
  if (!isObject(controls) || !Array.isArray(controls.rows)) {
    lines.push('', 'No control data supplied.');
    return lines.join('\n');
  }
  const rows = controls.rows;
  const ordinaryCount = rows.filter((r) => r.kind === 'ordinary').length;
  const weakCount = rows.filter((r) => r.kind === 'weak').length;
  if (isObject(controls.summary)) {
    if ('ordinaryCount' in controls.summary) {
      reconcile('controls', 'ordinaryCount', controls.summary.ordinaryCount, ordinaryCount);
    }
    if ('weakCount' in controls.summary) {
      reconcile('controls', 'weakCount', controls.summary.weakCount, weakCount);
    }
  }
  lines.push('', `- Ordinary controls: ${fmtNum(ordinaryCount)}`, `- Weak controls: ${fmtNum(weakCount)}`);
  if (rows.length > 0) {
    lines.push('', '| Source | Author | Kind | Sample n |', '| --- | --- | --- | --- |');
    for (const c of rows) {
      lines.push(`| ${fmtStr(c.sourceId)} | ${fmtStr(c.author)} | ${fmtStr(c.kind)} | ${fmtNum(c.sampleN)} |`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

function renderCost(cost) {
  const lines = ['## Cost'];
  if (!isObject(cost)) {
    lines.push('', 'No cost data supplied.');
    return lines.join('\n');
  }
  lines.push(
    '',
    `- Approved spend: ${fmtUsd(cost.approvedUsd)}`,
    `- Actual spend: ${fmtUsd(cost.actualUsd)}`,
    `- Paid provider requests made: ${fmtNum(cost.paidProviderRequestsMade)}`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Method records
// ---------------------------------------------------------------------------

function renderMethods(methods) {
  const lines = ['## Method records'];
  if (!isObject(methods) || !Array.isArray(methods.rows)) {
    lines.push('', 'No method records supplied.');
    return lines.join('\n');
  }
  const rows = methods.rows;
  if (isObject(methods.summary) && 'count' in methods.summary) {
    reconcile('methods', 'count', methods.summary.count, rows.length);
  }
  if (rows.length === 0) {
    lines.push('', 'None recorded.');
    return lines.join('\n');
  }
  lines.push('');
  for (const m of rows) {
    const legacyNote = isLegacy(m) ? ` — ${legacySuffix('')}` : '';
    lines.push(`- ${fmtStr(m.id)} (${fmtStr(m.version)}): ${fmtStr(m.formula)}${legacyNote}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reconciliation: a supplied summary count that disagrees with its own rows is corrupted
// ---------------------------------------------------------------------------

function reconcile(section, field, expected, actual) {
  if (expected !== actual) {
    fail('REPORT_CORRUPTED_COUNT',
      `${section}.summary.${field} says ${JSON.stringify(expected)} but the supplied rows compute to ${JSON.stringify(actual)}`,
      { section, field, expected, actual });
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** null/undefined/non-finite render as "unknown"; a real 0 renders as "0", never conflated. */
function fmtNum(v) {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'unknown';
  return String(v);
}

function fmtUsd(v) {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) return 'unknown';
  return `$${v.toFixed(2)}`;
}

function fmtStr(v) {
  if (v === null || v === undefined || v === '') return 'unknown';
  return String(v);
}

function isLegacy(row) {
  return row?.isLegacy === true || row?.status === 'reported_legacy';
}

function legacySuffix(prefix) {
  return `${prefix}reported (legacy), not verified`;
}

/** Never prints body text beyond a 12-word opening fragment, however long the input is. */
function truncateOpening(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'unknown';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_OPENING_WORDS) return words.join(' ');
  return `${words.slice(0, MAX_OPENING_WORDS).join(' ')}…`;
}

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
