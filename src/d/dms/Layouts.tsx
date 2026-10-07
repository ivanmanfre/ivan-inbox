// The two canvases. Desktop: bar, three seat squares, ONE list for the chosen seat and the
// conversation pane. Phone: the squares as a 3-up strip, the list; the conversation is its own page.
import type { RefObject } from 'react'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import type { FilterToken } from '../../lib/filterTokens'
import type { Thread } from '../../lib/inbox'
import { dmNumbers, type FrameCounts } from '../counts/useFrameCounts'
import type { Layout } from '../places'
import { SEATS, SEAT_NAME, seatOf, type Seat } from '../seats'
import { usePull } from './usePull'
import { useRef, type ReactNode } from 'react'
import { Empty, Failed, Skeleton } from '../ui/states'
import { Bar, BulkBar, Folders, Headline, Health, noDraftLine } from './Chrome'
import { ColumnBody, type Mode } from './Column'
import type { MenuAct } from './Menu'
import type { DayOut, SeatView } from './model'
import { SearchField, TokenBar } from './Search'
import { SeatSquares, type SquareStat } from './SeatSquares'
import { CameSignal } from './CameSignal'
import type { CameTag } from './signals'
import { ThreadPane } from './Thread'
import type { RowCtx } from './threadRows'
import type { DmsData } from './useDmsData'
import type { DmVerbs } from './verbs'
import type { WarmVerbs } from './warmVerbs'
import { ListHead, SeatSeg } from './v4/Chrome'
import { DesktopDmsV4, ListScroll, PhoneDmsV4 } from './v4/Layout'

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
  seat: Seat; setSeat: (s: Seat) => void; setFolder: (f: string | null) => void
  /** Came-back tags by person, and their Dismiss (today's came_back_dismiss + Undo). */
  came: ReadonlyMap<string, CameTag>; dismissCame: (pid: string, name: string) => Promise<void>
  /** Brief 4 (skin section `dms`): the v4 layouts. Read once per render in Dms(), above any branch. */
  v4: boolean
  /** Brief 4: the open thread registers its unsaved check here (SPEC-dms §3.4). */
  registerGuard: (f: (() => boolean) | null) => void
}

function rowCtx(m: PageModel): RowCtx {
  return { selected: m.open?.prospect_id ?? m.threadId, checked: m.checked, open: m.openThread, now: m.now, verbs: m.verbs, busy: m.busy, setBusy: m.setBusy, fail: m.fail, pre: m.pre, more: m.rowMore, came: m.came, v4: m.v4 }
}

function Body({ m, seat }: { m: PageModel; seat: Seat }) {
  const d = m.data
  if (!d.threads.length && d.loading) return <Skeleton lines={6} label={`Reading ${SEAT_NAME[seat]}'s conversations`} />
  if (!d.threads.length && d.error) return <Failed what="the conversations" detail={d.error} onRetry={d.refreshAll} />
  return <ColumnBody seat={seat} view={m.views[seat]} mode={m.mode} matches={m.matches[seat]} c={rowCtx(m)} byId={m.byId}
    cameBack={d.cameBack} dropCameBack={d.dropCameBack} warm={d.warm} agent={d.agent} warmVerbs={m.warmVerbs} openWarm={m.openWarm} dated={d.dated.rows} upcoming={d.upcoming} scanDays={d.scanDays} stale={m.staleBy[seat]} toEmail={() => m.setFolder('email')} />
}

function Pane({ m, phone }: { m: PageModel; phone: boolean }) {
  const t = m.open
  if (!t) {
    if (m.threadId && m.data.loading) return <section className="dm-pane"><Skeleton lines={8} label="Opening the conversation" /></section>
    if (m.threadId) return <section className="dm-pane"><Empty title="This conversation is not in the list." reason="It may have been deleted from the seat, or it is not a conversation yet (nobody wrote back)." /></section>
    return <section className="dm-pane dm-pane-none"><Empty title="Pick a conversation." /></section>
  }
  const tag = m.came.get(t.prospect_id)
  return <ThreadPane t={t} auto={m.auto} all={m.threads} phone={phone} verbs={m.verbs} now={m.now} onBack={m.closeThread} v4={m.v4} registerGuard={m.v4 ? m.registerGuard : undefined}
    signal={tag ? <CameSignal tag={tag} onDismiss={() => m.dismissCame(t.prospect_id, t.prospect_name)} /> : null}
    onAsk={() => m.ask(t, 'ask')} onDraftStart={() => m.openThread(t)} onMenu={a => m.onMenu(t, a)} staleN={m.staleBy[seatOf(t.client_id) ?? 'ivan'].length} pre={m.pre} reload={m.data.refreshAll} />
}

function squareStats(m: PageModel): Record<Seat, SquareStat> {
  const known = Boolean(m.data.loadedAt || m.data.fromCache)
  return Object.fromEntries(SEATS.map(s => [s, {
    replied: known ? m.stats[s].replied : null,
    today: m.stats[s].days.at(-1),
    extra: m.mode === 'search' ? `${m.matches[s].length} match${m.matches[s].length === 1 ? '' : 'es'}`
      : m.mode === 'email' ? `${m.views[s].emailWaiting.length} email waiting`
        : m.mode === 'spam' ? (s === 'ivan' ? 'no spam folder' : `${m.views[s].spam.length} likely spam`) : null,
  }])) as Record<Seat, SquareStat>
}

export function DesktopDms({ m }: { m: PageModel }) {
  const s = m.seat
  if (m.v4) {
    const bulk = m.checked.size > 0
    const sq = squareStats(m)
    return <DesktopDmsV4 seat={s} replied={sq[s].replied} today={sq[s].today}
      headline={<Headline mode={m.mode} views={m.views} counts={m.counts} noSub tools={<>
        <SeatSeg seat={s} pick={m.setSeat} needs={dmNumbers(m.counts, 'needs')} drafts={dmNumbers(m.counts, 'drafts')} stats={sq} />
        <span className="dx-grow" />
        {noDraftLine(m.views) && <span className="dx-nodraft">{noDraftLine(m.views)}</span>}
        <SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} />
      </>} />}
      head={bulk
        ? <BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />
        : <ListHead pick={m.folder ?? ''} folders={<Folders v4 folder={m.folder} setFolder={m.setFolder} views={m.views} />} filter={<TokenBar tokens={m.tokens} setTokens={m.setTokens} />} />}
      health={<div className="dx-health"><Health data={m.data} /></div>}
      list={<ListScroll key={`${s}:${m.folder ?? ''}:${m.mode}`}><Body m={m} seat={s} /></ListScroll>}
      pane={<Pane m={m} phone={false} />} />
  }
  return (
    <div className="dm-page dm-desk">
      <Headline mode={m.mode} views={m.views} counts={m.counts} tools={<SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} />} />
      <Bar folder={m.folder} setFolder={m.setFolder} views={m.views} tokens={m.tokens} setTokens={m.setTokens} data={m.data} />
      <BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />
      <SeatSquares seat={s} pick={m.setSeat} needs={dmNumbers(m.counts, 'needs')} drafts={dmNumbers(m.counts, 'drafts')} stats={squareStats(m)} />
      <div className="dm-grid4">
        <section className="dm-col dm-list" aria-label={`${SEAT_NAME[s]}'s conversations`} data-seat={s}>
          <div className="dm-colscroll"><Body m={m} seat={s} /></div>
        </section>
        <Pane m={m} phone={false} />
      </div>
    </div>
  )
}

export function PhoneDms({ m }: { m: PageModel }) {
  if (m.threadId) return <div className={`dm-page dm-phone dm-phone-thread${m.v4 ? ' dx-phone' : ''}`} data-v4-guard={m.v4 ? '' : undefined}><Pane m={m} phone /></div>
  const s = m.seat
  const st = m.stats[s]
  const today = st.days.at(-1)
  if (m.v4) {
    const sq = squareStats(m)
    return <PhoneDmsV4 seat={s}
      headline={<Headline mode={m.mode} views={m.views} counts={m.counts} />}
      seats={<SeatSeg phone seat={s} pick={m.setSeat} needs={dmNumbers(m.counts, 'needs')} drafts={dmNumbers(m.counts, 'drafts')} stats={sq} />}
      stat={<div className="dm-pstat">replied 7d <b>{st.replied}</b> · today <b>{today?.msg ?? 0}</b> msgs <b>{today?.inv ?? 0}</b> inv · <Health data={m.data} /></div>}
      search={<div className="dm-psearch"><SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} phone /><TokenBar tokens={m.tokens} setTokens={m.setTokens} /></div>}
      folders={<Folders v4 folder={m.folder} setFolder={m.setFolder} views={m.views} phone />}
      bulk={<BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />}
      list={<PullList onRefresh={m.refreshAll}><Body m={m} seat={s} /></PullList>} />
  }
  return (
    <div className="dm-page dm-phone">
      <Headline mode={m.mode} views={m.views} counts={m.counts} />
      <SeatSquares phone seat={s} pick={m.setSeat} needs={dmNumbers(m.counts, 'needs')} drafts={dmNumbers(m.counts, 'drafts')} stats={squareStats(m)} />
      <div className="dm-pstat">replied 7d <b>{st.replied}</b> · today <b>{today?.msg ?? 0}</b> msgs <b>{today?.inv ?? 0}</b> inv · <Health data={m.data} /></div>
      <div className="dm-psearch"><SearchField ref={m.searchRef} q={m.q} setQ={m.setQ} reach={m.data.threads.length || null} phone /><TokenBar tokens={m.tokens} setTokens={m.setTokens} /></div>
      <Folders folder={m.folder} setFolder={m.setFolder} views={m.views} phone />
      <BulkBar checked={m.checked} byId={m.byId} clear={() => m.setChecked(new Set())} onDiscard={ts => { void m.verbs.bulkDiscard(ts, 'The selected drafts.').then(() => m.setChecked(new Set())) }} />
      <section className="dm-col dm-list" aria-label={`${SEAT_NAME[s]}'s conversations`} data-seat={s}>
        <PullList onRefresh={m.refreshAll}><Body m={m} seat={s} /></PullList>
      </section>
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
