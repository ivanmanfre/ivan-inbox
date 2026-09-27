/* ==========================================================================
   src/d/lanes/glance/Glance.tsx — the top of Lanes: the five pillars, per seat.

   Each cell renders ONE seat; the desktop grid lays three side by side under
   the seat plates (index.tsx), the phone draws the same cells in three narrow
   columns (GlancePhone). Every cell links to the place that acts on it.
   Honest states: "…" while a read is in flight, "?" + why when it failed.
   ========================================================================== */
import type { ReactNode } from 'react'
import { useContent } from '../../../hooks/useContent'
import { rateLimitIncident } from '../../../lib/campaignControl'
import { dmNumbers, useFrameCounts } from '../../counts/useFrameCounts'
import { dHash } from '../../route'
import { SEAT_NAME, type Seat } from '../../seats'
import { clientOf, controlOf, hm, dm as dayMonth, todayOf } from '../model'
import type { LanesData } from '../useLanesData'
import { contentWeek, limitOf, nextWeekDays, type ContentWeek } from './model'
import { readyOf, type ReadySeat } from './ready'
import './glance.css'

type Read<T> = { v: T } | { loading: true } | { failed: string }
export type GlanceCtx = {
  d: LanesData
  now: number
  content: Record<Seat, Read<ContentWeek>>
  drafts: Record<Seat, Read<number>>
  openCampaign: (id: string) => void
  jump: (band: 'today' | 'control', seat: Seat) => void
}

/** The glance's own reads that Lanes does not already hold: content x3 (the Content place's read) and the frame's draft counts. */
export function useGlance(now: number): Pick<GlanceCtx, 'content' | 'drafts'> {
  const ivan = useContent('ivan')
  const rise = useContent('risedtc')
  const arch = useContent('arch')
  const counts = useFrameCounts()
  const days = nextWeekDays(now)
  const wk = (r: ReturnType<typeof useContent>, s: Seat): Read<ContentWeek> =>
    r.error ? { failed: r.error } : !r.loadedAt ? { loading: true } : { v: contentWeek(r.drafts, s, days) }
  const dn = dmNumbers(counts, 'drafts')
  const dr = (s: Seat): Read<number> => {
    const v = dn[s]
    return v != null ? { v } : counts.dms[s].failed ? { failed: 'the drafts count could not be read' } : { loading: true }
  }
  return {
    content: { ivan: wk(ivan, 'ivan'), risedtc: wk(rise, 'risedtc'), arch: wk(arch, 'arch') },
    drafts: { ivan: dr('ivan'), risedtc: dr('risedtc'), arch: dr('arch') },
  }
}

const Big = ({ v, tone }: { v: number | null | undefined; tone?: 'live' | 'warn' }) =>
  <em className={`gl-n${v == null ? ' gl-q' : v === 0 ? ' gl-z' : tone === 'warn' ? ' gl-w' : tone === 'live' ? ' gl-on' : ''}`}>{v == null ? '?' : v.toLocaleString('en-US')}</em>

function Wait<T>({ r, children }: { r: Read<T>; children: (v: T) => ReactNode }) {
  if ('loading' in r) return <em className="gl-n gl-q" aria-label="Reading">…</em>
  if ('failed' in r) return <span className="gl-fail" title={r.failed}><em className="gl-n gl-q">?</em> could not be read</span>
  return <>{children(r.v)}</>
}

export function ContentCell({ seat, g }: { seat: Seat; g: GlanceCtx }) {
  const r = g.content[seat]
  const week = nextWeekDays(g.now)
  return (
    <a className="gl-cell gl-link" href={dHash('content', null, { lane: seat })} aria-label={`${SEAT_NAME[seat]} content next week, open Content`}>
      <div className="gl-top">
        <Wait r={r}>{w => <><Big v={w.n} tone={w.below ? 'warn' : undefined} /><span className="gl-u"><span className="gl-long">posts scheduled</span><span className="gl-short">posts</span></span></>}</Wait>
        {'v' in r && r.v.below && <span className="gl-warn">Below 3 pieces</span>}
      </div>
      <div className="gl-cal" aria-label={`Week of ${week[0]?.dm ?? ''}`}>
        {('v' in r ? r.v.days : week.map(d => ({ ...d, posts: null as number | null, stub: null as string | null, planned: false }))).map(d => (
          <div key={d.key} className={`gl-day${d.posts ? ' gl-has' : ''}`} title={d.stub ?? undefined}>
            <small>{d.dow.slice(0, 2)} {d.n}</small>
            <b>{d.posts == null ? '·' : d.posts || '–'}</b>
            <span>{d.stub ? (d.planned ? `not armed: ${d.stub}` : d.stub) : ''}</span>
          </div>
        ))}
      </div>
    </a>
  )
}

export function DraftsCell({ seat, g }: { seat: Seat; g: GlanceCtx }) {
  return (
    <a className="gl-cell gl-link gl-row" href={dHash('dms', null, { seat })} aria-label={`${SEAT_NAME[seat]} DM drafts, open DMs`}>
      <Wait r={g.drafts[seat]}>{v => <Big v={v} tone="live" />}</Wait>
      <span className="gl-u"><span className="gl-long">DM drafts waiting on you, follow-ups included</span><span className="gl-short">drafts</span></span>
      <span className="gl-go">DMs ›</span>
    </a>
  )
}

export function InvitesCell({ seat, g }: { seat: Seat; g: GlanceCtx }) {
  const t = todayOf(g.d.cc.value, seat, g.now)
  const r: Read<number | null> = g.d.cc.value ? { v: t?.inv ?? null } : g.d.cc.failed ? { failed: g.d.cc.failed } : { loading: true }
  return (
    <button type="button" className="gl-cell gl-link gl-row" onClick={() => g.jump('today', seat)}>
      <Wait r={r}>{v => <Big v={v} tone="live" />}</Wait>
      <span className="gl-u"><span className="gl-long">invites sent today (Warsaw day)</span><span className="gl-short">today</span>{t?.invY != null ? `, ${t.invY} yesterday` : ''}</span>
    </button>
  )
}

export function ReadyCell({ seat, g }: { seat: Seat; g: GlanceCtx }) {
  const gov = g.d.gov.value?.find(x => x.client_id === seat) ?? null
  const r: Read<ReadySeat> = g.d.ready.value ? { v: readyOf(g.d.ready.value, seat, gov) } : g.d.ready.failed ? { failed: g.d.ready.failed } : { loading: true }
  const n = (l: ReadySeat['lanes'][number]) => <b className={l.n && !l.off ? '' : 'gl-z'}>{l.capped ? '≥' : ''}{l.n}</b>
  return (
    <div className="gl-cell">
      <div className="gl-top">
        <Wait r={r}>{v => <><Big v={v.total} /><span className="gl-u"><span className="gl-long">pass the sender&apos;s filter now</span><span className="gl-short">ready</span></span></>}</Wait>
      </div>
      {'v' in r && (r.v.lanes.length ? (
        <ul className="gl-lanes">
          {r.v.lanes.map(l => {
            const label = <span>{l.label}{l.off && <small className="gl-off">{l.off}</small>}</span>
            return (
              <li key={l.lane} className={l.off ? 'gl-offl' : undefined}>
                {l.campaignId
                  ? <button type="button" onClick={() => g.openCampaign(l.campaignId!)} aria-label={`${l.label}: ${l.n} ready, open the campaign`}>{label}{n(l)}</button>
                  : <span className="gl-li">{label}{n(l)}</span>}
              </li>
            )
          })}
        </ul>
      ) : <p className="gl-note">No live lane on this seat.</p>)}
    </div>
  )
}

export function LimitCell({ seat, g }: { seat: Seat; g: GlanceCtx }) {
  const c = clientOf(g.d.cc.value, seat)
  const inc = c ? rateLimitIncident(c) : null
  const cv = c && inc ? controlOf(c, g.now) : null
  const na = (inc?.next_action ?? {}) as { cooldown_until?: string | null; earliest_safe_at?: string | null }
  const att = g.d.attempts.value?.[seat]
  const reading = (!g.d.cc.value && !g.d.cc.failed) || (!g.d.pauses.value && !g.d.pauses.failed)
  const unread = [g.d.cc.value ? '' : 'the monitor', g.d.pauses.value ? '' : 'the pause keys'].filter(Boolean)
  const v = limitOf({
    incident: inc ? { lead: cv?.incident?.lead ?? '', cooldown: na.cooldown_until ?? na.earliest_safe_at ?? null } : null,
    seatPause: g.d.pauses.value?.[seat], globalPause: g.d.pauses.value?.all,
    last: att && att !== 'failed' ? att : null, now: g.now,
  })
  const when = (t: string) => `${dayMonth(t) === dayMonth(g.now) ? '' : dayMonth(t) + ' '}${hm(t)}`
  return (
    <button type="button" className="gl-cell gl-link" onClick={() => g.jump('control', seat)}>
      <div className="gl-top">
        {reading ? <em className="gl-n gl-q">…</em>
          : unread.length === 2 ? <span className="gl-fail"><em className="gl-n gl-q">?</em> could not be read</span>
          : <span className={`gl-word ${v.limited ? 'gl-w' : 'gl-on'}`}>{v.limited ? 'Limited' : 'Clear'}</span>}
        {!reading && v.why && <span className="gl-u">{v.why}</span>}
      </div>
      <div className="gl-kv">
        <span>Last try</span>
        {att === undefined ? '…' : att === 'failed' ? <span className="gl-wt">could not be read</span>
          : att ? <><b>{when(att.at)}</b> {att.ok ? 'went out' : <span className="gl-wt">refused</span>}</> : 'none in 14 days'}
      </div>
      <div className="gl-kv">
        <span>{v.resumes && Date.parse(v.resumes) > g.now ? 'Resumes' : 'Last pause'}</span>
        {v.resumes ? <><b>{when(v.resumes)}</b>{v.resumesBy === 'global' ? ' (manual stop, all seats)' : ''}{Date.parse(v.resumes) <= g.now ? ' ended' : ''}</> : 'none set'}
      </div>
      {v.refusedAfterPause && <div className="gl-kv gl-wt">Still refused after the pause.</div>}
      {unread.length === 1 && <div className="gl-kv gl-wt">{unread[0]} could not be read</div>}
    </button>
  )
}

export const GLANCE_ROWS: Array<{ id: string; label: string; note: string; Cell: (p: { seat: Seat; g: GlanceCtx }) => ReactNode }> = [
  { id: 'content', label: 'Next week', note: 'posts Mon–Fri', Cell: ContentCell },
  { id: 'drafts', label: 'Drafts', note: 'DMs for you', Cell: DraftsCell },
  { id: 'invites', label: 'Invites', note: 'sent today', Cell: InvitesCell },
  { id: 'ready', label: 'Ready', note: 'the sender would pick', Cell: ReadyCell },
  { id: 'limit', label: 'Rate limit', note: 'LinkedIn', Cell: LimitCell },
]

/** Phone: the same rows, a full-width head per row and three narrow seat columns under it. */
export function GlancePhone({ seats, g }: { seats: Seat[]; g: GlanceCtx }) {
  return (
    <section className="gl-phone" aria-label="At a glance">
      <div className="gl-pseats" style={{ gridTemplateColumns: `repeat(${seats.length}, minmax(0, 1fr))` }}>
        {seats.map(s => <b key={s}>{SEAT_NAME[s]}</b>)}
      </div>
      {GLANCE_ROWS.map(({ id, label, note, Cell }) => (
        <div key={id} className="gl-prow" data-glance={id}>
          <div className="gl-phead">{label}<small>{note}</small></div>
          <div className="gl-pcols" style={{ gridTemplateColumns: `repeat(${seats.length}, minmax(0, 1fr))` }}>
            {seats.map(s => <div key={s} data-seat={s}><Cell seat={s} g={g} /></div>)}
          </div>
        </div>
      ))}
    </section>
  )
}
