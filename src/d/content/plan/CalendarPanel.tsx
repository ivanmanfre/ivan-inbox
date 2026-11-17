import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fetchCalendarPanel, type CalendarPanel as Panel } from '../../../lib/contentPlanPanel'
import { warsawDm } from '../../ui/time'
import { REASON_WORD, claimLine, chipsFor, lookupOf, pct, quotaLine, vehicleWord, weekTarget, KIND_LABEL, type SlotLookup } from './calendarPanelModel'
import './calendarPanel.css'

// PLAN > Ivan's seat: belief and vehicle on each post, the week as quotas, the profile check and a small
// measurement panel (Run C, db/20261117r). Read only. A failed read shows one quiet line and nothing else.

export type PanelState = { panel: Panel | null; failed: boolean }

/** One read per seat visit; null for any seat but Ivan's. Hooks run before any early return in the caller. */
export function useCalendarPanel(on: boolean, tick = 0): PanelState {
  const [st, setSt] = useState<PanelState>({ panel: null, failed: false })
  useEffect(() => {
    if (!on) { setSt({ panel: null, failed: false }); return }
    let live = true
    const c = new AbortController()
    void fetchCalendarPanel(c.signal)
      .then(p => { if (live) setSt({ panel: p, failed: false }) })
      .catch(() => { if (live) setSt(s => ({ panel: s.panel, failed: true })) })
    return () => { live = false; c.abort() }
  }, [on, tick])
  return st
}

const EMPTY: SlotLookup = { bySlot: new Map(), byDraft: new Map() }
const ChipsCtx = createContext<SlotLookup>(EMPTY)
export function CalendarChipsProvider({ panel, children }: { panel: Panel | null; children: React.ReactNode }) {
  const v = useMemo(() => (panel ? lookupOf(panel) : EMPTY), [panel])
  return <ChipsCtx.Provider value={v}>{children}</ChipsCtx.Provider>
}

/** Belief and vehicle of one post or planned post. Shows nothing when the server has neither. */
export function BeliefChips({ slotId, draftId }: { slotId: string | null; draftId: string | null }) {
  const c = chipsFor(useContext(ChipsCtx), slotId, draftId)
  if (!c) return null
  return <span className="cp17-chips" data-verb="plan-belief">
    {c.belief != null && <span className="cp17-chip">Belief {c.belief}</span>}
    {c.vehicle && <span className="cp17-chip">{vehicleWord(c.vehicle)}</span>}
  </span>
}

const weekName = (start: string, thisWeek: string, i: number) => (start === thisWeek ? 'This week' : i === 1 ? 'Next week' : `Week of ${warsawDm(`${start}T12:00:00Z`)}`)

function WeekStrip({ p }: { p: Panel }) {
  const line = quotaLine(p.quotas), target = weekTarget(p.quotas), claim = claimLine(p.quotas)
  return <section className="cp17-sec" aria-label="The week">
    <h3>The week</h3>
    {line && <p className="cp17-line">{line}</p>}
    {claim && <p className="cp17-note">{claim}</p>}
    <ul className="cp17-weeks">
      {p.week_fill.map((w, i) => {
        const beliefs = Object.entries(w.by_belief).sort(([a], [b]) => Number(a) - Number(b))
        const open = target > 0 ? Math.max(0, target - w.slots) : null
        return <li key={w.week_start} className="cp17-week">
          <b>{weekName(w.week_start, p.this_week, i)}</b>
          <span>{target > 0 ? `${w.slots} of ${target} filled` : `${w.slots} planned`}{open ? `, ${open} open` : ''}</span>
          {beliefs.map(([b, n]) => <span key={b} className="cp17-chip">Belief {b}: {n}</span>)}
          {w.no_belief > 0 && <span className="cp17-chip cp17-chip-open">{w.no_belief} with no belief yet</span>}
          {w.copies > 0 && <span className="cp17-extra">{w.copies} {w.copies === 1 ? 'copy' : 'copies'} as extras</span>}
        </li>
      })}
    </ul>
  </section>
}

function ProfileFirst({ p }: { p: Panel }) {
  const pf = p.profile_first
  if (!pf) return null
  const unread = new Set(pf.unlabeled)
  const marks: [string, boolean][] = [['proof', pf.proof], ['outreach belief', pf.outreach_belief], ['you in it', pf.him]]
  return <section className="cp17-sec" aria-label="Top of your profile">
    <h3>Top of your profile: {pf.score.replace(/ of 3$/, '')} of 3</h3>
    <p className="cp17-line">{marks.map(([k, on]) => <span key={k} className={`cp17-mark${on ? ' cp17-on' : ''}`}>{on ? 'Yes' : 'Not yet'}: {k}</span>)}</p>
    <ol className="cp17-posts">
      {pf.posts.map(x => <li key={x.id}>
        <span className="cp17-date">{warsawDm(x.posted_at)}</span>
        <span className="cp17-first">{x.first_line}</span>
        <span className="cp17-tags">
          {unread.has(x.id) ? <span className="cp17-chip cp17-chip-open">not read yet</span> : <>
            {x.proof && <span className="cp17-chip">proof</span>}
            {x.belief != null && x.belief <= 2 && <span className="cp17-chip">outreach belief</span>}
            {x.him && <span className="cp17-chip">you in it</span>}
            {x.is_copy && <span className="cp17-extra">copy</span>}
          </>}
        </span>
      </li>)}
    </ol>
  </section>
}

type Cohort = Panel['cohorts']['rows'][number]
const SMALL = 20
const scorerText = (v: Cohort['scorer_version']) => v == null || v === '' || v === 'unstamped' ? 'scorer not recorded' : `scorer ${String(v).replace(/^v?/, 'v')}`
const noteText = (a: Cohort['note_arm']) => a === 'note' ? 'with a note' : a === 'blank' ? 'no note' : null
const keyLabel = (c: Cohort) => [c.campaign_name ?? 'Campaign', scorerText(c.scorer_version), noteText(c.note_arm), c.period_from ? `from ${c.period_from}` : null].filter(Boolean).join(' · ')
const kindText = (c: Cohort) => `${c.top_post_kind ? (KIND_LABEL[c.top_post_kind] ?? c.top_post_kind.replace(/_/g, ' ')) : 'no post'}${c.top_belief != null ? `, belief ${c.top_belief}` : ''}${c.top_vehicle ? `, ${vehicleWord(c.top_vehicle)}` : ''}`
/** A rate, or "small sample" when the base is too thin to read. */
const rate = (word: string, n: number, base: number, small: boolean) => small ? `${word} ${n} of ${base}, small sample` : `${word} ${n} of ${base} (${pct(n, base)})`
/** Rows of one filter key stay together; rates never sit beside another key's and kinds are never ranked across keys. Newest period and scorer first. */
function groupsOf(rows: Cohort[]) {
  const m = new Map<string, Cohort[]>()
  for (const r of rows) m.set(r.filter_key, [...(m.get(r.filter_key) ?? []), r])
  return [...m.entries()].map(([key, rs]) => ({ key, rows: [...rs].sort((a, b) => kindText(a).localeCompare(kindText(b))), head: rs[0] }))
    .sort((a, b) => (b.head.period_from ?? '').localeCompare(a.head.period_from ?? '') || String(b.head.scorer_version ?? '').localeCompare(String(a.head.scorer_version ?? ''), undefined, { numeric: true }) || keyLabel(a.head).localeCompare(keyLabel(b.head)))
}

function Measure({ p }: { p: Panel }) {
  const co = p.cohorts
  return <details className="cp17-sec cp17-measure">
    <summary><h3>Measurement</h3></summary>
    <h4>People you contacted who opened your profile within 48 hours of a post</h4>
    {p.pv48.length === 0 ? <p className="cp17-note">No posts to count yet.</p> : <ul className="cp17-rows">
      {p.pv48.map((v, i) => <li key={`${v.posted_at}:${i}`}>
        <span className="cp17-date">{warsawDm(v.posted_at)}</span>
        <span className="cp17-first">{v.first_line}{v.kind ? <em> ({KIND_LABEL[v.kind] ?? v.kind.replace(/_/g, ' ')})</em> : null}</span>
        <span className="cp17-num">{v.contacted_viewers_48h} people, {v.contacted_fit_viewers_48h == null ? 'fit not measured' : `${v.contacted_fit_viewers_48h} a fit`}</span>
        <span className="cp17-note">{v.baseline_per_48h != null ? `usual ${v.baseline_per_48h} per 48 h` : ''}{v.window_open ? ' · still counting' : ''}</span>
      </li>)}
    </ul>}
    <h4>Invites by what sat on top of your feed</h4>
    {co.rows.length === 0 ? <p className="cp17-note">No cohort rows yet.</p> : <>
      <p className="cp17-note">{co.note}</p>
      {groupsOf(co.rows).map(g => <div key={g.key} className="cp17-group">
        <p className="cp17-note" title={`filter ${g.key}`}><b>{keyLabel(g.head)}</b></p>
        <ul className="cp17-rows">
          {g.rows.map((c, i) => <li key={`${c.top_post_kind}:${c.top_belief}:${c.top_vehicle}:${i}`}>
            <span className="cp17-first">{kindText(c)}</span>
            <span className="cp17-num">{c.invites} invites</span>
            <span className="cp17-num">{rate('accepted', c.accepts, c.accept_base, c.small_n || c.accept_base < SMALL)}</span>
            <span className="cp17-num">{rate('replied', c.replies, c.reply_base, (c.reply_small_n ?? c.reply_base < SMALL))}</span>
            <span className="cp17-num">{rate('booked', c.bookings, c.booking_base, (c.booking_small_n ?? c.booking_base < SMALL))}</span>
          </li>)}
        </ul>
      </div>)}
    </>}
    <h4>Why they booked</h4>
    {p.booking_reasons.length === 0 ? <p className="cp17-note">None read yet.</p> : <ul className="cp17-quotes">
      {p.booking_reasons.map((b, i) => <li key={`${b.call_date}:${i}`}>
        <q>{b.quote}</q>
        <span className="cp17-note">{warsawDm(b.call_date)} · {REASON_WORD[b.reason_class] ?? b.reason_class}</span>
      </li>)}
    </ul>}
  </details>
}

export function CalendarPanel({ state }: { state: PanelState }) {
  const { panel, failed } = state
  if (!panel) return failed ? <p className="cp17-note cp17-fail" role="status">The calendar check could not load.</p> : null
  return <div className="cp17" data-verb="calendar-panel">
    <WeekStrip p={panel} />
    <ProfileFirst p={panel} />
    <Measure p={panel} />
  </div>
}
