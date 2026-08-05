import {
  groupLogByAgent, isBackfillEntry, parseLogEntry, scoreProgression,
  type AgentGroup, type AgentLogEntry, type QaSummary,
} from '../../lib/content'
import { Block, KeyRows, Rows, Val } from './ContentBits'
import { absTime } from './fmt'

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

export function QaRegister({ qa }: { qa: QaSummary }) {
  const provenance: [string, React.ReactNode][] = []
  if (qa.iteration !== null) provenance.push(['Iteration', qa.iteration])
  if (qa.originalVerdict) provenance.push(['Original verdict', qa.originalVerdict])
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
            <span className={`ct-chip ${qa.pass ? 'ct-chip-ok' : 'ct-chip-warn'}`}>{qa.verdict}</span>
          )}
          <div className="wb-qa-g">
            <span className="wb-qa-fill" style={{
              width: `${Math.max(0, Math.min(100, qa.score ?? 0))}%`,
              background: qa.pass ? 'var(--accent)' : '#FF9F0A',
            }} />
          </div>
        </div>
      </div>

      {/* Verbatim, never re-derived: a live row carries verdict:'PASS' with
          feedback opening "VERDICT: REWRITE_OK", and the contradiction is the
          information. */}
      {qa.feedback && (
        <div className="dd-card"><div className="dd-body dd-pre">{qa.feedback}</div></div>
      )}

      {qa.rewriteText && (
        // 🔴 What actually SHIPPED when a gate rewrote the post — present on 150
        // rows and dropped by every surface until now. This is the voice-drift
        // blind spot the dashboard's QA panel exists to close.
        <Block
          label="The applied rewrite"
          // The field's own name and value, not a sentence about it: what
          // rewrite_total counts is the gate's business, and paraphrasing it
          // ("75 rewritten") invents a unit.
          tail={qa.rewriteTotal !== null ? `rewrite_total ${qa.rewriteTotal}` : undefined}
        >
          <div className="ct-subtle">
            This is the copy the gate substituted. It is what published, not the
            draft body above it.
          </div>
          <div className="dd-card"><div className="dd-body dd-pre">{qa.rewriteText}</div></div>
        </Block>
      )}

      {qa.regenerateInstruction && (
        <Block label="Regeneration instruction">
          <div className="dd-card"><div className="dd-body dd-pre">{qa.regenerateInstruction}</div></div>
        </Block>
      )}

      {(qa.regenHistory.length > 0 || qa.regenAttempts !== null) && (
        <Block
          label="Regeneration history"
          tail={qa.regenAttempts !== null ? `${qa.regenAttempts} attempts` : undefined}
        >
          {qa.regenHistory.length > 0 ? (
            <div className="dd-card">
              {qa.regenHistory.map((h, i) => (
                <div className="dd-log" key={i}>
                  <div className="dd-log-h">
                    <span className="dd-log-agent">Attempt {h.iteration ?? i + 1}</span>
                    {h.verdict && <span className={chipClass(h.verdict.toUpperCase())}>{h.verdict}</span>}
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
        </Block>
      )}

      {qa.gates.length > 0 && (
        <Block label="Gate detail"><KeyRows items={qa.gates} /></Block>
      )}

      {provenance.length > 0 && (
        <Block label="Verdict provenance"><Rows items={provenance} /></Block>
      )}

      {/* Every qa key this code does not name. ~23 are live and the generator
          adds more; an unnamed key appears the day it appears. */}
      {qa.rest.length > 0 && (
        <Block label="Other QA fields"><KeyRows items={qa.rest} /></Block>
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
  const delta = steps.length > 1 ? steps[steps.length - 1].score - steps[0].score : null

  return (
    <Block
      label="Generation register"
      tail={`${groups.length} agent${groups.length === 1 ? '' : 's'} · ${log.length} entries`}
    >
      {backfilled > 0 && (
        <div className="ct-subtle">
          {backfilled} of {log.length} entries were reconstructed from ClickUp, not live agent steps
        </div>
      )}

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
    </Block>
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
