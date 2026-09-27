/* ==========================================================================
   The campaign sheet (rebuild, blueprint v3): what opens when you tap a
   campaign card on Lanes. Read-only.
   - Reply rate per DM step against the prior 60 days, drift alarms and the
     DM variants. These come from outreach_perf_payload, which measures per
     LANE, so the sheet names every campaign that shares the lane.
   - The source, country and vertical split for the lane's biggest step.
   - This campaign's newest sends, every kind.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Chip, EmptyState, Sheet } from '../../ds'
import { Group, Row, Rows } from '../kit'
import { Linkified } from '../chrome/Linkified'
import { Cells, Variants } from '../content/OutreachBlock'
import { SendsSkeleton } from '../chrome/Skeleton'
import {
  SEAT_NAME, acceptLine, shortName, type CampaignPerf, type Seat,
} from '../../lib/campaignPerf'
import { alarmLine, loadPerf, pct, stepLabel, type PerfLane, type PerfSplit, type PerfState } from '../../lib/outreachPerf'
import { fetchCampaignRecent, type CampaignRecentSend } from '../../lib/sends'
import { ago } from '../../lib/today'
import '../content/outreach-perf.css'
import '../content/strategy-evidence.css'

const KIND: Record<string, string> = { connection_note: 'Invite note', dm: 'DM', inmail: 'InMail', email: 'Email' }
const DIM: Record<string, string> = { source: 'Source', country: 'Country', vertical: 'Vertical' }

type Load<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }

// Per dimension, the busiest values of the lane's biggest step. The variant
// dimension is left out: the variant list already carries it.
export function splitsFor(l: PerfLane): { step: string; dims: { dim: string; rows: PerfSplit[] }[] } | null {
  const step = [...l.cells].sort((a, b) => b.n - a.n)[0]?.step
  if (!step) return null
  const dims = (['source', 'country', 'vertical'] as const)
    .map(dim => ({
      dim,
      rows: l.splits.filter(s => s.step === step && s.dim === dim && s.value !== 'unknown')
        .sort((a, b) => b.n - a.n).slice(0, 4),
    }))
    .filter(d => d.rows.length > 0)
  return dims.length ? { step, dims } : null
}

export function laneOf(state: PerfState, campaign: string): PerfLane | null {
  if (state.kind !== 'ready') return null
  return state.data.lanes.find(l => l.campaigns.includes(campaign)) ?? null
}

function Performance({ state, c }: { state: PerfState; c: CampaignPerf }) {
  if (state.kind === 'loading') return <p className="a-camp-meta">Reading reply rates…</p>
  if (state.kind === 'failed') return <p className="a-camp-meta a-sev-urgent">Couldn't read reply rates: {state.message}</p>
  const lane = laneOf(state, c.campaign_name)
  if (!lane) {
    return <p className="a-camp-meta">No DM from this campaign is old enough to judge yet. A DM counts 7 days after it went out.</p>
  }
  const others = lane.campaigns.filter(n => n !== c.campaign_name).map(shortName)
  const split = splitsFor(lane)
  return (
    <>
      <p className="a-camp-meta">
        Measured on the {lane.lane} lane{others.length ? `, shared with ${others.join(', ')}` : ''}. Last 14 matured days against the 60 before.
      </p>
      {lane.alarms.map((a, i) => (
        <div className="a-op-card a-op-alarm" key={`${a.kind}-${a.step}-${a.variant ?? ''}-${i}`}>
          <div className="a-op-h">{stepLabel(a.step)}{a.variant ? ` · ${a.variant}` : ''} is below {a.kind === 'drift' ? 'its prior 60 days' : 'its siblings'}</div>
          <div className="a-op-line">{alarmLine(a)}</div>
        </div>
      ))}
      <Cells l={lane} />
      {lane.variants.length > 0 && (
        <details className="a-strategy-disclosure a-camp-variants">
          <summary>{lane.variants.length} copy variants</summary>
          <Variants l={lane} />
        </details>
      )}
      {split && (
        <div className="a-camp-split">
          <div className="a-camp-meta">Who got {stepLabel(split.step)}, and who replied</div>
          {split.dims.map(d => (
            <div key={d.dim}>
              <div className="a-camp-dim">{DIM[d.dim] ?? d.dim}</div>
              <ul className="a-op-split" aria-label={DIM[d.dim] ?? d.dim}>
                {d.rows.map(s => (
                  <li key={s.value}><span>{s.value}</span><span>{s.replies} of {s.n} ({pct(s.rate)})</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Sends({ load }: { load: Load<CampaignRecentSend[]> }) {
  if (load.kind === 'loading') return <SendsSkeleton />
  if (load.kind === 'failed') return <EmptyState icon="error" title={`Couldn't read the sends: ${load.message}`} />
  if (load.data.length === 0) return <EmptyState icon="sends" title="Nothing sent from this campaign yet." />
  return (
    <Rows>
      {load.data.map(m => (
        <Row
          key={m.id}
          title={m.prospect_name}
          tail={<><Chip tone="quiet">{KIND[m.message_type] ?? m.message_type}</Chip> <span className="a-mono a-dim">{ago(m.sent_at)}</span></>}
        >
          {m.message_text
            ? <span className="a-body-t a-pre a-log-msg"><Linkified text={m.message_text} /></span>
            : <span className="a-dim">No note</span>}
        </Row>
      ))}
    </Rows>
  )
}

export function CampaignSheet({ c, onClose }: { c: CampaignPerf | null; onClose: () => void }) {
  const [perf, setPerf] = useState<PerfState>({ kind: 'loading' })
  const [sends, setSends] = useState<Load<CampaignRecentSend[]>>({ kind: 'loading' })
  const name = c?.campaign_name
  const seat = c?.client_id as Seat | undefined

  useEffect(() => {
    if (!name || !seat) return
    let live = true
    setPerf({ kind: 'loading' }); setSends({ kind: 'loading' })
    void loadPerf(seat).then(s => { if (live) setPerf(s) })
    fetchCampaignRecent(name)
      .then(data => { if (live) setSends({ kind: 'ready', data }) })
      .catch(e => { if (live) setSends({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
  }, [name, seat])

  // Portaled: the lane keeps its own stacking context, which put the dock
  // over the sheet's bottom.
  const sheet = (
    <Sheet
      open={c !== null}
      onClose={onClose}
      className="a-camp-sheet"
      title={c ? shortName(c.campaign_name) : ''}
      sub={c ? `${SEAT_NAME[c.client_id as Seat] ?? c.client_id} · ${c.is_active ? 'Active' : 'Paused'}` : undefined}
    >
      {c && (
        <>
          <p className="a-camp-line">
            This week: {c.invites_7d} invites, {c.dms_7d} DMs, {c.replied_7d} replied ({c.positive_7d} positive). {c.calls_30d} calls in 30 days. {acceptLine(c)}.
          </p>
          <Group label="Reply rate by DM step" pad>
            <Performance state={perf} c={c} />
          </Group>
          <Group label="Newest sends" tail={sends.kind === 'ready' ? `${sends.data.length}` : undefined}>
            <Sends load={sends} />
          </Group>
        </>
      )}
    </Sheet>
  )
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)
}
