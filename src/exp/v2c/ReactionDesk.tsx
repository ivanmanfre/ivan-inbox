import { useReactions } from '../../hooks/useReactions'
import { canApprove, type ReactionRow } from '../../lib/reactions'

// THE REACTION DESK, inside Ops.
//
// Ivan, 2026-08-19: reactions belong "in ops as well instead of content
// pipeline… only if i approve it goes to ballot on mattan case — schedules for
// next slot in ivan's case".
//
// It lives in Ops rather than as a fifth Work tab for two reasons: Ops is
// already where "something needs a person" means a decision rather than an
// edit, and a fifth WORK_JOBS member overflows the work strip at 390px (the
// Strategy tab took the fourth and last seat).
//
// WHAT THIS SURFACE DELIBERATELY DOES NOT DO: offer a generated body. The
// 2026-08-18 run generated 14 reaction bodies and a calibrated blind judge
// identified 14 of 14 as machine-written. The artifact and the evidence are
// automated; the answer is typed here.

function fmtCount(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

// Age matters more than score on this desk — an answer to a nine-day-old take
// arrives late however well it graded.
function ageLine(iso: string | null, now: number): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const hours = Math.floor((now - t) / 3600000)
  if (hours < 1) return 'posted just now'
  if (hours < 24) return `posted ${hours}h ago`
  const days = Math.round(hours / 24)
  return `posted ${days}d ago`
}

function slotLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function ReactionCard({ row, body, busy, nextSlot, onBody, onKill, onApprove }: {
  row: ReactionRow
  body: string
  busy: boolean
  nextSlot: string
  onBody: (v: string) => void
  onKill: () => void
  onApprove: () => void
}) {
  const ev = row.evidence
  const url = ev?.thread_url ?? row.source_ref
  const age = ageLine(ev?.created_at ?? row.ingested_at, Date.now())
  const ready = canApprove(body)

  return (
    <div className="rx-card">
      <div className="rx-head">
        <span className="rx-who">{ev?.who ?? (ev?.author ? '@' + ev.author : 'unknown')}</span>
        {ev?.tier_weight && <span className="rx-tier">{ev.tier_weight}</span>}
        {age && <span className="rx-age">{age}</span>}
      </div>

      {/* The take, verbatim. Never summarised: what he is answering IS these
          words, and a paraphrase would quietly change the target. */}
      {ev?.excerpt && <blockquote className="rx-take">{ev.excerpt}</blockquote>}

      {/* The controversy evidence, as the numbers that selected it. Quotes lead
          because quote-count is the signal that people are ARGUING rather than
          agreeing — the gate is quotes>=3 with (q*3+r*2)/likes>=0.3. */}
      <div className="rx-stats">
        <span><b>{fmtCount(ev?.quotes ?? null)}</b> quotes</span>
        <span><b>{fmtCount(ev?.comments ?? null)}</b> replies</span>
        <span><b>{fmtCount(ev?.likes ?? null)}</b> likes</span>
        <span><b>{fmtCount(ev?.views ?? null)}</b> views</span>
        {url && <a className="rx-link" href={url} target="_blank" rel="noreferrer">Read the thread</a>}
      </div>

      {/* An uncaptured screenshot renders AS ABSENT. The storage list call
          answers `[]` with no error when a policy is missing, so "no shot here"
          must never be dressed up as "shot pending". */}
      {row.shot_url
        ? <img className="rx-shot" src={row.shot_url} alt="Screenshot of the post being answered" />
        : <div className="rx-noshot">No screenshot captured yet — approving posts the text alone.</div>}

      <textarea
        className="rx-body"
        value={body}
        onChange={e => onBody(e.target.value)}
        rows={5}
        placeholder="Your answer. Nothing writes this for you."
        aria-label="Your reaction"
      />

      <div className="rx-actions">
        <button type="button" className="btn s" onClick={onKill} disabled={busy}>Kill</button>
        <button
          type="button"
          className="btn s pri"
          onClick={onApprove}
          disabled={busy || !ready}
          // The refusal says which rule refused, rather than a dead button.
          title={ready ? `Schedules for ${slotLabel(nextSlot)}` : 'Write the reaction first'}
        >
          {busy ? 'Scheduling…' : `Approve → ${slotLabel(nextSlot)}`}
        </button>
      </div>
    </div>
  )
}

export function ReactionDesk({ enabled = true }: { enabled?: boolean }) {
  const rx = useReactions(enabled)

  // Renders NOTHING when the desk is empty and healthy — Ops already carries a
  // calm-empty for its own queue, and a second "nothing here" under it reads as
  // a broken section rather than a quiet one.
  if (!rx.error && rx.rows.length === 0) return null

  return (
    <div className="rx-desk">
      <div className="rx-desk-h">
        <span className="rx-desk-t">Reactions</span>
        {rx.rows.length > 0 && <span className="rx-desk-n">{rx.rows.length}</span>}
      </div>
      <div className="rx-desk-s">
        Takes people are already arguing about. Approving schedules the post on
        Ivan's lane for the earliest free day — it does not publish it.
      </div>
      {rx.error && <div className="rx-err">The reaction desk did not load: {rx.error}</div>}
      {rx.actionError && <div className="rx-err">{rx.actionError}</div>}
      {rx.done && (
        <div className="rx-ok">
          Scheduled for {slotLabel(rx.done.scheduledAt)}. It is a draft on the calendar, not a
          publish — edit it in Content like any other post.
        </div>
      )}
      {rx.rows.map(r => (
        <ReactionCard
          key={r.id}
          row={r}
          body={rx.bodies[r.id] ?? ''}
          busy={rx.busy === r.id}
          nextSlot={rx.nextSlot}
          onBody={v => rx.setBody(r.id, v)}
          onKill={() => rx.kill(r.id)}
          onApprove={() => rx.approve(r)}
        />
      ))}
    </div>
  )
}
