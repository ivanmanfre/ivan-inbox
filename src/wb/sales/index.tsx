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
import { Chip, EmptyState, FilterTokens, IconButton } from '../../ds'
import { InboxSkeleton } from '../chrome/Skeleton'
import { Group, HeadChromeSlot, Rows, Sep } from '../kit'
import {
  fetchPackIndex, fetchWeekEvents, subscribePacks,
  type PackKind, type PackMeta, type SalesPack, type WeekEvent,
} from '../../lib/salesPacks'
import { callStats, fetchCalls, type CallRow } from '../../lib/transcripts'
import { MEETING_TYPE_LABEL, resolveMeetingType } from '../../lib/nextCall'
import { CallLog } from './CallLog'
import { docHref, DOC_LABEL, type PackDoc } from './Doc'
import { callPhase, dayKey, describeTimes, groupEvents, matchPack, norm, packsInWindow, weekWindow } from './match'
import {
  SALES_FIELDS, readTokens, salesRowMatches, writeTokens,
  type FilterToken,
} from '../../lib/filterTokens'
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

/* ===========================================================================
   E3 · THE ONE VERB THIS ROW NEEDS (isaiahbjork/leads-data-table).

   The row draws six equal chips — card / sheet / audit / ideas / JSON / compare
   — and equal is the defect: nothing on the strip says which of them he should
   have open when he says hello. The move gives the row a hierarchy without
   taking anything away: under a pointer the row's right-hand metadata (the two
   clocks) gives way to the ONE document this row is for, and the six chips stay
   exactly where they are, one click each, because this file's own contract is
   that every document that exists is ONE CLICK from the row.

   WHICH ONE, read off the row kinds this list already draws:
   · a call still to come with a matched pack → the card. It is the document the
     file's header names as the one he reads first, and it is the one buried
     among six chips that all look the same.
   · anything else → NOTHING, and the row keeps its clocks. There is no
     affirmative verb to offer and inventing one ("Find pack") would be a button
     that cannot do what it says.

   🔴 E3b · A PAST CALL'S REPORT IS NOT A HOVER VERB, because the row already
   shows it. The strip draws an accent `Report` chip whenever `reportId` is
   found, standing, not hover-gated — so a hover verb there was the SAME handler
   drawn a second time, two controls for one job on the same row. The move
   exists to give a row a hierarchy it lacks; a past row already has one. It
   keeps its clocks and its chip, and it does not participate (`a-sl-hasverb` is
   absent, so the sheet does not recede the clocks either).

   `Join` is deliberately NOT a hover verb: it is already a standing control at
   the tap floor, and it is the one thing on this screen with a deadline
   attached — it may never depend on a pointer being in the right place.

   🔴 AND INSIDE THE HOUR THERE IS NO HOVER VERB AT ALL. This file's rule for
   Join is that it turns accent "when it is the only thing worth touching". A
   second accent control beside it would make that sentence false, on the one
   row where being wrong costs him a call he is not on. Caught by LOOKING at
   `e3-d-sales-hover.png`, where the lime verb sits next to Join.

   Pure and exported so the fork is a unit test rather than a screenshot. */
export function salesVerbFor({ past, hasPack, joinLive = false }: {
  past: boolean
  hasPack: boolean
  /** The call starts inside the hour and Join has gone accent. */
  joinLive?: boolean
}): 'card' | null {
  if (joinLive) return null
  // A past row's one verb is the Report chip the strip already draws, standing
  // and accent. Drawing it again on hover is two controls for one job.
  if (past) return null
  return hasPack ? 'card' : null
}

/** "Discovery call · via Calendly", plus who is on it when no pack names them. */
function kindLine(e: WeekEvent, matched: boolean): string {
  const type = e.title ? resolveMeetingType({ meeting_type: e.meeting_type, title: e.title }) : null
  // Ivan's own address is on every invite; it says nothing.
  const who = matched ? [] : (e.attendees ?? []).filter(x => !/ivanmanfred/i.test(x)).slice(0, 2)
  return [
    type ? MEETING_TYPE_LABEL[type] : null,
    e.source ? `via ${e.source.charAt(0).toUpperCase()}${e.source.slice(1)}` : null,
    who.length > 0 ? `with ${who.join(', ')}` : null,
  ].filter(Boolean).join(' · ')
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
  // The two reads the screen CAN be drawn without still say when they fail
  // (blueprint FIX): a failed pack read made every call read "no pack yet",
  // and a failed transcript read hid every Report chip, both silently.
  const [packsFailed, setPacksFailed] = useState(false)
  const [callsState, setCallsState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [density, setDensity] = useState<'a' | 'b'>(() => {
    try { return localStorage.getItem('sales.density') === 'b' ? 'b' : 'a' } catch { return 'a' }
  })
  /* E2 · THE THREE QUESTIONS THIS LIST CAN BE ASKED.

     This surface had no filter at all, so the fields are not ported from
     somewhere — they are the three facts `renderRow` below already computes
     for every call before it draws one: which part of the fortnight it sits
     in, whether the matcher found a pack, and whether a past call has a report
     under it. "Who am I talking to" is what the list itself answers, so it is
     not a filter; nothing else on the row is a question.

     `pack has no` is the one that earns the control: the comment at the top of
     this file says a missing pack has to be visible BEFORE the call rather
     than during it, and until now that meant reading every row. */
  const [tokens, setTokensState] = useState<FilterToken[]>(() => readTokens('sales'))
  const setTokens = useCallback((next: FilterToken[]) => {
    setTokensState(next)
    writeTokens('sales', next)
  }, [])
  const alive = useRef(true)

  // The window and the clock are fixed at mount. Recomputing them every render
  // would move the group boundaries under him mid-read at midnight, which is
  // exactly when he is looking at tomorrow's calls.
  //
  // 2026-09-26 rebuild: the phone keeps this lane alive between visits, so a
  // clock fixed at mount froze "in 2h 5m" and never lit Join inside the hour.
  // The clock now ticks every 30 s; the window still only moves when the
  // Warsaw day does (and the list is read again then).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const today = dayKey(now)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => weekWindow(new Date()), [today])
  const readAt = useRef(0)
  const [reads, setReads] = useState(0)
  const retry = useCallback(() => setReads(n => n + 1), [])
  // Back on the screen after five minutes away = read again, quietly.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - readAt.current > 5 * 60_000) setReads(n => n + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const loadIndex = useCallback(async () => {
    try {
      const rows = await fetchPackIndex()
      if (alive.current) { setIndex(rows); setPacksFailed(false) }
    } catch {
      if (alive.current) setPacksFailed(true)
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
      readAt.current = Date.now()
      if (ev.status === 'fulfilled') { setEvents(ev.value); setError('') }
      else setError(ev.reason instanceof Error ? ev.reason.message : String(ev.reason))
      if (packs.status === 'fulfilled') { setIndex(packs.value); setPacksFailed(false) } else setPacksFailed(true)
      if (tx.status === 'fulfilled') { setCalls(tx.value); setCallsState('ok') } else setCallsState('failed')
      setLoading(false)
    })()
    const off = subscribePacks(() => { void loadIndex() })
    return () => { alive.current = false; off() }
  }, [week, loadIndex, reads])

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

  // Packs for the calls on screen, the same fortnight the call count covers.
  // `slugs.length` was every pack ever published.
  const packCount = useMemo(() => packsInWindow(events, slugs, meta), [events, slugs, meta])

  // ---- one row ----
  const renderRow = (e: WeekEvent, group: GroupKey) => {
    const slug = matchPack(e, slugs, meta)
    const t = describeTimes(e.start_time, now)
    const m: PackMeta = slug ? meta[slug] ?? {} : {}
    const have = slug ? kindsBySlug[slug] ?? new Set<string>() : new Set<string>()
    // Done once it has ENDED, whichever group it sits in: a call that finished
    // three hours ago is still "today", and it must not keep offering Join.
    // ENDED, not STARTED (2026-09-26): the row used to flip to done at the start
    // time and took Join away mid-call. The end is the calendar's own, or start
    // plus an hour when it has none (match.ts callEndMs).
    const phase = callPhase(e, now)
    const past = group === 'earlier' || phase === 'done'
    const running = !past && phase === 'running'
    const reportId = past ? reportIdFor(e, slug, calls) : null
    const kind = kindLine(e, slug !== null)
    // E3: the one verb this row is for, revealed where the clocks are.
    const verb = salesVerbFor({
      past,
      hasPack: slug !== null,
      joinLive: (t.soon || running) && !past && Boolean(e.meeting_url),
    })

    return (
      <div
        className={`a-row a-sl-row${verb ? ' a-sl-hasverb' : ''}`} key={e.id} data-past={past ? '' : undefined}
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
          {/* No live dot (B look, 25 Sep "small dots everywhere"): the words
              "on now" and the lime Join carry it. */}
          <span className="a-sl-time a-mono">
            {t.warsaw} Warsaw<Sep />{t.utc}<Sep />{past ? 'done' : running ? 'on now' : t.rel}
          </span>
          {/* E3: absolutely positioned over the clocks by the sheet, so the row
              at rest is byte-for-byte the row E2 measured, and the clocks come
              straight back when the pointer leaves. Hover canvases only. */}
          {verb === 'card' && slug ? (
            <span className="a-sl-verb">
              <Chip
                tone="accent"
                href={docHref(slug, 'card')}
                target="_blank"
                title={`${DOC_LABEL.card} — opens in a new tab`}
              >Open card</Chip>
            </span>
          ) : null}
        </div>

        {/* One tap, and it leaves the app: the meeting link is the only control
            on this screen with a hard deadline attached to it. */}
        {e.meeting_url && !past ? (
          <a
            className="a-sl-join" href={e.meeting_url} target="_blank" rel="noopener noreferrer"
            data-live={t.soon || running ? '' : undefined}
            aria-label={`Join ${m.name ?? e.title}`}
          >
            <span>Join</span>
          </a>
        ) : null}

        {/* What Today's "Next call" block also said (TYPE, SOURCE, WITH), kept
            when Today went: the kind of call, where it was booked from, and
            who is on an unmatched one. Absent facts are not drawn. */}
        {kind ? <div className="a-meta a-sl-kind">{kind}</div> : null}

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
  // The reads the list can be drawn without, said once, in one line.
  const softFail = total === 0 ? '' : [
    packsFailed ? 'The packs did not load, so a call reading "no pack yet" may have one.' : '',
    callsState === 'failed' ? 'The call reports did not load, so past calls show no Report yet.' : '',
  ].filter(Boolean).join(' ')
  // What Today's empty "Next call" said next: the archive is still there.
  const archiveLine = callsState !== 'ok' || calls.length === 0 ? '' : (() => {
    const st = callStats(calls)
    return st.withActions > 0
      ? ` ${st.total} earlier calls are on record below, and ${st.withActions} of them still carry something that was agreed.`
      : ` ${st.total} earlier calls are on record below.`
  })()
  const countLine = `${total} ${total === 1 ? 'call' : 'calls'} · ${packCount} ${packCount === 1 ? 'pack' : 'packs'}`

  return (
    // `a-root ds-body` is what kit's `Screen` puts here; it is spelled out
    // because the root also has to carry the two data attributes — the density
    // switch, and `data-surface`, the literal the deploy gate greps for in the
    // built bundle.
    <div className="a-root ds-body a-sl" data-surface="sales" data-density={density}>
      {/* N2b-1: `data-chrome` is what wb.css keys the merged phone head off,
          and HeadChromeSlot is where the phone chrome portals its tiles. Both
          are inert on the desktop, where nothing provides the slot. */}
      <div className="a-head" data-chrome="">
        <div className="a-head-t">
          <h2 className="a-head-title">
            <span className="a-eyebrow a-sl-eb">Sales</span>
            <span className="a-sl-week">Week of {week.mondayLabel}</span>
          </h2>
          <div className="a-head-sub a-mono">
            {total} {total === 1 ? 'call' : 'calls'}<Sep />{packCount} {packCount === 1 ? 'pack' : 'packs'}
          </div>
        </div>
        <div className="a-head-tail">
          {/* The one entry point into /orbit (goal run signal-orbit-live,
              2026-09-11) — no rail row, no tab-bar slot, just this button.
              A direct hash write, same as every other cross-surface deep link
              in this app (see src/lib/inbox.ts's thread links). */}
          <IconButton
            icon="orbit"
            label="Orbit"
            size="sm"
            onClick={() => { location.hash = '#exp/brain-b/orbit?tenant=ivan&range=30d' }}
          />
          <IconButton
            icon={density === 'a' ? 'list' : 'layers'}
            label={density === 'a' ? 'Show the calls as cards' : 'Show the calls as rows'}
            size="sm"
            onClick={toggleDensity}
          />
          <HeadChromeSlot />
        </div>
      </div>

      {/* Its own band rather than the head's tail: the two IconButtons up there
          are view switches and this is a question about the rows. It never
          sticks — the list is short by construction (a fortnight of calls). */}
      <div className="a-bar a-sl-filterbar">
        <FilterTokens
          fields={SALES_FIELDS}
          tokens={tokens}
          setTokens={setTokens}
          surfaceLabel="calls"
        />
        {/* The head's count line, on the phone, where the tiles leave it room. */}
        <span className="a-sl-barcount a-mono">{countLine}</span>
      </div>

      <div className="a-body">
        {error || softFail ? (
          <div className="a-sl-warn" role="status">
            <span className="a-meta a-sl-err">
              {error ? `The week did not load: ${error}. ` : ''}{softFail}
            </span>
            <button type="button" className="wb-sl-retry" onClick={retry}>Read again</button>
          </div>
        ) : null}

        {loading && total === 0 ? <InboxSkeleton /> : null}

        {!loading && total === 0 && !error ? (
          <EmptyState
            icon="calendar"
            ghosts
            title="No calls booked in the next two weeks."
            sub={`Read live from the calendar, for the fortnight from ${week.mondayLabel}.${archiveLine}`}
          />
        ) : null}

        {order.map(g => {
          // The tokens narrow INSIDE the group, so the group headers keep
          // counting what is actually under them. A group emptied by a filter
          // is dropped exactly like a group that was empty to begin with.
          const rows = groups[g].filter(e => {
            if (tokens.length === 0) return true
            const slug = matchPack(e, slugs, meta)
            const past = g === 'earlier' || callPhase(e, now) === 'done'
            return salesRowMatches({
              when: g,
              pack: slug !== null,
              report: past ? reportIdFor(e, slug, calls) !== null : false,
            }, tokens)
          })
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

        <CallLog rows={calls} state={callsState} onOpen={onOpenCall} onRetry={retry} />
      </div>

    </div>
  )
}

export { SalesSurface as Sales }
