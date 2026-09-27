// The two canvases. Desktop: bar, three seat columns (each scrolls) and the conversation pane.
// Phone: seat tiles switch the one seat list; the conversation is its own page.
import type { RefObject } from 'react'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import type { FilterToken } from '../../lib/filterTokens'
import type { Thread } from '../../lib/inbox'
import { dmNumbers, type FrameCounts } from '../counts/useFrameCounts'
import type { Layout } from '../places'
import { SEATS, SEAT_NAME, SEAT_OWNER, seatOf, type Seat } from '../seats'
import { useFrameMaybe } from '../shell/frame'
import { usePull } from './usePull'
import { useRef, type ReactNode } from 'react'
import { Empty, Failed, Skeleton } from '../ui/states'
import { Bar, BulkBar, Folders, Headline, Health } from './Chrome'
import { ColumnBody, type Mode } from './Column'
import type { MenuAct } from './Menu'
import { SCHEDULE, type DayOut, type SeatView } from './model'
import { SearchField, TokenBar } from './Search'
import { Bars, Plate, SeatStats } from './SeatStats'
import { ThreadPane } from './Thread'
import type { RowCtx } from './threadRows'
import type { DmsData } from './useDmsData'
import type { DmVerbs } from './verbs'
import type { WarmVerbs } from './warmVerbs'

export type PageModel = {
  layout: Layout; mode: Mode; folder: string | null
  q: string; setQ: (s: string) => void; tokens: FilterToken[]; setTokens: (t: FilterToken[]) => void; searchRef: RefObject<HTMLInputElement | null>
  views: Record<Seat, SeatView>; stats: Record<Seat, { days: DayOut[]; replied: number }>; matches: Record<Seat, Thread[]>
  open: Thread | null; threadId: string | null; auto: boolean; threads: Thread[]; byId: ReadonlyMap<string, Thread>
  data: DmsData; counts: FrameCounts; verbs: DmVerbs; warmVerbs: WarmVerbs; now: number; fail: (m: string) => void; openWarm: (pid: string) => void
  busy: string | null; setBusy: (s: string | null) => void; checked: Set<string>; setChecked: (s: Set<string>) => void
  openThread: (t: Thread) => void; closeThread: () => void; ask: (t: Thread, i: 'ask' | 'draft') => void
  onMenu: (t: Thread, a: MenuAct) => void; staleN: number; pre: PreReadHandle
  staleBy: Record<Seat, Thread[]>; rowMore: (t: Thread) => void; refreshAll: () => void
  phoneSeat: Seat; setPhoneSeat: (s: Seat) => void; setFolder: (f: string | null) => void
}

function rowCtx(m: PageModel): RowCtx {
  return { selected: m.open?.prospect_id ?? m.threadId, checked: m.checked, open: m.openThread, now: m.now, verbs: m.verbs, busy: m.busy, setBusy: m.setBusy, fail: m.fail, pre: m.pre, more: m.rowMore }
}

function Body({ m, seat }: { m: PageModel; seat: Seat }) {
  const d = m.data
  if (!d.threads.length && d.loading) return <Skeleton lines={6} label={`Reading ${SEAT_NAME[seat]}'s conversations`} />
  if (!d.threads.length && d.error) return <Failed what="the conversations" detail={d.error} onRetry={d.refreshAll} />
  return <ColumnBody seat={seat} view={m.views[seat]} mode={m.mode} matches={m.matches[seat]} c={rowCtx(m)} byId={m.byId}
    cameBack={d.cameBack} dropCameBack={d.dropCameBack} warm={d.warm} agent={d.agent} warmVerbs={m.warmVerbs} openWarm={m.openWarm} dated={d.dated.rows} scanDays={d.scanDays} stale={m.staleBy[seat]} />
}

function Pane({ m, phone }: { m: PageModel; phone: boolean }) {
  const t = m.open
  if (!t) {
    if (m.threadId && m.data.loading) return <section className="dm-pane"><Skeleton lines={8} label="Opening the conversation" /></section>
    if (m.threadId) return <section className="dm-pane"><Empty title="This conversation is not in the list." reason="It may have been deleted from the seat, or it is not a conversation yet (nobody wrote back)." /></section>
    return <section className="dm-pane dm-pane-none"><Empty title="Pick a conversation." reason="j and k walk the rows, Enter opens one, / searches every message on every seat." /></section>
  }
  return <ThreadPane t={t} auto={m.auto} all={m.threads} phone={phone} verbs={m.verbs} now={m.now} onBack={m.closeThread}
    onAsk={() => m.ask(t, 'ask')} onDraftIt={() => m.ask(t, 'draft')} onMenu={a => m.onMenu(t, a)} staleN={m.staleBy[seatOf(t.client_id) ?? 'ivan'].length} pre={m.pre} reload={m.data.refreshAll} />
}

export function DesktopDms({ m }: { m: PageModel }) {
  const needs = dmNumbers(m.counts, 'needs')
  const fold = !!useFrameMaybe()?.claudeOpen
  return (
    <div className="dm-page dm-desk">
      <Headline mode={m.mode} views={m.views} counts={m.counts} tools={<SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} />} />
      <Bar folder={m.folder} setFolder={m.setFolder} views={m.views} tokens={m.tokens} setTokens={m.setTokens} data={m.data} />
      <BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />
      <div className={`dm-grid${fold ? ' dm-grid-cf' : ''}`}>
        {fold && (
          // Claude docked (mock dark-claude.html): the three columns fold into one list,
          // a subhead and a count per seat, never one total. Closing Claude brings them back.
          <section className="dm-col dm-cf" aria-label="Conversations, every seat">
            <div className="dm-colscroll">
              {SEATS.map(s => (
                <div key={s} className="dm-cf-seat">
                  <div className="dm-cf-h"><b>{SEAT_NAME[s]}</b><em className={needs[s] ? '' : 'dm-z'}>{needs[s] ?? '?'}</em><span>{SEAT_OWNER[s]}</span></div>
                  <Body m={m} seat={s} />
                </div>
              ))}
              <div className="dm-cf-note">Close Claude (⌘J) and the three seat columns come back.</div>
            </div>
          </section>
        )}
        {!fold && SEATS.map(s => (
          <section key={s} className="dm-col" aria-label={`${SEAT_NAME[s]}'s conversations`}>
            <Plate seat={s} />
            <SeatStats seat={s} needs={needs[s]} nodraft={m.views[s].nodraft.length} replied={m.data.loadedAt || m.data.fromCache ? m.stats[s].replied : null} days={m.stats[s].days} />
            <div className="dm-colscroll"><Body m={m} seat={s} /></div>
          </section>
        ))}
        <Pane m={m} phone={false} />
      </div>
    </div>
  )
}

export function PhoneDms({ m }: { m: PageModel }) {
  const needs = dmNumbers(m.counts, 'needs')
  if (m.threadId) return <div className="dm-page dm-phone dm-phone-thread"><Pane m={m} phone /></div>
  const s = m.phoneSeat
  const st = m.stats[s]
  const today = st.days.at(-1)
  return (
    <div className="dm-page dm-phone">
      <Headline mode={m.mode} views={m.views} counts={m.counts} />
      <div className="dm-tiles" role="tablist" aria-label="Seats">
        {SEATS.map(x => (
          <button key={x} type="button" role="tab" aria-selected={x === s} className={`dm-tile${x === s ? ' dm-on' : ''}`} onClick={() => m.setPhoneSeat(x)}>
            <b>{SEAT_NAME[x]}</b><small>{x === 'ivan' ? 'your seat' : x === 'risedtc' ? "Mattan's seat" : "Davorin's seat"}</small>
            <em className={needs[x] ? 'dm-hot' : 'dm-zero'}>{needs[x] ?? '…'}</em>
            <Bars days={m.stats[x].days} tall />
          </button>
        ))}
      </div>
      <div className="dm-pstat">replied 7d <b>{st.replied}</b> · today <b>{today?.msg ?? 0}</b> msgs <b>{today?.inv ?? 0}</b> inv<br />{SCHEDULE[s].replace(/^sends /, '')} · <Health data={m.data} /></div>
      <div className="dm-psearch"><SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} phone /><TokenBar tokens={m.tokens} setTokens={m.setTokens} /></div>
      <Folders folder={m.folder} setFolder={m.setFolder} views={m.views} phone />
      <BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />
      <PullList onRefresh={m.refreshAll}><Body m={m} seat={s} /></PullList>
    </div>
  )
}

/** Phone: pull the list down at the top to re-read it (today's pull-to-refresh on the DMs list). */
function PullList({ onRefresh, children }: { onRefresh: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const ptr = usePull(ref, onRefresh)
  return (
    <div className="dm-plist" ref={ref}>
      <div className="dm-ptr" style={{ height: ptr.pull }} aria-live="polite">{ptr.refreshing ? 'Reading…' : ptr.pull >= ptr.trigger ? 'Release to refresh' : ptr.pull > 0 ? 'Pull to refresh' : ''}</div>
      {children}
    </div>
  )
}
