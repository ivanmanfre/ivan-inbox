/* ==========================================================================
   Direction A · the reaction desk (S12-36 to S12-47).

   Ivan, 2026-08-19: reactions belong "in ops as well instead of content
   pipeline… only if i approve it goes to ballot on mattan case — schedules for
   next slot in ivan's case".

   WHAT THIS SURFACE DELIBERATELY DOES NOT DO: offer a generated body. The
   2026-08-18 run generated 14 reaction bodies and a calibrated blind judge
   identified 14 of 14 as machine-written. The artifact and the evidence are
   automated; the answer is typed here.

   Direction A's move: the four controversy counts become a LEDGER — one ruled
   block of cells sharing a baseline, each number under its own predicate — and
   an absent count is SAID ("No reading"), never drawn as a dash.
   ========================================================================== */
import { canApprove, type ReactionRow } from '../../lib/reactions'
import type { useReactions } from '../../hooks/useReactions'
import { Badge, Banner, Button, Textarea } from '../../ds'
import { Cell, Group, Ledger, Sep } from '../kit'
import './ops.css'

export type ReactionsState = ReturnType<typeof useReactions>

function fmtCount(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

/** The count as a ledger value: absent is said, not drawn. */
function countValue(n: number | null | undefined): string | undefined {
  return n === null || n === undefined ? undefined : fmtCount(n)
}

// Age matters more than score on this desk — an answer to a nine-day-old take
// arrives late however well it graded.
//
// 🔴 The VERB is load-bearing. Only the Ivan lane stores the tweet's own
// timestamp; RISE rows carry the row's created_at and nothing else. Labelling
// that "posted 2h ago" would state a fact about the tweet that the row does not
// know — a week-old take would read as fresh. When the source time is unknown
// the card says when WE found it, and says so in those words.
function ageLine(iso: string | null, now: number, verb: 'posted' | 'harvested'): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const hours = Math.floor((now - t) / 3600000)
  if (hours < 1) return `${verb} just now`
  if (hours < 24) return `${verb} ${hours}h ago`
  const days = Math.round(hours / 24)
  return `${verb} ${days}d ago`
}

function slotLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// What Approve does, in the lane's own terms. Two different terminal states
// share one button, so the button says which one it is BEFORE the click rather
// than reporting it after.
function approveLabel(row: ReactionRow, nextSlot: string): string {
  return row.lane === 'risedtc'
    ? 'Approve → Mattan’s board'
    : `Approve → ${slotLabel(nextSlot)}`
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
  const age = ev?.created_at
    ? ageLine(ev.created_at, Date.now(), 'posted')
    : ageLine(row.ingested_at, Date.now(), 'harvested')
  const ready = canApprove(body)
  // The refusal says which rule refused, rather than a dead button.
  const why = ready
    ? (row.lane === 'risedtc'
      ? 'Puts it on Mattan’s board for his call — it does not schedule or publish'
      : `Schedules for ${slotLabel(nextSlot)}`)
    : 'Write the reaction first'

  return (
    <Group
      className="a-ops-rx"
      /* The lane is the first thing on the card, not a footnote: the same take
         can be answerable on one lane and off-lane on the other, and the two
         Approves do completely different things. */
      label={row.lane === 'risedtc' ? 'RISE' : 'Ivan'}
      tail={
        <>
          {ev?.who ?? (ev?.author ? '@' + ev.author : 'unknown')}
          {ev?.tier_weight && <><Sep />{ev.tier_weight}</>}
          {age && <><Sep />{age}</>}
        </>
      }
      foot={
        <div className="a-ops-decide">
          <div className="a-ops-acts">
            <div className="a-ops-act">
              <Button variant="quiet" onClick={onKill} disabled={busy}>Kill</Button>
            </div>
            <div className="a-ops-act a-ops-act-p">
              <Button variant="primary" onClick={onApprove} disabled={busy || !ready} busy={busy} title={why}>
                {busy ? 'Working…' : approveLabel(row, nextSlot)}
              </Button>
              <span className="a-ops-cons a-meta">{why}</span>
            </div>
          </div>
        </div>
      }
      pad
    >
      <div className="a-stack" data-tight>
        {/* The take, verbatim. Never summarised: what he is answering IS these
            words, and a paraphrase would quietly change the target.

            The RISE lane does not store the tweet's own text — its grader keeps
            the ANGLE it proposed instead. That is shown, labelled as the angle,
            because presenting a graded line as if it were the source's words is
            the same misattribution in a smaller font. The screenshot below
            carries the real wording either way. */}
        {ev?.excerpt
          ? <blockquote className="a-quote">{ev.excerpt}</blockquote>
          : row.raw_topic && (
            <div className="a-ops-angle">
              <span className="a-eyebrow">Angle</span>
              <span className="a-body-t">{row.raw_topic}</span>
            </div>
          )}

        {/* The controversy evidence, as the numbers that selected it. Quotes lead
            because quote-count is the signal that people are ARGUING rather than
            agreeing — the gate is quotes>=3 with (q*3+r*2)/likes>=0.3. */}
        <Ledger>
          <Cell label="quotes" value={countValue(ev?.quotes)} />
          <Cell label="replies" value={countValue(ev?.comments)} />
          <Cell label="likes" value={countValue(ev?.likes)} />
          <Cell label="views" value={countValue(ev?.views)} />
        </Ledger>
        {url && <a className="a-link" href={url} target="_blank" rel="noreferrer">Read the thread</a>}

        {/* An uncaptured screenshot renders AS ABSENT. The storage list call
            answers `[]` with no error when a policy is missing, so "no shot here"
            must never be dressed up as "shot pending". */}
        {row.shot_url
          ? <img className="a-ops-shot" src={row.shot_url} alt="Screenshot of the post being answered" />
          : <div className="a-meta a-dim">No screenshot captured yet — approving posts the text alone.</div>}

        <Textarea
          label="Your reaction"
          labelHidden
          className="a-ops-body"
          value={body}
          onChange={e => onBody(e.target.value)}
          rows={5}
          placeholder="Your answer. Nothing writes this for you."
        />
      </div>
    </Group>
  )
}

/**
 * Renders NOTHING when the desk is empty and healthy — Ops already carries a
 * calm-empty for its own queue, and a second "nothing here" under it reads as a
 * broken section rather than a quiet one. The state is held by the board (one
 * `useReactions`), so the board can also tell whether this column has anything
 * in it before it draws a column.
 */
export function ReactionDesk({ rx }: { rx: ReactionsState }) {
  if (!rx.error && rx.rows.length === 0) return null

  return (
    <div className="a-stack" data-tight>
      <Group
        label="Reactions"
        tail={rx.rows.length > 0 ? <Badge variant="ring" label={`${rx.rows.length} waiting`}>{rx.rows.length}</Badge> : undefined}
        pad
      >
        <div className="a-body-t">
          Takes people are already arguing about. On Ivan&rsquo;s lane approving
          dates the post for the earliest free day; on RISE it goes to
          Mattan&rsquo;s board for his call. Neither publishes anything.
        </div>
      </Group>
      {rx.error && <Banner tone="urgent" icon="error">The reaction desk did not load: {rx.error}</Banner>}
      {rx.actionError && <Banner tone="urgent" icon="error">{rx.actionError}</Banner>}
      {rx.done && (
        <Banner tone="clear" icon="check">
          {rx.done.lane === 'risedtc'
            ? 'On Mattan’s board, waiting on him. Nothing is dated and nothing is armed.'
            : `Scheduled for ${slotLabel(rx.done.scheduledAt)}. It is a draft on the calendar, not a publish — edit it in Content like any other post.`}
        </Banner>
      )}
      {rx.rows.map(r => (
        <ReactionCard
          key={r.id}
          row={r}
          body={rx.bodies[r.id] ?? ''}
          busy={rx.busy === r.id}
          nextSlot={rx.nextSlot}
          onBody={v => rx.setBody(r.id, v)}
          onKill={() => rx.kill(r)}
          onApprove={() => rx.approve(r)}
        />
      ))}
    </div>
  )
}
