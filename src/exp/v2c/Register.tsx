import {
  groupLogByAgent, isBackfillEntry, parseLogEntry, scoreProgression,
  type AgentGroup, type AgentLogEntry, type QaSummary,
} from '../../lib/content'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { KeyRows, Rows, Val } from './ContentBits'
import { absTime } from './fmt'
import { parseRubric, verdictsDisagree } from './rubric'
import { label } from '../../lib/labels'

// The two registers.
//
// A register is a DOCUMENT, not a card: nothing here is dropped. The QA
// register still renders in full. The generation register FOLDS (2026-08-04,
// Ivan: agents compressed, dashboard-v2 style): every entry is a one-line
// summary that opens in place to the complete body — a fold announces there is
// more, which is what the old silent 5-line clamp never did.

function chipClass(status: string | null): string {
  if (status === 'PASS' || status === 'APPROVED') return 'ct-chip ct-chip-ok'
  if (status === 'FAIL' || status === 'HALT') return 'ct-chip ct-chip-bad'
  if (status) return 'ct-chip ct-chip-warn'
  return 'ct-chip'
}

function gap(prev: string | null, cur: string | null): string | null {
  if (!prev || !cur) return null
  const a = Date.parse(prev), b = Date.parse(cur)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const s = Math.round((b - a) / 1000)
  if (s < 1) return null
  if (s < 60) return `+${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `+${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `+${h}h`
  return `+${Math.floor(h / 24)}d`
}

// ---------------------------------------------------------------------------
// QA — the full verdict register
// ---------------------------------------------------------------------------

// THE QA TAB'S DEFAULT STATE (post-ballot, IA seat).
//
// Measured on the live proof row: 2,432px of panel against a 754px rail — 3.35
// screens, on the tab that opens first. The tabbing already fixed the RAIL; it
// left the tab itself a scroll. What is actually in those pixels is two
// different kinds of thing, and only one of them is the verdict:
//
//   the VERDICT — score, the stored-vs-body disagreement, the rubric, the
//   judge's own summary. This is what you read to decide. It stays open.
//   the EVIDENCE — the copy the gate substituted, the regeneration
//   instruction (620px of prose on the proof row), the attempt history, the
//   gate detail (527px of key/value), the provenance, the unnamed keys. This
//   is what you read when the verdict surprises you. It folds.
//
// Same rule the raw judge output has carried since D14: NOTHING IS DROPPED and
// the fold states what it holds, so a reader knows the thing exists and what it
// costs to open. A summary line is ~34px; the block behind it is 200-620.
// `Block`'s `res-hdr` and this summary print the same label and the same tail —
// the fold is a header that opens, not a new piece of vocabulary.
// Exported since 2026-08-10: the Fields panel folds its two longest blocks with
// the same control, and a second grammar for "there is more here" is exactly
// what this component exists to prevent.
export function Fold({ label, tail, children, defaultOpen }: {
  label: string; tail?: ReactNode; children: ReactNode; defaultOpen?: boolean
}) {
  return (
    <details className="qa-fold" open={defaultOpen}>
      <summary className="qa-fold-s">
        <span className="qa-fold-c" aria-hidden>›</span>
        <span className="qa-fold-k">{label}</span>
        {tail && <span className="qa-fold-t">{tail}</span>}
      </summary>
      <div className="qa-fold-b">{children}</div>
    </details>
  )
}

// A CLAMP, WHICH IS NOT A FOLD (2026-08-10, Ivan: "the back end depth i need to
// scroll a lot which is annoying").
//
// The judge's summary is the one piece of prose that IS the verdict, so D14's
// rule that it is never folded stands: a fold shows you a label, this shows you
// the prose and stops. Measured on the live proof row the summary ran 590px of
// a 1,248px panel — thirty lines, of which the first ten carry the finding and
// the rest carry the argument for it. Ten lines stay on the page; the reader is
// told, in characters, what the other twenty cost.
//
// It only ever renders a control when the text actually overflows the clamp,
// which most summaries do not — a "more" under nine lines of prose is a lie
// about there being an eleventh.
function Clamp({ lines, children, chars }: { lines: number; children: ReactNode; chars: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // scrollHeight against clientHeight while clamped — the only honest test,
    // because a character count cannot know the rail's width.
    setOver(el.scrollHeight - el.clientHeight > 4)
  }, [children])
  return (
    <>
      <div
        ref={ref}
        className={`qa-clamp${open ? ' on' : ''}`}
        style={open ? undefined : { WebkitLineClamp: lines }}
      >
        {children}
      </div>
      {(over || open) && (
        <button type="button" className="qa-more" onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : `Show all ${chars.toLocaleString()} characters`}
        </button>
      )}
    </>
  )
}

// The judge writes its dimension names in SCREAMING_SNAKE ('AI_TELLS'), and a
// panel of nine of them was nine shouted words. `label()` sentence-cases any
// unknown token; the one thing it cannot know is that "Ai" is an initialism, so
// that is restored here and nowhere else.
export function dimName(key: string): string {
  return label(key).replace(/\bAi\b/g, 'AI')
}

const DIM_THRESHOLD = 70

function dimPct(d: { score: number; max: number }): number {
  return Math.max(0, Math.min(100, (d.score / d.max) * 100))
}

function DimBar({ d }: { d: { key: string; score: number; max: number; note: string | null } }) {
  const pct = dimPct(d)
  const low = pct < DIM_THRESHOLD
  return (
    <div className={`qa-dim${low ? ' qa-dim-low' : ''}`}
      title={d.note ? `${d.key} ${d.score}/${d.max} - ${d.note}` : `${d.key} ${d.score}/${d.max}`}>
      <span className="qa-dim-k">{dimName(d.key)}</span>
      <span className="qa-dim-g" aria-hidden>
        {/* The threshold is the judge's own pass mark for a dimension, and it
            is drawn rather than stated: at or above 70% of ITS OWN max the fill
            is the clear mark, below it the fill takes attention. No average is
            ever computed across dimensions - they do not share a denominator.
            🔴 NEITHER FILL IS THE ACCENT any more. A score is a measurement,
            not a call to action (phase1-system §4), and eight lime bars beside
            one orange one is how the single failing dimension stayed hidden. */}
        <i className={low ? 'low' : ''} style={{ width: `${pct}%` }} />
      </span>
      <span className="qa-dim-n">{d.score}<i>/{d.max}</i></span>
    </div>
  )
}

// THE RUBRIC AT REST IS THE DIMENSIONS THAT FAILED.
//
// Nine near-identical bars is a block you scan rather than read, and on the
// live proof row exactly one of the nine is under the mark. Linear's density
// decision, which is a decision and not a compression: show the two or three
// facts that matter at rest and defer the remainder, rather than shrinking
// everything to fit (reference-study §4 move 2). Nothing is dropped - the
// summary states how many are behind it, and the count is the fact.
//
// The degenerate cases both go the safe way: if NOTHING failed there is nothing
// to lead with, so the full list stays open and the panel reads exactly as it
// did; if MOST failed the fold would hide the finding, so it opens by default.
function Rubric({ dims }: { dims: { key: string; score: number; max: number; note: string | null }[] }) {
  const low = dims.filter(d => dimPct(d) < DIM_THRESHOLD)
  const rest = dims.filter(d => dimPct(d) >= DIM_THRESHOLD)
  if (low.length === 0 || low.length > rest.length) {
    return <div className="dd-card qa-rubric">{dims.map(d => <DimBar key={d.key} d={d} />)}</div>
  }
  return (
    <div className="dd-card qa-rubric">
      {low.map(d => <DimBar key={d.key} d={d} />)}
      <details className="dwa-dims-rest">
        <summary>
          <span className="dwa-caret" aria-hidden>›</span>
          <span>
            {rest.length} dimension{rest.length === 1 ? '' : 's'} at or above the mark
          </span>
        </summary>
        <div className="dwa-dims-rest-b">
          {rest.map(d => <DimBar key={d.key} d={d} />)}
        </div>
      </details>
    </div>
  )
}

function QaFeedback({ feedback, verdict }: { feedback: string; verdict: string | null }) {
  const r = parseRubric(feedback)
  const clash = verdictsDisagree(verdict, r.verdict)
  if (!r.ok) {
    // FALLBACK, and it is the previous behaviour exactly: verbatim, unfolded,
    // nothing hidden. A body this module cannot read is a body it must not
    // pretend to have read.
    return <div className="dd-card"><div className="dd-body dd-pre">{feedback}</div></div>
  }
  return (
    <>
      {clash && (
        // 🔴 THE CONTRADICTION IS THE INFORMATION (content.ts:1561-1565). A live
        // row stores verdict:'PASS' while its own body opens "VERDICT:
        // REWRITE_OK". Both are printed and neither is resolved — the pane's
        // job is to make the disagreement visible, not to pick a winner.
        // The chip that used to sit here printed the same word the sentence
        // opens with, one line apart. Two prints of one verdict inside a block
        // whose entire subject is that a verdict was printed twice.
        <div className="qa-clash">
          Judge body says <b>{r.verdict}</b>{r.total ? ` (${r.total.score}/${r.total.max})` : ''};
          {' '}the row stores <b>{verdict}</b>. Neither is derived from the other.
        </div>
      )}
      <Rubric dims={r.dims} />
      {(r.summary || r.spice) && (
        <div className="dd-card qa-prose">
          {/* The judge's own summary is the one piece of prose that IS the
              verdict — it says why the numbers came out where they did — so it
              is never folded. */}
          {r.summary && (
            <div className="qa-p">
              <span>Summary</span>
              <Clamp lines={10} chars={r.summary.length}>{r.summary}</Clamp>
            </div>
          )}
          {/* Spice is the gate reporting on a REQUEST ("requested 2, delivered
              yes"), which is a parameter check rather than a judgement, and it
              measured at 102px directly under a 302px summary on the tab that
              opens first. Announced fold, same grammar as the raw output —
              nothing dropped, and the reader is told it is there. */}
          {r.spice && (
            <details className="dd-log-raw qa-raw qa-spice">
              <summary>Spice check</summary>
              <div className="qa-p qa-p-b">{r.spice}</div>
            </details>
          )}
        </div>
      )}
      {/* Nothing is dropped and the fold says what it holds — an unannounced
          clamp is what the 1,240px block was replacing. */}
      <details className="dd-log-raw qa-raw">
        <summary>Raw judge output · {feedback.length.toLocaleString()} characters</summary>
        <div className="dd-card"><div className="dd-body dd-pre">{feedback}</div></div>
      </details>
    </>
  )
}

export function QaRegister({ qa }: { qa: QaSummary }) {
  const provenance: [string, React.ReactNode][] = []
  if (qa.iteration !== null) provenance.push(['Iteration', qa.iteration])
  if (qa.originalVerdict) provenance.push(['Original verdict', label(qa.originalVerdict)])
  if (qa.parseSuccess !== null) provenance.push(['Parsed cleanly', qa.parseSuccess ? 'yes' : 'no'])
  if (qa.autoPromoted !== null) provenance.push(['Auto-promoted', qa.autoPromoted ? 'yes' : 'no'])
  if (qa.publishedVersion !== null) provenance.push(['Published version', <Val v={qa.publishedVersion} key="pv" />])
  if (qa.backfilled !== null) {
    // A backfilled verdict is a historical reconstruction, not evidence of what
    // the gate did at the time, and it has to say so.
    provenance.push(['Evidence', qa.backfilled
      ? <span className="ct-chip ct-chip-warn">backfilled</span>
      : 'live gate run'])
  }
  if (qa.backfillV !== null) provenance.push(['Backfill version', <Val v={qa.backfillV} key="bv" />])

  return (
    <>
      <div className="wb-qa">
        {qa.score !== null && <div className="wb-qa-n">{qa.score}</div>}
        <div className="wb-qa-r">
          {qa.verdict && (
            // Strictly: only a literal PASS is a pass. REWRITE_OK, FAIL and a
            // missing verdict all read amber.
            <span className={`ct-chip ${qa.pass ? 'ct-chip-ok' : 'ct-chip-warn'}`}>{label(qa.verdict)}</span>
          )}
          <div className="wb-qa-g">
            {/* 🔴 NOT THE ACCENT. The meter was the second-largest lime mark in
                the window and it measures a score. Lime is the screen's ONE
                primary action; a verdict reads on the semantic ramp the app
                already ships, which also makes a failing score legible as a
                failing score rather than as a shorter green bar. */}
            <span className="wb-qa-fill" style={{
              width: `${Math.max(0, Math.min(100, qa.score ?? 0))}%`,
              background: qa.pass ? 'var(--sev-clear)' : 'var(--sev-attention)',
            }} />
          </div>
        </div>
      </div>

      {/* THE RUBRIC, DRAWN (D14).
          The nine dimensions the judge scored have no field anywhere in the
          schema — they live only inside this free-text body, which is why the
          pane rendered 2,187 characters of monospace and called it a verdict.
          They are parsed out, best effort, and the raw string is kept below
          them, always, under a fold that says how long it is. Under three
          matched dimensions the parse is declared failed and the dump renders
          exactly as it did before: a half-drawn rubric would read as a
          dimension that scored nothing. */}
      {qa.feedback && <QaFeedback feedback={qa.feedback} verdict={qa.verdict} />}

      {qa.rewriteText && (
        // 🔴 What actually SHIPPED when a gate rewrote the post — present on 150
        // rows and dropped by every surface until now. This is the voice-drift
        // blind spot the dashboard's QA panel exists to close.
        //
        // FOLDED, NOT DROPPED (post-ballot). 620px of substituted copy was the
        // single largest block on the tab that opens first, and it answers a
        // question you only ask after the verdict has surprised you. The
        // character count is on the summary so the fold states its own cost, and
        // the word "substituted" is on it too — the label alone ("The applied
        // rewrite") does not say that this is what published.
        <Fold
          label="The applied rewrite"
          // The field's own name and value, not a sentence about it: what
          // rewrite_total counts is the gate's business, and paraphrasing it
          // ("75 rewritten") invents a unit.
          tail={`the copy that published · ${qa.rewriteText.length.toLocaleString()} chars${
            qa.rewriteTotal !== null ? ` · rewrite_total ${qa.rewriteTotal}` : ''}`}
        >
          <div className="ct-subtle">
            This is the copy the gate substituted. It is what published, not the
            draft body above it.
          </div>
          <div className="dd-card"><div className="dd-body dd-pre">{qa.rewriteText}</div></div>
        </Fold>
      )}

      {qa.regenerateInstruction && (
        // Same class of thing and the same treatment: the judge's brief for the
        // NEXT run, 620px of it on the live proof row. It is not the verdict.
        <Fold
          label="Regeneration instruction"
          tail={`${qa.regenerateInstruction.length.toLocaleString()} chars`}
        >
          <div className="dd-card"><div className="dd-body dd-pre">{qa.regenerateInstruction}</div></div>
        </Fold>
      )}

      {(qa.regenHistory.length > 0 || qa.regenAttempts !== null) && (
        <Fold
          label="Regeneration history"
          tail={qa.regenAttempts !== null ? `${qa.regenAttempts} attempts` : undefined}
        >
          {qa.regenHistory.length > 0 ? (
            <div className="dd-card">
              {qa.regenHistory.map((h, i) => (
                <div className="dd-log" key={i}>
                  <div className="dd-log-h">
                    <span className="dd-log-agent">Attempt {h.iteration ?? i + 1}</span>
                    {h.verdict && <span className={chipClass(h.verdict.toUpperCase())}>{label(h.verdict)}</span>}
                    {h.score !== null && <span className="ct-chip">{h.score}</span>}
                    {h.issues !== null && <span className="ct-chip">{h.issues} issues</span>}
                    {h.rewriteApplied === true && <span className="ct-chip ct-chip-warn">rewrite applied</span>}
                  </div>
                  <KeyRows items={h.rest} />
                </div>
              ))}
            </div>
          ) : (
            <div className="ct-subtle">
              {qa.regenAttempts} regeneration {qa.regenAttempts === 1 ? 'attempt' : 'attempts'} recorded,
              with no per-attempt detail stored.
            </div>
          )}
        </Fold>
      )}

      {/* The three flat key/value registers. 527px of gate detail and 186px of
          provenance on the proof row, and both are lookups — you come to them
          with a question ("did the claim check run?"), never by scrolling past
          them. The COUNT rides on each summary so the fold is not a guess. */}
      {qa.gates.length > 0 && (
        <Fold label="Gate detail" tail={`${qa.gates.length} ${qa.gates.length === 1 ? 'gate' : 'gates'}`}>
          <KeyRows items={qa.gates} />
        </Fold>
      )}

      {provenance.length > 0 && (
        <Fold label="Verdict provenance" tail={`${provenance.length} fields`}>
          <Rows items={provenance} />
        </Fold>
      )}

      {/* Every qa key this code does not name. ~23 are live and the generator
          adds more; an unnamed key appears the day it appears. */}
      {qa.rest.length > 0 && (
        <Fold label="Other QA fields" tail={`${qa.rest.length} keys`}>
          <KeyRows items={qa.rest} />
        </Fold>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The generation register — every entry, every agent, no collapse
// ---------------------------------------------------------------------------

export function AgentRegister({ log }: { log: AgentLogEntry[] }) {
  if (log.length === 0) return null
  const steps = scoreProgression(log)
  const groups = groupLogByAgent(log)
  const backfilled = log.filter(isBackfillEntry).length
  // 🔴 A DELTA ACROSS TWO SCALES IS A WRONG NUMBER. The live proof row runs
  // Promoter 8/10 → QA 50/90 → QA Regen 102/120, and last-minus-first printed
  // "+42 since first pass" — arithmetic on three different denominators, which
  // reads as a climb that was never measured. The delta only appears when the
  // first and last step were scored on the SAME scale; the steps themselves
  // each carry their own denominator and stay visible either way.
  const first = steps[0]
  const last = steps[steps.length - 1]
  const delta = steps.length > 1 && first.max === last.max ? last.score - first.score : null

  return (
    <>
      <div className="ct-subtle">
        {groups.length} agent{groups.length === 1 ? '' : 's'} · {log.length} entries
        {backfilled > 0 && ` · ${backfilled} reconstructed from ClickUp, not live agent steps`}
      </div>

      {steps.length > 1 && (
        // The score progression across attempts, which is what makes a
        // 68 → 69 → 74 climb legible as a climb.
        <div className="dd-card">
          <div className="ct-prog">
            {steps.map((s, i) => (
              <span className="ct-prog-s" key={i}>
                <b>{s.score}{s.max ? `/${s.max}` : ''}</b>
                <i>{s.agent ?? 'unnamed'}</i>
              </span>
            ))}
            {delta !== null && delta !== 0 && (
              <span className={`ct-chip${delta > 0 ? ' ct-chip-ok' : ' ct-chip-warn'}`}>
                {delta > 0 ? '+' : ''}{delta} since first pass
              </span>
            )}
          </div>
        </div>
      )}

      {/* COMPRESSED BY AGENT (Ivan, 2026-08-04: "the dif agents compressed").
          Two folds, not one. Measured on the live lane: the richest draft is 43
          entries from 14 agents, so the first fold turns 43 peer rows into 14
          agent rows — each carrying that agent's own passes, its final verdict
          and its score run — and the second opens a single pass to its complete
          body. Nothing is dropped, and a fold announces what it holds, which is
          what the silent 5-line clamp never did. */}
      <div className="dd-card">
        {groups.map((g, gi) => <AgentGroupRow key={gi} g={g} log={log} />)}
      </div>
    </>
  )
}

// A glyph per agent, purely presentational, with a fallback that means the
// roster stays the DATA's (36 distinct names are live and growing) — an unknown
// agent renders with the generic mark and its own name, never as "unknown".
const AGENT_GLYPH: [RegExp, string][] = [
  [/give-?up|halt|stuck|error/i, '⚠'],
  [/qa|verdict|gate|lint|claim|slop|forbidden/i, '✓'],
  [/regen|loop|rewrit/i, '↻'],
  [/hook|content|editorial|caption|structur/i, '✎'],
  [/image|cover|video/i, '◧'],
  [/publish|schedul|promot/i, '↑'],
  [/ivan|operator/i, '☺'],
]

function glyphFor(agent: string | null): string {
  if (!agent) return '·'
  for (const [re, g] of AGENT_GLYPH) if (re.test(agent)) return g
  return '◆'
}

function AgentGroupRow({ g, log }: { g: AgentGroup; log: AgentLogEntry[] }) {
  const n = g.entries.length
  // The score run is the whole reason to group: 62 → 93 → 90 across four passes
  // is a story, and three separate rows is not.
  const run = g.scores.length > 1
    ? `${g.scores.join(' → ')}${g.scoreMax ? `/${g.scoreMax}` : ''}`
    : g.scores.length === 1
      ? `${g.scores[0]}${g.scoreMax ? `/${g.scoreMax}` : ''}`
      : null
  const span = g.firstTs
    ? (g.lastTs && g.lastTs !== g.firstTs
      ? `${absTime(g.firstTs)} → ${absTime(g.lastTs)}`
      : absTime(g.firstTs))
    : 'no timestamp'
  return (
    <details className="dd-agrp">
      <summary className="dd-agrp-s">
        <span className="dd-agrp-g" aria-hidden>{glyphFor(g.agent)}</span>
        <span className="dd-log-agent">{g.agent ?? 'Unattributed'}</span>
        {n > 1 && <span className="dd-agrp-n">×{n}</span>}
        {g.status && <span className={chipClass(g.status)}>{g.status}</span>}
        {run && <span className="ct-chip">{run}</span>}
        <span className="dd-agrp-t">{span}</span>
      </summary>
      <div className="dd-agrp-b">
        {g.entries.map(({ entry, i }) => (
          <LogEntryRow key={i} e={entry} prev={log[i - 1] ?? null} />
        ))}
      </div>
    </details>
  )
}

function LogEntryRow({ e, prev }: { e: AgentLogEntry; prev: AgentLogEntry | null }) {
  const p = parseLogEntry(e)
  // Elapsed since the previous entry IN THE WHOLE LOG, not since this agent's
  // last pass — what makes a stall legible is the silence on the pipeline, and
  // the proof row opens on a Stuck Sentinel 23 minutes into one.
  const since = gap(prev?.ts ?? null, e.ts)
  return (
    <details className="dd-logc">
      <summary className="dd-logc-s">
        <span className="dd-logc-h">
          {p.status && <span className={chipClass(p.status)}>{p.status}</span>}
          {p.score !== null && (
            <span className="ct-chip">{p.score}{p.scoreMax ? `/${p.scoreMax}` : ''}</span>
          )}
          {p.issues !== null && <span className="ct-chip">{p.issues} issues</span>}
          {isBackfillEntry(e) && <span className="ct-chip ct-chip-warn">backfill</span>}
          {e.source && !isBackfillEntry(e) && <span className="dd-log-src">{e.source}</span>}
          <span className="dd-logc-t">
            {e.ts ? absTime(e.ts) : 'no timestamp'}
            {since && <span className="dd-log-gap">{since}</span>}
          </span>
        </span>
        {/* The first LINE of the humanised body, never the first 110 characters
            of it: a QA body opens "VERDICT: NEEDS_REGENERATE (total 93/120)"
            and then runs 13,000 characters, so the line IS the summary and a
            character count would cut it mid-verdict. */}
        <span className="dd-logc-p">
          {p.text.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 160) || '(empty entry)'}
        </span>
      </summary>
      <div className="dd-log">
        {e.comment_id && <div className="dd-log-ts">{e.comment_id}</div>}
        <div className="dd-body dd-pre">{p.text}</div>
        {p.rewrite && (
          <div className="dd-log-rw"><div className="dd-body dd-pre">{p.rewrite}</div></div>
        )}
        {p.json && (
          <details className="dd-log-raw">
            <summary>payload</summary>
            <Val v={p.json} />
          </details>
        )}
      </div>
    </details>
  )
}
