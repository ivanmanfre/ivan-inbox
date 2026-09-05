/* =========================================================================
   S09 — `SendsScreen`, Direction B ("surface").

   Same props, same state, same fetches, same strings as
   `src/screens/SendsScreen.tsx`. This file is the SHELL: the masthead, the
   client scope, the sub-view switch and the window control. Only the Overview
   sub-view is rebuilt (./overview); Lanes and Log render the shipped views,
   unchanged, out of ./legacy.

   The two moves that are this direction's:
   - the sub-view switch is one `Segmented` whose selected pill is a
     shared-layout marker, so moving between Lanes, Overview and Log is one
     object travelling rather than three fills swapping.
   - the window control is the same three values on the same handler, drawn as
     a second `Segmented` instead of a pill that opens a menu over the page.
   ========================================================================= */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildLanes, fetchSends, fetchSendsDaily,
  type LaneKey,
} from '../../../lib/sends'
import {
  buildInboundLanes, fetchInbound, fetchInboundDaily,
  type InboundLaneKey,
} from '../../../lib/inbound'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import {
  Banner, Chip, Header, IconButton, Input, Segmented, SkeletonRows,
} from '../../../ds'
import { DirB } from '../shell'
import { OverviewView } from './overview'
import { InboundDetail, LaneDetail, LanesView, LogView } from './legacy'
import './sends.css'

type Client = 'all' | 'ivan' | 'risedtc' | 'arch'
type Timeframe = '7d' | '30d' | 'custom'

const ARROW = '\u2192'
const ELL = '\u2026'

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'custom', label: 'Custom' },
]

const CHIPS: { key: Client; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
  { key: 'arch', label: 'Arch' },
]

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'log', label: 'Log' },
]

export function SendsScreen({ client, setClient }: {
  client: Client
  setClient: (c: Client) => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSends>>>([])
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof fetchSendsDaily>>>([])
  const [inRows, setInRows] = useState<Awaited<ReturnType<typeof fetchInbound>>>([])
  const [inDaily, setInDaily] = useState<Awaited<ReturnType<typeof fetchInboundDaily>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLane, setOpenLane] = useState<LaneKey | null>(null)
  const [openInbound, setOpenInbound] = useState<InboundLaneKey | null>(null)
  const [view, setView] = useState<'overview' | 'lanes' | 'log'>('overview')
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const [rangeFrom, setRangeFrom] = useState('2026-07-11')
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10))
  const rowsRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, d] = await Promise.all([fetchSends(), fetchSendsDaily()])
      setRows(r)
      setDaily(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
    // Deliberately NOT in the Promise.all above and deliberately not throwing. The inbound
    // views are new (db/040); if they fail to read, the outbound lanes that have worked
    // for weeks must still render. An empty Inbound group is a smaller lie than a blank
    // screen, and buildInboundLanes turns [] into two honest `off` rows.
    try {
      const [ir, id] = await Promise.all([fetchInbound(), fetchInboundDaily()])
      setInRows(ir)
      setInDaily(id)
    } catch { /* leaves the inbound group reading `off` */ }
  }, [])

  useEffect(() => { load() }, [load])
  const ptr = usePullToRefresh(rowsRef, load)

  const lanes = buildLanes(rows, daily, client)
  const inbound = buildInboundLanes(inRows, inDaily, client)
  const detailLane = openLane ? lanes.find(l => l.key === openLane) ?? null : null
  const detailInbound = openInbound ? inbound.find(l => l.key === openInbound) ?? null : null

  if (detailLane) {
    return <LaneDetail lane={detailLane} client={client} onBack={() => setOpenLane(null)} />
  }
  if (detailInbound) {
    return <InboundDetail lane={detailInbound} client={client} onBack={() => setOpenInbound(null)} />
  }

  return (
    <DirB>
      {/* Renamed from "Sends" 2026-08-23: the screen carries inbound automations now,
          and a tab called Sends would hide exactly the half Ivan could not see. */}
      <Header
        title="Lanes"
        sub="Outreach and inbound, per client"
        tail={<IconButton icon="refresh" label="Refresh" onClick={load} />}
      >
        <div className="s09-chips">
          {CHIPS.map(c => (
            <Chip
              key={c.key}
              tone="quiet"
              selected={client === c.key}
              onClick={() => setClient(c.key)}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </Header>

      <div className="dirb-block" style={{ padding: 'var(--ds-s3) var(--ds-gutter) 0' }}>
        <Segmented
          label="Sub-view"
          markerId="s09-view"
          block
          options={VIEWS}
          value={view}
          onChange={v => setView(v as 'overview' | 'lanes' | 'log')}
        />
        {/* GRAFT (phase 6 ask 8b, from candidate `split`): the range control was a
            SECOND full-width segmented row stacked under the view switcher. It is
            one labelled control now, and the label is never omitted: the VALUE is
            the active state, never a coloured fill. */}
        {view === 'overview' && (
          <div className="s09-range">
            <span className="ds-t-eyebrow">Range</span>
            <Segmented
              label="The window every figure below is computed over"
              markerId="s09-range"
              options={TIMEFRAMES.map(t => ({ id: t.key, label: t.label }))}
              value={timeframe}
              onChange={t => setTimeframe(t as Timeframe)}
            />
          </div>
        )}
        {/* The custom date pair stays: it is a value editor, not a second filter
            chrome, and only appears once the control has already chosen `Custom`. */}
        {view === 'overview' && timeframe === 'custom' && (
          <div className="s09-range">
            <Input
              type="date" value={rangeFrom} max={rangeTo}
              label="From" labelHidden
              onChange={e => setRangeFrom(e.target.value)}
            />
            <span className="dirb-dim" aria-hidden="true">{ARROW}</span>
            <Input
              type="date" value={rangeTo} min={rangeFrom}
              label="To" labelHidden
              onChange={e => setRangeTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {view === 'overview' ? (
        <OverviewView
          client={client} timeframe={timeframe} setClient={setClient}
          range={timeframe === 'custom' ? { from: rangeFrom, to: rangeTo } : null}
        />
      ) : view === 'log' ? (
        <LogView client={client} />
      ) : loading && rows.length === 0 ? (
        <SkeletonRows rows={5} label={`Loading${ELL}`} />
      ) : error ? (
        <Banner tone="urgent" icon="error" title={error} />
      ) : (
        <LanesView
          lanes={lanes}
          inbound={inbound}
          rowsRef={rowsRef}
          ptr={ptr}
          onOpenLane={setOpenLane}
          onOpenInbound={setOpenInbound}
        />
      )}
    </DirB>
  )
}
