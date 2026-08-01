import {
  isBackfillEntry, parseLogEntry, scoreProgression,
  type AgentLogEntry, type QaSummary,
} from '../../lib/content'
import { Block, KeyRows, Rows, Val } from './ContentBits'
import { absTime } from './fmt'

// The two registers.
//
// A register is a DOCUMENT, not a card: nothing here is truncated, clamped, or
// hidden behind "Show more". The shipped pane clamped every log body to 5 lines
// and read 3 of the 23 live `qa` keys, which is how a rewrite that changed what
// actually shipped could sit in the row and be invisible on every surface.

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
  const named = log.filter(e => e.agent).length
  const backfilled = log.filter(isBackfillEntry).length
  const delta = steps.length > 1 ? steps[steps.length - 1].score - steps[0].score : null

  return (
    <Block label="Generation register" tail={`${log.length} entries`}>
      <div className="ct-subtle">
        {named} of {log.length} entries name the agent that wrote them
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

      <div className="dd-card">
        {log.map((e, i) => {
          const p = parseLogEntry(e)
          const since = gap(log[i - 1]?.ts ?? null, e.ts)
          return (
            <div className="dd-log" key={i}>
              <div className="dd-log-h">
                {/* WHO. Unknown names render as themselves — the roster is
                    enumerated from the data, never hardcoded. */}
                <span className="dd-log-agent">{e.agent ?? 'Unattributed'}</span>
                {p.status && <span className={chipClass(p.status)}>{p.status}</span>}
                {p.score !== null && (
                  <span className="ct-chip">{p.score}{p.scoreMax ? `/${p.scoreMax}` : ''}</span>
                )}
                {p.issues !== null && <span className="ct-chip">{p.issues} issues</span>}
                {isBackfillEntry(e) && <span className="ct-chip ct-chip-warn">backfill</span>}
                {e.source && !isBackfillEntry(e) && <span className="dd-log-src">{e.source}</span>}
              </div>
              <div className="dd-log-ts">
                {e.ts ? absTime(e.ts) : 'no timestamp'}
                {/* Elapsed since the previous entry is what makes a stall
                    legible — the proof row opens on a Stuck Sentinel entry 23
                    minutes into silence. */}
                {since && <span className="dd-log-gap">{since}</span>}
                {e.comment_id && <span className="dd-log-gap">{e.comment_id}</span>}
              </div>
              {/* In full. No clamp, no "Show more" — this is the register. */}
              <div className="dd-body dd-pre">{p.text}</div>
              {p.rewrite && (
                <div className="dd-log-rw"><div className="dd-body dd-pre">{p.rewrite}</div></div>
              )}
              {p.json && (
                // The raw payload stays reachable IN PLACE rather than being
                // dropped: the dashboard slims it because it truncates to 160
                // characters, and this surface does not truncate.
                <details className="dd-log-raw">
                  <summary>payload</summary>
                  <Val v={p.json} />
                </details>
              )}
            </div>
          )
        })}
      </div>
    </Block>
  )
}
