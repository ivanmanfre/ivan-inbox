/* ==========================================================================
   The Lanes home's campaigns (rebuild, blueprint v3). Every active campaign as
   a card, grouped by seat under the seat row: what each one did this week and
   how it performs. Replaces the old sent-only Campaigns table.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Card, Icon } from '../../ds'
import {
  SEATS, SEAT_NAME, acceptLine, answerLine, fetchCampaignPerf, groupBySeat, shortName,
  type CampaignPerf, type Seat,
} from '../../lib/campaignPerf'
import { ago } from '../../lib/today'
import { hasMock } from '../../exp/v2c/mock'

type Client = 'all' | Seat

export function useCampaignPerf(): { rows: CampaignPerf[] | null; error: string | null } {
  const [rows, setRows] = useState<CampaignPerf[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetchCampaignPerf()
      .then(r => { if (live) setRows(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  return { rows, error: error ?? (hasMock('fetch-error') ? 'Campaign read failed' : null) }
}

const seatsFor = (client: Client): Seat[] => (client === 'all' ? SEATS : [client])

// The answer on top of Lanes: one sentence, above the seat row.
export function AnswerLine({ perf, client }: { perf: ReturnType<typeof useCampaignPerf>; client: Client }) {
  if (perf.error) return <p className="a-camp-answer a-sev-urgent">Couldn't read this week's replies.</p>
  if (!perf.rows) return <p className="a-camp-answer a-dim">Reading this week…</p>
  return <p className="a-camp-answer">{answerLine(perf.rows, seatsFor(client))}</p>
}

function Num({ n, label }: { n: number; label: string }) {
  return (
    <div className="a-camp-num">
      <b className={n === 0 ? 'a-dim' : undefined}>{n}</b>
      <span>{label}</span>
    </div>
  )
}

function CampaignCard({ c }: { c: CampaignPerf }) {
  const tail = c.replied_7d === 0
    ? 'No replies yet.'
    : `${c.positive_7d} positive of ${c.replied_7d}.`
  return (
    <Card className="a-camp" title={shortName(c.campaign_name)} sub={c.is_active ? undefined : 'Paused'}>
      <div className="a-camp-nums">
        <Num n={c.invites_7d} label="invites" />
        <Num n={c.dms_7d} label="DMs" />
        <Num n={c.replied_7d} label="replied" />
        <Num n={c.calls_30d} label="calls 30d" />
      </div>
      <p className="a-camp-line">{tail} {acceptLine(c)}.</p>
      {c.last_send && <p className="a-camp-meta">Last send {ago(c.last_send) === 'now' ? 'just now' : `${ago(c.last_send)} ago`}</p>}
    </Card>
  )
}

function Fold({ label, rows }: { label: string; rows: CampaignPerf[] }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <div className="a-camp-fold">
      <button type="button" className="a-sends-more" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <Icon name={open ? 'minus' : 'add'} size={16} />
        {label}
      </button>
      {open && <p className="a-camp-meta">{rows.map(r => shortName(r.campaign_name)).join(' · ')}</p>}
    </div>
  )
}

export function CampaignBoard({ perf, client }: { perf: ReturnType<typeof useCampaignPerf>; client: Client }) {
  if (perf.error) {
    return (
      <section className="a-sends-sec">
        <div className="a-sends-h"><span className="a-eyebrow">Campaigns</span></div>
        <p className="a-sends-load">Couldn't read the campaigns: {perf.error}</p>
      </section>
    )
  }
  if (!perf.rows) return null
  return (
    <>
      {groupBySeat(perf.rows, seatsFor(client)).map(g => (
        <section key={g.seat} className="a-sends-sec a-camp-seat" data-seat={g.seat}>
          <div className="a-sends-h">
            <span className="a-eyebrow">{SEAT_NAME[g.seat]} campaigns</span>
            <span className="a-sends-h-s">last 7 days</span>
          </div>
          {g.shown.length === 0
            ? <p className="a-sends-empty">Nothing went out on this seat this week.</p>
            : <div className="a-camp-grid">{g.shown.map(c => <CampaignCard key={c.campaign_id} c={c} />)}</div>}
          <Fold label={`${g.quiet.length} quiet this week`} rows={g.quiet} />
          <Fold label={`${g.paused.length} paused`} rows={g.paused} />
        </section>
      ))}
    </>
  )
}
