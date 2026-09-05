/* =========================================================================
   Ops (Direction B) — THE REACTION DESK, inside Ops.

   Copied from src/exp/v2c/ReactionDesk.tsx. Every hook, every write, every
   string is the original's; the card is rebuilt on Card / Chip / Button.

   Ivan, 2026-08-19: reactions belong "in ops as well instead of content
   pipeline… only if i approve it goes to ballot on mattan case — schedules for
   next slot in ivan's case".

   WHAT THIS SURFACE DELIBERATELY DOES NOT DO: offer a generated body. The
   2026-08-18 run generated 14 reaction bodies and a calibrated blind judge
   identified 14 of 14 as machine-written. The artifact and the evidence are
   automated; the answer is typed here.
   ========================================================================= */
import { AnimatePresence, motion } from 'motion/react'
import { useReactions } from '../../../hooks/useReactions'
import { canApprove, type ReactionRow } from '../../../lib/reactions'
import { Badge, Banner, Button, Card, Chip, Textarea, rise, spring, stagger } from '../../../ds'
import './ops.css'

function fmtCount(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

// Age matters more than score on this desk — an answer to a nine-day-old take
// arrives late however well it graded.
//
// The VERB is load-bearing. Only the Ivan lane stores the tweet's own
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

  // The refusal says which rule refused, rather than a dead button. It is the
  // caption now as well as the tooltip, so the reason is readable without a
  // hover the phone does not have.
  const approveWhy = ready
    ? (row.lane === 'risedtc'
      ? 'Puts it on Mattan’s board for his call — it does not schedule or publish'
      : `Schedules for ${slotLabel(nextSlot)}`)
    : 'Write the reaction first'

  return (
    <Card
      className="dirb-lift"
      /* The lane is the first thing on the card, not a footnote: the same
         take can be answerable on one lane and off-lane on the other, and
         the two Approves do completely different things. */
      lead={<Chip>{row.lane === 'risedtc' ? 'RISE' : 'Ivan'}</Chip>}
      title={ev?.who ?? (ev?.author ? '@' + ev.author : 'unknown')}
      sub={[ev?.tier_weight, age].filter(Boolean).join(' · ')}
      foot={
        <div className="opsb-actions">
          <div className="opsb-action">
            <Button variant="danger" onClick={onKill} disabled={busy}>Kill</Button>
          </div>
          <div className="opsb-action">
            <Button
              variant="primary"
              busy={busy}
              onClick={onApprove}
              disabled={busy || !ready}
              title={approveWhy}
            >
              {busy ? 'Working…' : approveLabel(row, nextSlot)}
            </Button>
            <span className="opsb-caption ds-t-meta">{approveWhy}</span>
          </div>
        </div>
      }
    >
      {/* The take, verbatim. Never summarised: what he is answering IS these
          words, and a paraphrase would quietly change the target.

          The RISE lane does not store the tweet's own text — its grader keeps
          the ANGLE it proposed instead. That is shown, labelled as the angle,
          because presenting a graded line as if it were the source's words is
          the same misattribution in a smaller font. The screenshot below
          carries the real wording either way. */}
      {ev?.excerpt
        ? <blockquote className="dirb-quote ds-t-body">{ev.excerpt}</blockquote>
        : row.raw_topic && (
          <div className="dirb-col">
            <span className="ds-t-eyebrow dirb-dim">Angle</span>
            <span className="ds-t-body">{row.raw_topic}</span>
          </div>
        )}

      {/* The controversy evidence, as the numbers that selected it. Quotes lead
          because quote-count is the signal that people are ARGUING rather than
          agreeing — the gate is quotes>=3 with (q*3+r*2)/likes>=0.3. */}
      <div className="opsb-stats ds-t-meta">
        <Chip tone="quiet">{fmtCount(ev?.quotes ?? null)} quotes</Chip>
        <Chip tone="quiet">{fmtCount(ev?.comments ?? null)} replies</Chip>
        <Chip tone="quiet">{fmtCount(ev?.likes ?? null)} likes</Chip>
        <Chip tone="quiet">{fmtCount(ev?.views ?? null)} views</Chip>
        {url && <a className="opsb-link" href={url} target="_blank" rel="noreferrer">Read the thread</a>}
      </div>

      {/* An uncaptured screenshot renders AS ABSENT. The storage list call
          answers `[]` with no error when a policy is missing, so "no shot here"
          must never be dressed up as "shot pending". */}
      {row.shot_url
        ? <img className="opsb-shot" src={row.shot_url} alt="Screenshot of the post being answered" />
        : <span className="ds-t-meta dirb-dim">No screenshot captured yet — approving posts the text alone.</span>}

      <Textarea
        label="Your reaction"
        labelHidden
        value={body}
        onChange={e => onBody(e.target.value)}
        rows={5}
        placeholder="Your answer. Nothing writes this for you."
      />
    </Card>
  )
}

export function ReactionDesk({ enabled = true }: { enabled?: boolean }) {
  const rx = useReactions(enabled)

  // Renders NOTHING when the desk is empty and healthy — Ops already carries a
  // calm-empty for its own queue, and a second "nothing here" under it reads as
  // a broken section rather than a quiet one.
  if (!rx.error && rx.rows.length === 0) return null

  return (
    <section className="dirb-block">
      <div className="dirb-block-head">
        <span className="ds-t-eyebrow">Reactions</span>
        {rx.rows.length > 0 && <Badge>{rx.rows.length}</Badge>}
      </div>
      <span className="ds-t-meta dirb-dim">
        Takes people are already arguing about. On Ivan&rsquo;s lane approving
        dates the post for the earliest free day; on RISE it goes to
        Mattan&rsquo;s board for his call. Neither publishes anything.
      </span>
      {rx.error && <Banner tone="urgent" icon="error">The reaction desk did not load: {rx.error}</Banner>}
      {rx.actionError && <Banner tone="urgent" icon="error">{rx.actionError}</Banner>}
      {rx.done && (
        <Banner tone="clear" icon="check">
          {rx.done.lane === 'risedtc'
            ? 'On Mattan’s board, waiting on him. Nothing is dated and nothing is armed.'
            : `Scheduled for ${slotLabel(rx.done.scheduledAt)}. It is a draft on the calendar, not a publish — edit it in Content like any other post.`}
        </Banner>
      )}
      <div className="dirb-cards">
        <AnimatePresence initial={false}>
          {rx.rows.map((r, i) => (
            <motion.div
              key={r.id}
              variants={rise}
              initial="hidden"
              animate="show"
              exit="exit"
              layout
              transition={{ ...spring, delay: stagger(i) }}
            >
              <ReactionCard
                row={r}
                body={rx.bodies[r.id] ?? ''}
                busy={rx.busy === r.id}
                nextSlot={rx.nextSlot}
                onBody={v => rx.setBody(r.id, v)}
                onKill={() => rx.kill(r)}
                onApprove={() => rx.approve(r)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}
