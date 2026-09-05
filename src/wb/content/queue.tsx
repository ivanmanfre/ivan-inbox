/* ==========================================================================
   The publish queue, the pillar mix, and the in-flight mark.

   Copied from `src/exp/v2c/ContentSections.tsx` (QueueRow / QueueStrip /
   PillarMix / InFlight). The publish queue is a MIRROR of the bridge's output
   and never a control: flipping a draft to scheduled is what makes the
   publisher post it, so nothing in this section writes that status. Unpublish
   goes the other way and cannot trigger a send.
   ========================================================================== */
import { useState } from 'react'
import {
  queueFailed, STUCK_GENERATING_MINUTES, taxonomyFields, unpublishPost,
  type ContentDraft, type ScheduledQueueRow,
} from '../../lib/content'
import {
  applyFilters, buildFacets, QUEUE_PROMINENT, QUEUE_SPECS, splitFacets,
  type FilterState,
} from '../../lib/contentFilters'
import { useConfirm } from '../chrome/ConfirmSheet'
import { relOrAhead, relTime } from '../../exp/v2c/fmt'
import { label } from '../../lib/labels'
import { Button, Icon, IconButton } from '../../ds'
import { Dot, Group, Row, Rows, Sep } from '../kit'
import { CalmEmpty, Failed, Figure, FilteredEmpty } from './parts'
import { FilterRow } from './filters'
import './content.css'

function QueueRow({ r, refresh }: { r: ScheduledQueueRow; refresh: () => void }) {
  const text = (r.post_text ?? '').trim().split('\n')[0] || 'No post text'
  const confirm = useConfirm()
  const [pulling, setPulling] = useState(false)
  const [pullErr, setPullErr] = useState('')
  async function onUnpublish() {
    const ok = await confirm({
      title: 'Take this post off LinkedIn?',
      message: 'Deletes it from your feed for everyone, likes and comments included. The row moves to cancelled here. This cannot be undone.',
      confirmText: 'Unpublish',
      danger: true,
    })
    if (!ok) return
    setPulling(true); setPullErr('')
    try { await unpublishPost(r.id); refresh() }
    catch (e) { setPullErr(e instanceof Error ? e.message : String(e)) }
    finally { setPulling(false) }
  }
  const bad = queueFailed(r)
  return (
    <Row
      className="a-ct-qrow"
      sev={bad ? 'urgent' : undefined}
      lead={<Dot tone={r.status === 'posted' ? 'clear' : bad ? 'urgent' : undefined} />}
      title={text.slice(0, 120)}
      titleWrap
      meta={
        <>
          <span className={r.status === 'posted' ? 'a-sev-clear' : bad ? 'a-sev-urgent' : undefined}>
            {label(r.status)}
          </span>
          {r.post_kind && <><Sep /><span>{label(r.post_kind)}</span></>}
          {r.platform && <><Sep /><span>{label(r.platform)}</span></>}
          {r.is_repost === true && <><Sep /><span>repost</span></>}
        </>
      }
      sub={
        (r.error_message || pullErr) ? (
          <span className="a-ct-subs">
            {r.error_message && <span className="a-ct-err">{r.error_message}</span>}
            {pullErr && <span className="a-ct-err">{pullErr}</span>}
          </span>
        ) : undefined
      }
      subWrap
      tail={
        r.posted_at
          ? <span className="a-dim">posted {relTime(r.posted_at)}</span>
          : r.scheduled_at ? <span className="a-dim">{relOrAhead(r.scheduled_at)}</span> : undefined
      }
      actions={
        <>
          {r.unipile_share_url && (
            <a className="a-link a-wrapline" href={r.unipile_share_url} target="_blank" rel="noreferrer">
              live <Icon name="external" size={16} />
            </a>
          )}
          {r.status === 'posted' && r.unipile_share_url && (
            <Button variant="danger" size="sm" busy={pulling} onClick={onUnpublish}>
              {pulling ? 'Removing…' : 'unpublish'}
            </Button>
          )}
        </>
      }
    />
  )
}

export function QueueStrip({ rows, loading, error, loadedAt, refresh }: {
  rows: ScheduledQueueRow[]
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  const { prominent: queueProminent, demoted: queueDemoted } =
    splitFacets(buildFacets(rows, QUEUE_SPECS), QUEUE_PROMINENT)
  const shown = applyFilters(rows, QUEUE_SPECS, filters)
  if (error) return <Failed what="The publish queue" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="a-ct-sub">Reading scheduled_posts…</div>
  if (rows.length === 0) return <CalmEmpty line="Nothing in the publish queue." loadedAt={loadedAt} />
  return (
    <Group label="Publish queue" tail={rows.length}>
      <div className="a-ct-bandline">
        <FilterRow
          prominent={queueProminent} demoted={queueDemoted}
          state={filters} setState={setFilters}
          shown={shown.length} loaded={rows.length} total={null} noun="queue rows"
          inline
        />
      </div>
      {shown.length === 0
        ? <FilteredEmpty noun="queue rows" onClear={() => setFilters({})} />
        : <Rows>{shown.slice(0, 60).map(r => <QueueRow key={r.id} r={r} refresh={refresh} />)}</Rows>}
      {shown.length > 60 && (
        <div className="a-ct-sub">Showing the 60 most recent of {shown.length} matching rows.</div>
      )}
    </Group>
  )
}

// ---------------------------------------------------------------------------
// Pillar mix — Ivan lane only, with its own denominator
// ---------------------------------------------------------------------------

// The strategy's target constant is Title Case; the stored values are lowercase
// snake. Keying on the raw value and mapping to a label is the whole fix —
// comparing to the constant directly scores every pillar at 0%.
const PILLAR_TARGETS: [string, string, number][] = [
  ['translator', 'Translator', 30],
  ['methodology', 'Methodology', 25],
  ['teardown', 'Teardown', 15],
  ['case_study', 'Case Study', 20],
  ['personal', 'Personal', 10],
]

export function PillarMix({ rows }: { rows: ContentDraft[] }) {
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  let withPillar = 0
  for (const r of rows) {
    const p = taxonomyFields(r.taxonomy).pillar
    if (!p) continue
    withPillar += 1
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  if (withPillar === 0) return null
  const extra = [...counts.keys()].filter(k => !PILLAR_TARGETS.some(([raw]) => raw === k))
  return (
    <Group
      label="Pillar mix"
      tail={
        <>
          <Figure n={withPillar} of={rows.length} label="rows carry a pillar" />
          <IconButton
            icon={open ? 'discloseUp' : 'disclose'}
            label={open ? 'Hide the pillar mix' : 'Show the pillar mix'}
            size="sm"
            onClick={() => setOpen(o => !o)}
          />
        </>
      }
    >
      {open && (
        <>
          <div className="a-group-pad a-stack" data-tight>
            {[...PILLAR_TARGETS.map(([raw, name, target]) => ({ raw, name, target })),
            ...extra.map(raw => ({ raw, name: raw, target: null as number | null }))].map(p => {
              const n = counts.get(p.raw) ?? 0
              const pct = Math.round((n / withPillar) * 100)
              return (
                <div className="a-ct-mix" key={p.raw}>
                  <span className="a-ct-mixbar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="a-mono">{p.name} {n} · {pct}%</span>
                  {p.target !== null
                    ? <span className="a-ct-ref">target {p.target}%</span>
                    : <span />}
                </div>
              )
            })}
          </div>
          {/* A percentage that hides its own denominator is a fabricated number. */}
          <div className="a-ct-sub">
            Percentages are of the {withPillar} rows that carry a pillar, not of all{' '}
            {rows.length}. Targets are Ivan's editorial strategy and are advisory —
            nothing here gates, warns or scores.
          </div>
        </>
      )}
    </Group>
  )
}

// ---------------------------------------------------------------------------
// IN FLIGHT — the floating count, on every tab
// ---------------------------------------------------------------------------
//
// The TAB is where the generating rows live; what it cannot do is say anything
// while Ivan is looking at another tab, which is the exact moment he approves
// something and it vanishes. This is that: one mark, fixed to the corner,
// present on every tab, and gone the instant nothing is running.
//
// BUILT FROM THE UNFILTERED ROWS: a filter may narrow the list, it may never
// hide work that is in flight. And it renders NOTHING at zero.
export function InFlight({ n, stalled, onOpen }: {
  n: number
  /** How many have been running past the stall threshold. The mark is calm
      while a run is normal and says so when one is not. */
  stalled: number
  onOpen: () => void
}) {
  if (n <= 0) return null
  return (
    <button
      type="button"
      className="a-ct-inflight"
      data-bad={stalled > 0 ? '' : undefined}
      onClick={onOpen}
      title={stalled > 0
        ? `${stalled} of them have been running past ${STUCK_GENERATING_MINUTES}m — open Generating`
        : 'Open Generating'}
    >
      <Dot tone={stalled > 0 ? 'urgent' : 'accent'} />
      <span className="a-ct-inflight-n">{n}</span>
      <span className="a-ct-inflight-t">
        {stalled > 0 ? `generating · ${stalled} stalled` : `generating`}
      </span>
    </button>
  )
}
