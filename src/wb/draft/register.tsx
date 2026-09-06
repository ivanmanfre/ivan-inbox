/* ==========================================================================
   src/wb/draft/register.tsx — the QA verdict and the generation log (S16-32,
   S16-36), on the design system.

   Ported from src/exp/v2c/Register.tsx. Every parse, every threshold, every
   fold, every degenerate-case branch and every string is the one that was
   there. The old file stays on disk while W3's magnet window still imports it.

   THE THREE RULES THIS FILE KEEPS:
     · nothing is dropped — the raw judge output is always one fold away, with
       its own length printed on the summary;
     · a score is a MEASUREMENT, never the accent — lime is the screen's one
       primary action, so a rubric bar and a verdict meter read on the severity
       ramp and a failing dimension is legible as a failing dimension;
     · a delta across two scales is a wrong number, so it only appears when the
       first and last step share a denominator.

   The only visual thing that changed: the agent glyphs were seven unicode
   marks doing an icon's job and are now the system's lucide names, and the
   dimension bar is the kit's own measured line rather than a hand-drawn well.
   ========================================================================== */
import {
  groupLogByAgent, isBackfillEntry, parseLogEntry, scoreProgression,
  type AgentGroup, type AgentLogEntry, type QaSummary,
} from '../../lib/content'
import type { ReactNode } from 'react'
import { Chip, Icon, type IconName } from '../../ds'
import { BarLine } from '../kit'
import { Block, Clamp, Fold, KeyRows, Mark, Pre, Rows, Val, Well } from './bits'
import { absTime } from '../../exp/v2c/fmt'
import { parseRubric, verdictsDisagree } from '../../exp/v2c/rubric'
import { label } from '../../lib/labels'
import './draft.css'

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

// The judge writes its dimension names in SCREAMING_SNAKE ('AI_TELLS'), and a
// panel of nine of them was nine shouted words. `label()` sentence-cases any
// unknown token; the one thing it cannot know is that "Ai" is an initialism, so
// that is restored here and nowhere else.
export function dimName(key: string): string {
  return label(key).replace(/\bAi\b/g, 'AI')
}

// 🔴 THE BADGE STOPPED SHOUTING AND THE PROSE DID NOT. The judge's own summary
// quotes the same tokens inside sentences ("AI_TELLS at 8"), which is a raw
// enum rendered as read text next to a badge that no longer matches it. The
// vocabulary is the ROW'S OWN declared dimension keys and nothing else: a token
// the judge did not declare is left exactly as written, because it is then a
// verdict or a gate code and this function has no standing to rewrite it.
export function deShout(prose: string, dims: { key: string }[]): string {
  if (!dims.length) return prose
  let out = prose
  for (const d of dims) {
    if (!/_/.test(d.key)) continue
    out = out.split(d.key).join(dimName(d.key))
  }
  return out
}

const DIM_THRESHOLD = 70

function dimPct(d: { score: number; max: number }): number {
  return Math.max(0, Math.min(100, (d.score / d.max) * 100))
}

function DimBar({ d }: { d: { key: string; score: number; max: number; note: string | null } }) {
  const pct = dimPct(d)
  const low = pct < DIM_THRESHOLD
  return (
    <div
      className="a-dw-dim"
      title={d.note ? `${d.key} ${d.score}/${d.max} - ${d.note}` : `${d.key} ${d.score}/${d.max}`}
    >
      <span className="a-dw-dim-k">{dimName(d.key)}</span>
      {/* The threshold is the judge's own pass mark for a dimension, and it is
          DRAWN rather than stated: at or above 70% of its own max the fill is
          the clear mark, below it the fill takes attention. No average is ever
          computed across dimensions — they do not share a denominator. */}
      <BarLine pct={pct} tone={low ? 'attention' : 'clear'} />
      <span className="a-mono a-dw-dim-n">{d.score}<span className="a-dim">/{d.max}</span></span>
    </div>
  )
}

// THE RUBRIC AT REST IS THE DIMENSIONS THAT FAILED. Nine near-identical bars is
// a block you scan rather than read. Nothing is dropped — the summary states
// how many are behind it, and the count is the fact. Both degenerate cases go
// the safe way: nothing failed, so there is nothing to lead with and the full
// list stays open; most failed, so a fold would hide the finding and it opens.
function Rubric({ dims }: { dims: { key: string; score: number; max: number; note: string | null }[] }) {
  const low = dims.filter(d => dimPct(d) < DIM_THRESHOLD)
  const rest = dims.filter(d => dimPct(d) >= DIM_THRESHOLD)
  if (low.length === 0 || low.length > rest.length) {
    return <Well className="a-dw-rubric">{dims.map(d => <DimBar key={d.key} d={d} />)}</Well>
  }
  return (
    <Well className="a-dw-rubric">
      {low.map(d => <DimBar key={d.key} d={d} />)}
      <Fold
        label={`${rest.length} dimension${rest.length === 1 ? '' : 's'} at or above the mark`}
      >
        {rest.map(d => <DimBar key={d.key} d={d} />)}
      </Fold>
    </Well>
  )
}

function QaFeedback({ feedback, verdict }: { feedback: string; verdict: string | null }) {
  const r = parseRubric(feedback)
  const clash = verdictsDisagree(verdict, r.verdict)
  if (!r.ok) {
    // FALLBACK, and it is the previous behaviour exactly: verbatim, unfolded,
    // nothing hidden. A body this module cannot read is a body it must not
    // pretend to have read.
    return <Well><Pre>{feedback}</Pre></Well>
  }
  return (
    <>
      {clash && (
        // 🔴 THE CONTRADICTION IS THE INFORMATION. A live row stores
        // verdict:'PASS' while its own body opens "VERDICT: REWRITE_OK". Both
        // are printed and neither is resolved — the pane's job is to make the
        // disagreement visible, not to pick a winner.
        <div className="a-dw-clash">
          Judge body says <b>{label(r.verdict)}</b>{r.total ? ` (${r.total.score}/${r.total.max})` : ''};
          {' '}the row stores <b>{label(verdict)}</b>. Neither is derived from the other.
        </div>
      )}
      <Rubric dims={r.dims} />
      {(r.summary || r.spice) && (
        <Well>
          {/* The judge's own summary is the one piece of prose that IS the
              verdict — it says why the numbers came out where they did — so it
              is never folded. */}
          {r.summary && (
            <div className="a-dw-p">
              <span className="a-eyebrow">Summary</span>
              <Clamp lines={10} chars={r.summary.length}>{deShout(r.summary, r.dims)}</Clamp>
            </div>
          )}
          {/* Spice is the gate reporting on a REQUEST, which is a parameter
              check rather than a judgement. Announced fold, nothing dropped. */}
          {r.spice && (
            <Fold label="Spice check">
              <Pre>{r.spice}</Pre>
            </Fold>
          )}
        </Well>
      )}
      {/* Nothing is dropped and the fold says what it holds — an unannounced
          clamp is what the 1,240px block was replacing. */}
      <Fold label="Raw judge output" tail={`${feedback.length.toLocaleString()} characters`}>
        <Well><Pre>{feedback}</Pre></Well>
      </Fold>
    </>
  )
}

export function QaRegister({ qa }: { qa: QaSummary }) {
  const provenance: [string, ReactNode][] = []
  if (qa.iteration !== null) provenance.push(['Iteration', qa.iteration])
  if (qa.originalVerdict) provenance.push(['Original verdict', label(qa.originalVerdict)])
  if (qa.parseSuccess !== null) provenance.push(['Parsed cleanly', qa.parseSuccess ? 'yes' : 'no'])
  if (qa.autoPromoted !== null) provenance.push(['Auto-promoted', qa.autoPromoted ? 'yes' : 'no'])
  if (qa.publishedVersion !== null) provenance.push(['Published version', <Val v={qa.publishedVersion} key="pv" />])
  if (qa.backfilled !== null) {
    // A backfilled verdict is a historical reconstruction, not evidence of what
    // the gate did at the time, and it has to say so.
    provenance.push(['Evidence', qa.backfilled
      ? <Chip tone="attention">backfilled</Chip>
      : 'live gate run'])
  }
  if (qa.backfillV !== null) provenance.push(['Backfill version', <Val v={qa.backfillV} key="bv" />])

  return (
    <>
      <div className="a-dw-qa">
        {qa.score !== null && <span className="a-dw-qa-n a-mono">{qa.score}</span>}
        <span className="a-dw-qa-r">
          {qa.verdict && (
            // Strictly: only a literal PASS is a pass. REWRITE_OK, FAIL and a
            // missing verdict all read amber.
            <Chip tone={qa.pass ? 'clear' : 'attention'}>{label(qa.verdict)}</Chip>
          )}
          {/* 🔴 NOT THE ACCENT. The meter measures a score, and lime is the
              screen's one primary action. */}
          <BarLine
            pct={Math.max(0, Math.min(100, qa.score ?? 0))}
            tone={qa.pass ? 'clear' : 'attention'}
          />
        </span>
      </div>

      {/* THE RUBRIC, DRAWN. The nine dimensions the judge scored have no field
          anywhere in the schema — they live only inside this free-text body,
          which is why the pane rendered 2,187 characters of monospace and
          called it a verdict. They are parsed out, best effort, and the raw
          string is kept below them, always. */}
      {qa.feedback && <QaFeedback feedback={qa.feedback} verdict={qa.verdict} />}

      {qa.rewriteText && (
        // 🔴 What actually SHIPPED when a gate rewrote the post. Folded, not
        // dropped: it answers a question you only ask after the verdict has
        // surprised you, and the summary states its own cost.
        <Fold
          label="The applied rewrite"
          tail={`the copy that published · ${qa.rewriteText.length.toLocaleString()} chars${
            qa.rewriteTotal !== null ? ` · rewrites ${qa.rewriteTotal}` : ''}`}
        >
          <p className="a-dw-note">
            This is the copy the gate substituted. It is what published, not the
            draft body above it.
          </p>
          <Well><Pre>{qa.rewriteText}</Pre></Well>
        </Fold>
      )}

      {qa.regenerateInstruction && (
        // Same class of thing and the same treatment: the judge's brief for the
        // NEXT run. It is not the verdict.
        <Fold
          label="Regeneration instruction"
          tail={`${qa.regenerateInstruction.length.toLocaleString()} chars`}
        >
          <Well><Pre>{qa.regenerateInstruction}</Pre></Well>
        </Fold>
      )}

      {(qa.regenHistory.length > 0 || qa.regenAttempts !== null) && (
        <Fold
          label="Regeneration history"
          tail={qa.regenAttempts !== null ? `${qa.regenAttempts} attempts` : undefined}
        >
          {qa.regenHistory.length > 0 ? (
            <Well>
              {qa.regenHistory.map((h, i) => (
                <div className="a-dw-attempt" key={i}>
                  <div className="a-dw-attempt-h">
                    <span className="a-title-t">Attempt {h.iteration ?? i + 1}</span>
                    {h.verdict && <Mark status={h.verdict.toUpperCase()}>{label(h.verdict)}</Mark>}
                    {h.score !== null && <Chip>{h.score}</Chip>}
                    {h.issues !== null && <Chip>{h.issues} issues</Chip>}
                    {h.rewriteApplied === true && <Chip tone="attention">rewrite applied</Chip>}
                  </div>
                  <KeyRows items={h.rest} />
                </div>
              ))}
            </Well>
          ) : (
            <p className="a-dw-note">
              {qa.regenAttempts} regeneration {qa.regenAttempts === 1 ? 'attempt' : 'attempts'} recorded,
              with no per-attempt detail stored.
            </p>
          )}
        </Fold>
      )}

      {/* The three flat key/value registers, and both are lookups — you come to
          them with a question, never by scrolling past them. The COUNT rides on
          each summary so the fold is not a guess. */}
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

// A mark per agent, purely presentational, with a fallback that means the
// roster stays the DATA's (36 distinct names are live and growing) — an unknown
// agent renders with the generic mark and its own name, never as "unknown".
// These were seven unicode glyphs; they are the system's icon names now.
const AGENT_ICON: [RegExp, IconName][] = [
  [/give-?up|halt|stuck|error/i, 'alert'],
  [/qa|verdict|gate|lint|claim|slop|forbidden/i, 'check'],
  [/regen|loop|rewrit/i, 'refresh'],
  [/hook|content|editorial|caption|structur/i, 'edit'],
  [/image|cover|video/i, 'image'],
  [/publish|schedul|promot/i, 'up'],
  [/ivan|operator/i, 'smile'],
]

function iconFor(agent: string | null): IconName {
  if (!agent) return 'dot'
  for (const [re, g] of AGENT_ICON) if (re.test(agent)) return g
  return 'diamond'
}

export function AgentRegister({ log }: { log: AgentLogEntry[] }) {
  if (log.length === 0) return null
  const steps = scoreProgression(log)
  const groups = groupLogByAgent(log)
  const backfilled = log.filter(isBackfillEntry).length
  // 🔴 A DELTA ACROSS TWO SCALES IS A WRONG NUMBER. The live proof row runs
  // Promoter 8/10 → QA 50/90 → QA Regen 102/120, and last-minus-first printed
  // "+42 since first pass" — arithmetic on three different denominators. The
  // delta only appears when the first and last step were scored on the SAME
  // scale; the steps each carry their own denominator and stay visible either
  // way.
  const first = steps[0]
  const last = steps[steps.length - 1]
  const delta = steps.length > 1 && first.max === last.max ? last.score - first.score : null

  return (
    <>
      <p className="a-dw-note">
        {groups.length} agent{groups.length === 1 ? '' : 's'} · {log.length} entries
        {backfilled > 0 && ` · ${backfilled} reconstructed from ClickUp, not live agent steps`}
      </p>

      {steps.length > 1 && (
        // The score progression across attempts, which is what makes a
        // 68 → 69 → 74 climb legible as a climb.
        <Well>
          <div className="a-dw-prog">
            {steps.map((s, i) => (
              <span className="a-dw-prog-s" key={i}>
                <span className="a-mono a-dw-prog-n">{s.score}{s.max ? `/${s.max}` : ''}</span>
                <span className="a-meta a-dim">{s.agent ?? 'unnamed'}</span>
              </span>
            ))}
            {delta !== null && delta !== 0 && (
              <Chip tone={delta > 0 ? 'clear' : 'attention'}>
                {delta > 0 ? '+' : ''}{delta} since first pass
              </Chip>
            )}
          </div>
        </Well>
      )}

      {/* COMPRESSED BY AGENT. Two folds, not one: the richest draft is 43
          entries from 14 agents, so the first fold turns 43 peer rows into 14
          agent rows — each carrying that agent's own passes, its final verdict
          and its score run — and the second opens a single pass to its complete
          body. Nothing is dropped. */}
      <Well>
        {groups.map((g, gi) => <AgentGroupRow key={gi} g={g} log={log} />)}
      </Well>
    </>
  )
}

function AgentGroupRow({ g, log }: { g: AgentGroup; log: AgentLogEntry[] }) {
  const n = g.entries.length
  // The score run is the whole reason to group: 62 → 93 → 90 across four passes
  // is a story, and three separate rows is not.
  // The run and the span both carried a typed arrow. An arrow is an icon in
  // this system (`next`), so both are drawn from the parts rather than joined
  // into one string.
  const run: ReactNode = g.scores.length > 1
    ? <>{g.scores.map((sc, i) => (
      <span key={i}>{i > 0 ? <Icon name="next" size={16} /> : null}{sc}</span>
    ))}{g.scoreMax ? `/${g.scoreMax}` : ''}</>
    : g.scores.length === 1
      ? `${g.scores[0]}${g.scoreMax ? `/${g.scoreMax}` : ''}`
      : null
  const span: ReactNode = g.firstTs
    ? (g.lastTs && g.lastTs !== g.firstTs
      ? <>{absTime(g.firstTs)}<Icon name="next" size={16} />{absTime(g.lastTs)}</>
      : absTime(g.firstTs))
    : 'no timestamp'
  return (
    <details className="a-dw-fold a-dw-agrp">
      <summary>
        <Icon name="forward" size={16} className="a-dw-caret" />
        <Icon name={iconFor(g.agent)} size={16} />
        <span className="a-dw-fold-k">{g.agent ?? 'Unattributed'}</span>
        {n > 1 && <span className="a-mono a-dim">×{n}</span>}
        {g.status && <Mark status={g.status}>{label(g.status)}</Mark>}
        {run && <Chip className="a-dw-run">{run}</Chip>}
        <span className="a-mono a-dim a-dw-fold-t">{span}</span>
      </summary>
      <div className="a-dw-fold-b">
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
  // last pass — what makes a stall legible is the silence on the pipeline.
  const since = gap(prev?.ts ?? null, e.ts)
  return (
    <details className="a-dw-fold a-dw-entry">
      <summary>
        <span className="a-dw-entry-h">
          <Icon name="forward" size={16} className="a-dw-caret" />
          {p.status && <Mark status={p.status}>{label(p.status)}</Mark>}
          {p.score !== null && (
            <Chip>{p.score}{p.scoreMax ? `/${p.scoreMax}` : ''}</Chip>
          )}
          {p.issues !== null && <Chip>{p.issues} issues</Chip>}
          {isBackfillEntry(e) && <Chip tone="attention">backfill</Chip>}
          {e.source && !isBackfillEntry(e) && <span className="a-meta a-dim">{label(e.source)}</span>}
          <span className="a-mono a-dim a-dw-fold-t">
            {e.ts ? absTime(e.ts) : 'no timestamp'}
            {since && <span className="a-dw-gap">{since}</span>}
          </span>
        </span>
        {/* The first LINE of the humanised body, never the first 110 characters
            of it: a QA body opens "VERDICT: NEEDS_REGENERATE (total 93/120)"
            and then runs 13,000 characters, so the line IS the summary and a
            character count would cut it mid-verdict. */}
        <span className="a-dw-entry-p">
          {p.text.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 160) || '(empty entry)'}
        </span>
      </summary>
      <div className="a-dw-fold-b">
        {e.comment_id && <span className="a-mono a-dim">{e.comment_id}</span>}
        <Well><Pre>{p.text}</Pre></Well>
        {p.rewrite && <Well><Pre>{p.rewrite}</Pre></Well>}
        {p.json && (
          <Fold label="Payload">
            <Val v={p.json} />
          </Fold>
        )}
      </div>
    </details>
  )
}

export { Block, Fold, KeyRows, Rows, Val }
