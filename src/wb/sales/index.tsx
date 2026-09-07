/* ==========================================================================
   src/wb/sales/index.tsx — S-SALES, the week's calls.

   THE QUESTION THIS SURFACE ANSWERS is not "what is waiting on me" (Today
   already answers that) but "who am I talking to, when, and what should be
   open in front of me when I say hello". So the row is built around three
   things and nothing else: the person, the two clocks, and one tap into the
   reading.

   Three decisions worth stating, because none of them is obvious from the code:

   · BOTH TIME ZONES, ALWAYS. Plenty of these calls are booked by someone who
     quoted UTC. A row that showed one local time is the row that gets read as
     the other, and the cost of being wrong is a call he is not on.
   · THE CHIPS ARE THE WHOLE POINT, AND EVERY ONE OF THEM IS A BROWSER TAB.
     A pack he has to go and find is a pack he reads afterwards. Every document
     that exists for a matched prospect is one click from the row and opens in
     its OWN tab (`./Doc`, `#doc?slug=…&doc=…`), because on a call he reads the
     card and the audit next to each other, not one at a time inside a window —
     his words on the first build: "this is all embedded which is annoying".
     Every document that does not exist is still drawn, in the quiet tone, so
     the gap is visible before the call rather than during it.
   · AN UNMATCHED CALL STILL LISTS. A client's weekly, or a prospect whose pack
     was never published, appears with its raw title and "no pack yet". A list
     that silently drops what it cannot explain is a list he cannot trust.

   Density A is the default and is what ships (an instrument: hairline rows,
   one line per fact). Density B is the same markup with `data-density="b"` on
   the root — cards, one per call. Both are implemented; the toggle is in the
   header and remembers itself.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, EmptyState, IconButton, LiveDot } from '../../ds'
import { InboxSkeleton } from '../chrome/Skeleton'
import { Group, Rows, Sep } from '../kit'
import {
  fetchPackIndex, fetchWeekEvents, subscribePacks,
  type PackKind, type PackMeta, type SalesPack, type WeekEvent,
} from '../../lib/salesPacks'
import { fetchCalls, type CallRow } from '../../lib/transcripts'
import { docHref, DOC_LABEL, type PackDoc } from './Doc'
import { dayKey, describeTimes, groupEvents, matchPack, norm, weekWindow } from './match'
import './sales.css'

// The chip strip, left to right, and the label each document wears on it. Short
// on purpose: six of these have to sit on one line at 390 without turning into a
// paragraph. `compare` is not a row in the table — it is the public page, and it
// is offered for every matched prospect.
const CHIPS: Array<{ doc: PackDoc; label: string; kind: PackKind | null }> = [
  { doc: 'card', label: 'card', kind: 'card' },
  { doc: 'call_sheet', label: 'sheet', kind: 'call_sheet' },
  { doc: 'audience_audit', label: 'audit', kind: 'audience_audit' },
  { doc: 'asset_ideas', label: 'ideas', kind: 'asset_ideas' },
  { doc: 'prospect', label: 'JSON', kind: 'prospect' },
  { doc: 'compare', label: 'compare', kind: null },
]

const GROUP_LABEL = {
  today: 'Today',
  later: 'Later this week',
  next: 'Next week',
  earlier: 'Earlier this week',
} as const

type GroupKey = keyof typeof GROUP_LABEL

// The address the FIRST build used to open a document as a WINDOW over this
// list — `#exp/v2/sales?slug=<s>&doc=<kind>` — is alive in Ivan's history and
// in the messages that carried it, and it still resolves: `App.tsx` normalises
// it to `#doc?slug=…&doc=…` at module scope, before the Shell's own hash
// rewrite can drop the two keys it does not own. Nothing in this file reads it.

// ---------------------------------------------------------------------------
// The past-call report (D8)
// ---------------------------------------------------------------------------

/**
 * `call_reports` carries no `calendar_event_id`, so the link from a past call to
 * its report is inferred, and deliberately narrowly: the transcript has to be
 * from the same WARSAW day AND share a word with the event. Either condition on
 * its own would attach the wrong report on any day that held two calls.
 */
function reportIdFor(event: WeekEvent, slug: string | null, calls: CallRow[]): string | null {
  const day = dayKey(event.start_time)
  const sameDay = calls.filter(c => c.date && dayKey(c.date) === day)
  if (sameDay.length === 0) return null
  const words = new Set<string>()
  for (const a of event.attendees ?? []) {
    const local = norm(a.split('@')[0] ?? '')
    if (local.length >= 4) words.add(local)
  }
  for (const w of `${event.title ?? ''} ${slug ?? ''}`.split(/[^A-Za-z0-9]+/)) {
    const t = norm(w)
    if (t.length >= 4) words.add(t)
  }
  const hit = sameDay.find(c => {
    const t = norm(c.title ?? '')
    return [...words].some(w => t.includes(w))
  })
  return hit?.id ?? null
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

// `mobile` is still in the contract the Shell calls with, and is deliberately
// not destructured: the window it used to size is gone (a document is its own
// browser tab now), and the list itself is one layout at every width.
export function SalesSurface({ onOpenCall }: {
  onOpenCall: (id: string, queue: CallRow[]) => void
  mobile: boolean
}) {
  const [events, setEvents] = useState<WeekEvent[]>([])
  const [index, setIndex] = useState<SalesPack[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [density, setDensity] = useState<'a' | 'b'>(() => {
    try { return localStorage.getItem('sales.density') === 'b' ? 'b' : 'a' } catch { return 'a' }
  })
  const alive = useRef(true)

  // The window and the clock are fixed at mount. Recomputing them every render
  // would move the group boundaries under him mid-read at midnight, which is
  // exactly when he is looking at tomorrow's calls.
  const week = useMemo(() => weekWindow(new Date()), [])
  const now = useMemo(() => new Date(), [])

  const loadIndex = useCallback(async () => {
    try {
      const rows = await fetchPackIndex()
      if (alive.current) setIndex(rows)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void (async () => {
      // Three independent reads: one failing must not blank the other two. The
      // calendar is the only one the screen cannot be drawn without, so it is
      // the only one whose failure is reported on the surface.
      const [ev, packs, tx] = await Promise.allSettled([
        fetchWeekEvents(week.from, week.to), fetchPackIndex(), fetchCalls(),
      ])
      if (!alive.current) return
      if (ev.status === 'fulfilled') setEvents(ev.value)
      else setError(ev.reason instanceof Error ? ev.reason.message : String(ev.reason))
      if (packs.status === 'fulfilled') setIndex(packs.value)
      if (tx.status === 'fulfilled') setCalls(tx.value)
      setLoading(false)
    })()
    const off = subscribePacks(() => { void loadIndex() })
    return () => { alive.current = false; off() }
  }, [week, loadIndex])

  const toggleDensity = useCallback(() => {
    setDensity(d => {
      const next = d === 'a' ? 'b' : 'a'
      try { localStorage.setItem('sales.density', next) } catch { /* private window: the look is per-session then */ }
      return next
    })
  }, [])


  // ---- the match, once per (events, index) pair ----
  const { slugs, meta } = useMemo(() => {
    const m: Record<string, PackMeta> = {}
    for (const r of index) m[r.prospect_slug] = { ...m[r.prospect_slug], ...r.meta }
    return { slugs: Object.keys(m), meta: m }
  }, [index])

  const kindsBySlug = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const r of index) (m[r.prospect_slug] ??= new Set()).add(r.kind)
    return m
  }, [index])

  const groups = useMemo(() => groupEvents(events, now), [events, now])

  const packCount = slugs.length

  // ---- one row ----
  const renderRow = (e: WeekEvent, group: GroupKey) => {
    const slug = matchPack(e, slugs, meta)
    const t = describeTimes(e.start_time, now)
    const m: PackMeta = slug ? meta[slug] ?? {} : {}
    const have = slug ? kindsBySlug[slug] ?? new Set<string>() : new Set<string>()
    // Done once it has ENDED, whichever group it sits in: a call that finished
    // three hours ago is still "today", and it must not keep offering Join.
    const past = group === 'earlier' || t.past || new Date(e.end_time ?? e.start_time).getTime() <= now.getTime()
    const reportId = past ? reportIdFor(e, slug, calls) : null

    return (
      <div
        className="a-row a-sl-row" key={e.id} data-past={past ? '' : undefined}
        // The two attributes the week gate reads: which calendar row this is,
        // and which pack the matcher put under it. They are the only way an
        // outside check can tell "the right call, the right pack" from "a row
        // that looks plausible".
        data-cal-id={e.id} data-slug={slug ?? undefined} data-group={group}
      >
        <div className="a-sl-top">
          <span className="a-sl-head">
            {slug && m.name
              ? (
                <>
                  <span className="a-sl-name">{m.name}</span>
                  {m.company ? <span className="a-sl-co"><Sep />{m.company}</span> : null}
                </>
              )
              : <span className="a-sl-raw">{e.title || 'Untitled'}</span>}
          </span>
          <span className="a-sl-time a-mono">
            {t.soon ? <LiveDot label="Starting now" /> : null}
            {t.warsaw} Warsaw<Sep />{t.utc}<Sep />{past ? 'done' : t.rel}
          </span>
        </div>

        {/* One tap, and it leaves the app: the meeting link is the only control
            on this screen with a hard deadline attached to it. */}
        {e.meeting_url && !past ? (
          <a
            className="a-sl-join" href={e.meeting_url} target="_blank" rel="noopener noreferrer"
            data-live={t.soon ? '' : undefined}
            aria-label={`Join ${m.name ?? e.title}`}
          >
            <span>Join</span>
          </a>
        ) : null}

        <div className="a-sl-chips">
          {slug ? CHIPS.map(c => {
            const on = c.kind === null || have.has(c.kind)
            // EVERY DOCUMENT IS A TAB, NOT A PANEL. `target="_blank"` on an
            // anchor is what lets him put the card, the sheet and the audit
            // side by side the way he reads them off disk — and it is what he
            // asked for after the window build shipped (see ./Doc).
            return on
              ? (
                <Chip
                  key={c.doc}
                  tone="neutral"
                  href={docHref(slug, c.doc)}
                  target="_blank"
                  title={`${DOC_LABEL[c.doc]} — opens in a new tab`}
                >
                  {c.label}
                </Chip>
              )
              : <Chip key={c.doc} tone="quiet">{c.label}</Chip>
          }) : <Chip tone="quiet">no pack yet</Chip>}
          {reportId ? (
            <Chip icon="doc" tone="accent" onClick={() => onOpenCall(reportId, calls)}>Report</Chip>
          ) : null}
        </div>
      </div>
    )
  }

  const order: GroupKey[] = ['today', 'later', 'next', 'earlier']
  const total = events.length

  return (
    // `a-root ds-body` is what kit's `Screen` puts here; it is spelled out
    // because the root also has to carry the two data attributes — the density
    // switch, and `data-surface`, the literal the deploy gate greps for in the
    // built bundle.
    <div className="a-root ds-body a-sl" data-surface="sales" data-density={density}>
      <div className="a-head">
        <div className="a-head-t">
          <h2 className="a-head-title">
            <span className="a-eyebrow a-sl-eb">Sales</span>
            Week of {week.mondayLabel}
          </h2>
          <div className="a-head-sub a-mono">
            {total} {total === 1 ? 'call' : 'calls'}<Sep />{packCount} {packCount === 1 ? 'pack' : 'packs'}
          </div>
        </div>
        <div className="a-head-tail">
          <IconButton
            icon={density === 'a' ? 'list' : 'layers'}
            label={density === 'a' ? 'Show the calls as cards' : 'Show the calls as rows'}
            size="sm"
            onClick={toggleDensity}
          />
        </div>
      </div>

      <div className="a-body">
        {error ? <div className="a-meta a-sl-err">The week did not load: {error}</div> : null}

        {loading && total === 0 ? <InboxSkeleton /> : null}

        {!loading && total === 0 && !error ? (
          <EmptyState
            icon="calendar"
            ghosts
            title="No calls booked in the next two weeks."
            sub={`Read live from the calendar, for the fortnight from ${week.mondayLabel}.`}
          />
        ) : null}

        {order.map(g => {
          const rows = groups[g]
          // Today is drawn even when it is empty, because "nothing today" is an
          // answer he came here for. The other three are noise when empty.
          if (rows.length === 0 && (g !== 'today' || total === 0)) return null
          return (
            <Group key={g} label={GROUP_LABEL[g]} tail={rows.length > 0 ? String(rows.length) : undefined}>
              {rows.length === 0
                ? <div className="a-meta a-sl-none">No calls today.</div>
                : <Rows>{rows.map(e => renderRow(e, g))}</Rows>}
            </Group>
          )
        })}
      </div>

    </div>
  )
}

export { SalesSurface as Sales }
