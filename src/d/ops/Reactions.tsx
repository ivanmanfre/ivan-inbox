import { canApprove, type ReactionRow } from '../../lib/reactions'
import type { useReactions } from '../../hooks/useReactions'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { Failed } from '../ui/states'
import { Mono } from './CardContext'
import { ago } from './model'

// THE REACTION DESK, in the side column. Never a generated body (14 of 14
// generated bodies were spotted as machine-written, 08-18): the take is
// verbatim, the numbers that selected it are one mono line ("no reading" when
// absent), and the reaction box starts empty. Writes: useReactions (today's).

type Rx = ReturnType<typeof useReactions>

const fmt = (n: number | null | undefined) =>
  n == null ? 'no reading' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

function slot(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function Card({ r, rx }: { r: ReactionRow; rx: Rx }) {
  const confirm = useDConfirm()
  const ev = r.evidence
  const body = rx.bodies[r.id] ?? ''
  const ready = canApprove(body)
  const rise = r.lane === 'risedtc'
  const busy = rx.busy === r.id
  const age = ev?.created_at ? `posted ${ago(ev.created_at)}` : r.ingested_at ? `harvested ${ago(r.ingested_at)}` : ''
  const url = ev?.thread_url ?? r.source_ref
  return (
    <section className="op-rx" data-reaction={r.id}>
      <div className="op-ch"><span className="op-eb">Reaction · {rise ? 'Rise' : 'Ivan'}</span><span className="op-ew">{[ev?.who ?? (ev?.author ? '@' + ev.author : ''), ev?.tier_weight, age].filter(Boolean).join(' · ')}</span></div>
      <div className="op-rxb">
        {ev?.excerpt ? <blockquote className="op-quote">{ev.excerpt}</blockquote> : r.raw_topic ? <div className="op-note">Angle: {r.raw_topic}</div> : null}
        <Mono parts={[`${fmt(ev?.quotes)} quotes`, `${fmt(ev?.comments)} replies`, `${fmt(ev?.likes)} likes`, `${fmt(ev?.views)} views`]} />
        <Mono parts={[url && <a className="op-lk" href={url} target="_blank" rel="noreferrer">read the thread</a>, !r.shot_url && 'no screenshot yet, approving posts the text alone']} />
        {r.shot_url && <img className="op-shot" src={r.shot_url} alt="Screenshot of the post being answered" loading="lazy" />}
        <label className="op-tape">
          <span className="op-tm"><span>Your reaction</span></span>
          <textarea rows={3} value={body} onChange={e => rx.setBody(r.id, e.target.value)} placeholder="Type your take. Nothing is generated here." />
        </label>
        <div className="op-keys">
          <div className="op-k"><Key verb="kill" size="small" disabled={busy} onClick={async () => {
            if (await confirm({ title: 'Kill this reaction?', message: 'It comes off the desk for good. Nothing is posted and nothing else happens.', confirmText: 'Kill it', danger: true })) void rx.kill(r)
          }}>Kill</Key></div>
          <div className="op-k op-kp"><Key primary verb="reaction-approve" size="small" disabled={busy || !ready} onClick={async () => {
            if (await confirm({
              title: rise ? 'Put this on Mattan’s board?' : 'Date this reaction as a draft?',
              message: rise ? 'It waits there for his call. Nothing is dated and nothing is posted.' : `It lands on the calendar for ${slot(rx.nextSlot)} as a draft. Nothing is posted.`,
              confirmText: 'Approve',
            })) void rx.approve(r)
          }}>{busy ? 'Working…' : rise ? 'Approve → Mattan’s board' : `Approve → ${slot(rx.nextSlot)}`}</Key>
            <small>{ready ? (rise ? 'On his board, not published.' : `Schedules for ${slot(rx.nextSlot)}.`) : 'Write the reaction first.'}</small></div>
        </div>
      </div>
    </section>
  )
}

export function Reactions({ rx }: { rx: Rx }) {
  return (
    <section className="op-rxs" aria-label="Reactions">
      <div className="op-sec"><span>Reactions <b className={rx.rows.length ? '' : 'op-dim'}>{rx.loading && rx.rows.length === 0 ? '…' : rx.rows.length}</b></span></div>
      {(rx.rows.length > 0 || rx.error) && <p className="op-quiet op-pad">Takes people are already arguing about. On Ivan’s lane approving dates the post for the earliest free day; on Rise it goes to Mattan’s board for his call. Neither publishes anything.</p>}
      {rx.error && <Failed what="the reaction desk" detail={rx.error} onRetry={rx.refresh} />}
      {rx.actionError && <div className="op-err op-pad">{rx.actionError}</div>}
      {rx.done && <div className="op-ban op-pad">{rx.done.lane === 'risedtc'
        ? 'On Mattan’s board, waiting on him. Nothing is dated and nothing is armed.'
        : `Scheduled for ${slot(rx.done.scheduledAt)}. A draft on the calendar, not a publish.`}</div>}
      {!rx.error && !rx.loading && rx.rows.length === 0 && <div className="op-quiet">No reaction waiting. A take lands here only after it clears the reaction gate.</div>}
      {rx.rows.map(r => <Card key={r.id} r={r} rx={rx} />)}
    </section>
  )
}
