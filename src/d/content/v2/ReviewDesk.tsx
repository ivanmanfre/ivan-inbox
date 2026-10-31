import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DraftSaveConflict, clientDeletable, clientEditable, pictureEditable, saveClientDraftBody, saveDraftBody, taxonomyValue, type ContentDraft } from '../../../lib/content'
import { sourceOf } from '../../../lib/brainPage'
import { reasonLabel } from '../../../lib/verdicts'
import type { PatternRead } from '../../../lib/earlyReads'
import { ConfirmProvider } from '../../../wb/chrome/ConfirmSheet'
import { RetryDraft } from '../../../wb/content/actions'
import { dHash } from '../../route'
import { Sheet } from '../../ui/Sheet'
import { Failed } from '../../ui/states'
import { useToast } from '../../ui/toast'
import { warsawDay, warsawDm, warsawDow, warsawHm } from '../../ui/time'
import { BrainDraftBadge } from '../BrainDraftBadge'
import { SourceCol, useSources } from '../ContentBrain'
import { undoDecision, usePendingDecisions } from '../decisions'
import { EarlyReadChip } from '../EarlyReadChip'
import { MovePanel } from '../MovePanel'
import { usePanelLink } from '../panelLink'
import { LANES, OWNER, POSS, age, dayLabel, nextFreeWeekday, ptOf, splitTitleTag, type Lane, type Slot } from '../model'
import { PictureRow } from '../PictureRow'
import { useRowVerbs } from '../rowVerbs'
import { useEarlyReads } from '../useEarlyReads'
import type { WeekRead } from '../useWeek'
import { forgetVerdict, giveReason, markShown, retryVerdict, undoVerdict, useJudged, VERDICT_HOLD_MS, type Judged } from '../verdictStore'
import { useWeekVerbs } from '../weekVerbs'
import { awaitsReview, reviewCounts, type Week, type WeekCard } from '../weekModel'
import { useReviewMotion } from './motion'
import { clientHoldOf } from '../../../lib/clientBoardState'
import { LinkedInCard } from './LinkedInCard'
import { picRepeats, type Repeat } from './picRepeat'
import { sourceTag, type SourceTagView } from './sourceTag'
import { Answer, Menu, Pill, SeatAv, Seg, useDeferred, type MenuItem, type Tone } from './ui'
import { DIcon } from '../../ui/icons'
import './review-list.css'

// CONTENT > REVIEW, THE ONE DESK. One seat at a time (Ivan 2026-10-15: "I will see it per client always"),
// every draft to decide as ONE ROW: where it came from first (the source tag), the hook, its tags, age and
// status, the keys at the row's end. The detail panel stays for the open one; `o` or the chevron opens the
// LinkedIn preview and the picture controls in place.
//
// THE COUNTS ARE ONE SET. The seat tab, the heading and the open post's "N of M" are the same list:
// deskModel(week).decide, the drafts awaitsReview() counts (reviewCounts), in the order they are drawn.
// Decided cards still waiting for a date and the drafts that need a fix sit under the list, each with its
// own count, never inside the to-decide number.
//
// Writes are today's functions, unchanged: useWeekVerbs (Approve held 8 s, board and schedule confirmed),
// verdictStore.judge + giveReason (held 5 s), useRowVerbs (Skip held 8 s), PictureRow.write (Undo),
// MovePanel (stored-day receipt).

/** The desk's seats, in tab order. There is no "All" seat. */
export const DESK_SEATS: readonly Lane[] = LANES
const SEAT_WORD: Record<Lane, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch', swishdm: 'SwishDM' }
/** A remembered or linked seat; anything else ('all', a retired value, nothing) opens on Ivan. */
export const deskSeatOf = (v: unknown): Lane => (DESK_SEATS as readonly unknown[]).includes(v) ? v as Lane : 'ivan'

/** The drop reasons, in the order he drops for (SPEC §2.2): every slug is one cb39_verdict_set already takes. */
export const DESK_REASONS: readonly (readonly [string, string, string])[] = [
  ['invented_fact', 'Invented a fact', '1'],
  ['not_my_voice', 'Not my voice', '2'],
  ['already_said', 'Already said', '3'],
  ['weak_hook', 'Weak hook', '4'],
  ['needs_proof', 'Needs proof', '5'],
  ['wrong_topic', 'Wrong topic', '6'],
  ['other', 'Other', '0'],
]

/** The card's one status pill (SPEC §2.3 table). */
export function pillOf(c: WeekCard): { tone: Tone; text: string } {
  const has = (k: string) => c.flags.find(f => f.key === k)
  const f = has('blocked') ?? has('stuck') ?? has('stalled') ?? has('error')
  if (f) return { tone: 'bad', text: f.text }
  if (has('posted')) return { tone: 'posted', text: has('posted')!.text.replace(/^Posted ?/, '✓ ') || '✓ Posted' }
  if (has('kept')) return { tone: 'ok', text: 'Approved' }
  if (has('armed')) return { tone: 'ok', text: 'Scheduled' }
  if (has('planned')) return { tone: 'warn', text: has('planned')!.text }
  if (has('board')) return { tone: 'neutral', text: 'On board' }
  if (c.r.status === 'approved') return { tone: 'ok', text: 'Approved' }
  return { tone: 'info', text: 'Needs review' }
}

/** The seat's next step on a decided card (upgrade #5). Never before the verdict is saved: callers gate on that. */
export type Next = 'schedule' | 'board' | 'date'
export function nextOf(c: WeekCard): Next | null {
  if (c.r.published_at) return null
  if (c.lane === 'ivan') return c.r.status === 'approved' ? 'schedule' : null
  if (c.lane === 'risedtc') return c.kept && c.r.board_visible !== true && c.r.status === 'review' ? 'board' : null
  return c.kept ? 'date' : null
}

const createdMs = (c: WeekCard) => Date.parse(c.r.created_at) || 0
// Dated drafts first (soonest first), then the newest. One order for the list, its keys and the open post's j/k.
const deskOrder = (a: WeekCard, b: WeekCard) => {
  const x = a.r.scheduled_at, y = b.r.scheduled_at
  if (x && !y) return -1
  if (!x && y) return 1
  if (x && y && x !== y) return x < y ? -1 : 1
  return createdMs(b) - createdMs(a) || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0)
}

export type DeskModel = {
  /** Every row of the to-decide list in drawn order: the counted drafts plus any open verdict strip in its place. */
  decide: WeekCard[]
  /** Decided, the seat's next step still open (a date, the board). Not counted as to decide. */
  waiting: WeekCard[]
  board: WeekCard[]
  /** Errors and posts that did not go out; `pinned` are the misses of the last 48 h, shown open. */
  fix: WeekCard[]
  pinned: WeekCard[]
  /** The ids the seat tab counts, in drawn order: the open post walks exactly these. */
  queue: string[]
}

/** Pure: the desk's sections from a seat's week (buildNow with `show` set). */
export function deskModel(week: Week, now: number): DeskModel {
  const fixGroup = week.groups.find(g => g.key === 'fix')?.cards ?? []
  const drafts = week.groups.find(g => g.key === 'drafts')?.cards ?? []
  const board = (week.groups.find(g => g.key === 'board')?.cards ?? []).slice().sort(deskOrder)
  const all = [...fixGroup, ...drafts]
  const decide = all.filter(c => c.strip || awaitsReview(c)).sort(deskOrder)
  const waiting = drafts.filter(c => !c.strip && !awaitsReview(c)).sort(deskOrder)
  const fix = fixGroup.filter(c => !c.strip && !awaitsReview(c))
  const pinned = fix.filter(c => c.flags.some(f => f.key === 'stuck') && !!c.r.scheduled_at && now - Date.parse(c.r.scheduled_at) < 2 * 86_400_000)
  return { decide, waiting, board, fix, pinned, queue: decide.filter(c => awaitsReview(c)).map(c => c.r.id) }
}

const slotWord = (s: Slot) => `${warsawDow(s.at)} ${warsawDm(s.at).split(' ')[0]} · ${warsawHm(s.at)}`

export function ReviewDesk({ week, total, read, show, setShow, now, openId, focusId, onOpen, onEdit, onChanged, firstDay, seatRows, rows, armed, armedFailed, held, boardRead }: {
  /** The desk's cards (buildNow for this seat). */
  week: Week
  /** Every seat's work (buildNow without the filter): the seat counts. */
  total: Week
  read: WeekRead
  show: Lane
  setShow: (s: Lane) => void
  now: number
  openId: string | null
  /** A card to land on (Content Brain's "Up next", an idea's draft). */
  focusId: string | null
  onOpen: (id: string, lane: Lane) => void
  /** Details with the editor open. */
  onEdit: (id: string, lane: Lane) => void
  onChanged: () => void
  firstDay: string
  seatRows: (lane: Lane) => ContentDraft[]
  /** Every row the page holds (the picture-repeat check reads across days). */
  rows: ContentDraft[]
  armed: Set<string> | null
  armedFailed: boolean
  /** Brain drafts held in place while a refresh re-reads them (steadyRows). */
  held?: ReadonlySet<string>
  boardRead?: { loading: boolean; error: string | null; loadedAt: string | null; refresh: () => void }
}) {
  const toast = useToast()
  const panelHref = usePanelLink()(show)
  const judged = useJudged()
  const pending = usePendingDecisions()
  const [busy, setBusy] = useState<string | null>(null)
  const [moving, setMoving] = useState<WeekCard | null>(null)
  const [fixOpen, setFixOpen] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(focusId)
  const [more, setMore] = useState<ReadonlySet<string>>(() => new Set())
  const [keys, setKeys] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  useReviewMotion(list)

  const verbs = useWeekVerbs({ ids: week.ids, onChanged, onOpen, setBusy })
  const rowVerbs = useRowVerbs(onChanged)
  const slot = useMemo(() => (armed ? nextFreeWeekday(armed, now) : armedFailed ? nextFreeWeekday(new Set(), now) : null), [armed, armedFailed, now])

  const desk = useMemo(() => deskModel(week, now), [week, now])
  const work = desk.decide.filter(c => awaitsReview(c))
  const stream = desk.decide
  const inList = new Set([...desk.decide, ...desk.waiting, ...desk.board, ...desk.fix].map(c => c.r.id))
  const orphans = [...judged.values()].filter(e => !e.collapsed && !inList.has(e.id) && show === e.lane).sort((a, b) => a.at - b.at)
  const folded = desk.fix.filter(c => !desk.pinned.includes(c))

  const shownCards = [...desk.pinned, ...stream, ...(waitOpen ? desk.waiting : []), ...(fixOpen ? folded : []), ...desk.board]
  const earlyReads = useEarlyReads(shownCards.map(c => c.r))
  const srcKey = stream.slice(0, 60).map(c => c.r.id).join(',')
  const srcIds = useMemo(() => (srcKey ? srcKey.split(',') : []), [srcKey])
  const sources = useSources(srcIds)
  const repeats = useMemo(() => picRepeats(rows), [rows])
  const created = work.map(createdMs).filter(t => t > 0)
  const loading = read.source === 'none' && !read.settled
  const ghosts = useDeferred(loading)

  const waitIds = desk.waiting.map(c => c.r.id).join(',')
  const foldIds = folded.map(c => c.r.id).join(',')
  useLayoutEffect(() => {
    if (!focusId) return
    if (folded.some(c => c.r.id === focusId)) setFixOpen(true)
    if (desk.waiting.some(c => c.r.id === focusId)) setWaitOpen(true)
  }, [focusId, waitIds, foldIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus lands on the first row, or on the row Content Brain sent.
  const rowIds = useMemo(() => shownCards.filter(c => !c.strip).map(c => c.r.id), [shownCards.map(c => `${c.r.id}:${c.strip}`).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focus && (rowIds.includes(focus) || !rowIds.length)) return
    setFocus(rowIds[0] ?? null)
  }, [rowIds, focus])
  useEffect(() => {
    if (!focusId) return
    setFocus(focusId)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${focusId}"]`)?.scrollIntoView?.({ block: 'center' }))
  }, [focusId, rowIds.join(','), fixOpen, waitOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardOf = (id: string | null) => shownCards.find(c => c.r.id === id) ?? null
  const moveFocus = (dir: 1 | -1) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.cv2-review article[data-card-id]'))
    if (!els.length) return
    const i = els.findIndex(el => el.dataset.cardId === focus)
    const next = els[Math.min(els.length - 1, Math.max(0, i < 0 ? 0 : i + dir))]
    setFocus(next.dataset.cardId ?? null)
    next.focus({ preventScroll: true })
    next.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }
  const toggleMore = (id: string, v?: boolean) => setMore(m => { const n = new Set(m); if (v ?? !n.has(id)) n.add(id); else n.delete(id); return n })

  const approveCard = (c: WeekCard) => {
    if (c.judge) void verbs.judgeIt(c, 'keep')
    else if (c.primary === 'approve') verbs.approve(c)
  }
  // judgeIt never waits on a Drop (only Approve on an errored Ivan draft asks first), so the held verdict exists
  // when it returns: the reason rides along with it in ONE write, exactly ContentBrain's judge + giveReason.
  const dropWith = (c: WeekCard, slug: string, note: string | null) => {
    if (c.lane === 'swishdm') return
    setPicking(null)
    void verbs.judgeIt(c, 'drop')
    giveReason(c.r.id, slug, note)
  }

  // The desk's keys (SPEC §2.2 table). Ignored in a field, with a modifier, under a dialog or sheet, and while
  // the open post owns the keyboard (DraftWindow captures j/k/Enter/Esc itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('.d-confirm, .d-sheet, .cn-media-viewer[open], .cv2-menu:not([hidden])')) return
      if (openId) return
      const c = cardOf(focus)
      if (picking && c && c.r.id === picking) {
        const r = DESK_REASONS.find(x => x[2] === e.key)
        if (r) { e.preventDefault(); if (r[0] === 'other') document.querySelector<HTMLButtonElement>(`[data-card-id="${c.r.id}"] [data-reason="other"]`)?.click(); else dropWith(c, r[0], null); return }
        if (e.key === 'Escape') { e.preventDefault(); setPicking(null); return }
      }
      if (e.key === 'j') { e.preventDefault(); moveFocus(1) }
      else if (e.key === 'k') { e.preventDefault(); moveFocus(-1) }
      else if (e.key === '?') { e.preventDefault(); setKeys(true) }
      else if (e.key === 'z') {
        const heldV = [...judged.values()].filter(x => x.phase === 'held').sort((a, b) => b.at - a.at)[0]
        if (heldV) { e.preventDefault(); undoVerdict(heldV.id); return }
        const last = [...pending.keys()].pop()
        if (last && undoDecision(last)) { e.preventDefault(); toast.show({ id: `decide-${last}`, message: 'Undone. Nothing was written.' }) }
      }
      else if (!c) return
      else if (e.key === 'a') { e.preventDefault(); approveCard(c) }
      else if (e.key === 'd' && c.judge && c.lane !== 'swishdm') { e.preventDefault(); setPicking(c.r.id) }
      else if (e.key === 'e') { e.preventDefault(); onEdit(c.r.id, c.lane) }
      else if (e.key === 'Enter' && !(el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName))) { e.preventDefault(); onOpen(c.r.id, c.lane) }
      else if (e.key === 'o') { e.preventDefault(); toggleMore(c.r.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const counts = reviewCounts(total)
  const who = show === 'ivan' ? 'Ivan’s ' : `${OWNER[show]}’s `
  const n = work.length
  const oldestFix = folded.length ? Math.max(...folded.map(c => now - createdMs(c))) : 0
  // Routine member rechecks run every few seconds; saying so each time made the heading flicker too. Only a
  // failed check (brain drafts hidden) and a saved copy on screen are worth a word.
  const sync = read.memberReadState === 'failed' ? 'Brain drafts are hidden until visibility can be verified.'
    : read.source === 'cache' && !read.error ? `saved copy ${read.at ? warsawHm(read.at) : ''}, refreshing` : null

  // The same client hold on every card ("Finish onboarding…") is said once above the grid (Ivan 2026-10-30).
  const holdOf = (c: WeekCard) => c.lane === 'ivan' ? null : clientHoldOf(c.r, OWNER[c.lane])
  const holds = stream.filter(c => !c.strip).map(c => { const h = holdOf(c); return h && h.kind !== 'changes' ? h.detail ?? '' : '' })
  const sharedHold = holds.length > 1 && holds[0] && holds.every(h => h === holds[0]) ? holds[0] : null
  const sharedHoldWord = sharedHold ? holdOf(stream.find(c => !c.strip)!)?.text ?? null : null

  const renderRow = (c: WeekCard, i: number) => {
    const e = c.strip ? judged.get(c.r.id) : undefined
    if (e) return <DeskStrip key={c.r.id} e={e} c={c} i={i} slot={slot} busy={busy === c.r.id} verbs={verbs} onDate={() => setMoving(c)} />
    return (
      <ReviewRow key={c.r.id} c={c} i={i} now={now} grid={!openId} focused={c.r.id === focus} open={c.r.id === openId} busy={busy === c.r.id} held={!!held?.has(c.r.id)}
        read={earlyReads.get(c.r.id)} repeat={repeats.get(c.r.id)} slot={slot}
        src={sourceOf(c.r, sources.map.get(c.r.id))} srcLoading={!sources.map.has(c.r.id) && sources.pending}
        more={more.has(c.r.id)} setMore={v => toggleMore(c.r.id, v)} hideHold={!!sharedHold && holdOf(c)?.detail === sharedHold}
        picking={picking === c.r.id} setPicking={v => setPicking(v ? c.r.id : null)}
        onFocus={() => setFocus(c.r.id)}
        onOpen={() => onOpen(c.r.id, c.lane)} onEdit={() => onEdit(c.r.id, c.lane)}
        onApprove={() => approveCard(c)} onDrop={(slug, note) => dropWith(c, slug, note)}
        onSkip={() => void rowVerbs.run(c.r, c.lane, 'skip')}
        onBoard={() => void verbs.board(c)} onSchedule={(at?: Date) => void verbs.schedule(c, at)} onDate={() => setMoving(c)}
        onChanged={onChanged} />
    )
  }
  const fixRow = (c: WeekCard) => {
    const tag = sourceTag(c.r, OWNER[c.lane])
    return (
      <article key={c.r.id} className="cv2-fixrow" data-card-id={c.r.id} data-lane={c.lane} tabIndex={c.r.id === focus ? 0 : -1} aria-current={c.r.id === focus ? 'true' : undefined} onFocus={() => setFocus(c.r.id)}>
        <SourceChip tag={tag} />
        <span className="cv2-fixt"><b>{splitTitleTag(c.title).text}</b><small>{[...c.flags.filter(f => f.tone === 'warn').map(f => f.text), `created ${age(c.r.created_at, now)} ago`].join(' · ')}</small></span>
        {c.lane !== 'arch' && <ConfirmProvider><RetryDraft d={c.r} lane={c.lane} onDone={onChanged} label="Fix" /></ConfirmProvider>}
        {(c.lane === 'ivan' || clientDeletable(c.lane, c.r.board_visible)) && <button type="button" className="cv2-k cv2-k-q" data-verb="card-delete" disabled={rowVerbs.busy === c.r.id} onClick={() => void rowVerbs.run(c.r, c.lane, 'delete')}>Delete</button>}
        <button type="button" className="cv2-k" data-verb="card-open" onClick={() => onOpen(c.r.id, c.lane)}>Open</button>
      </article>
    )
  }

  return (
    <section className="cv2 cv2-review" aria-label="Review" data-cv2="review">
      <div className="cv2-bar">
        <Seg label="Seat" verb="show" value={show} onChange={id => setShow(id as Lane)}
          options={DESK_SEATS.map(s => ({ id: s, label: <><SeatAv lane={s} />{SEAT_WORD[s]}</>, count: loading ? '…' : counts[s] }))} />
        <span className="cv2-grow" />
        {panelHref && <a className="cv2-k cv2-panel" href={panelHref} target="_blank" rel="noreferrer" data-verb="open-panel" title={`Open ${POSS[show]} panel`}>{SEAT_WORD[show]} panel ↗</a>}
        <button type="button" className="cv2-keyhint" aria-label="Keyboard shortcuts" data-verb="desk-keys" onClick={() => setKeys(true)}>
          Keys <kbd>?</kbd>
        </button>
      </div>

      <Answer tail={sync ? ` · ${sync}` : null}>
        {loading ? 'Reading the drafts…' : n === 0 ? `Nothing of ${who}waits for review.`
          : <>{n} {who}draft{n === 1 ? '' : 's'} to decide.{created.length > 0 && <> Newest {age(new Date(Math.max(...created)).toISOString(), now)}, oldest {ageWords(now - Math.min(...created))}.</>}</>}
      </Answer>
      {read.source !== 'none' && read.error && (
        <div className="cv2-banner cv2-banner-bad" role="alert"><span>Could not refresh: {read.error}</span><button type="button" onClick={read.refresh}>Retry</button></div>
      )}
      {read.capped != null && <p className="cv2-note" role="status">Showing the newest 1,000 of {read.capped.toLocaleString('en-US')} rows.</p>}

      {desk.pinned.length > 0 && <div className="cv2-fixlist cv2-fixlist-pinned" aria-label="Did not go out">{desk.pinned.map(fixRow)}</div>}

      {ghosts && loading ? (
        <div className="cv2-list" aria-busy="true" aria-label="Reading the drafts">{[0, 1, 2, 3, 4].map(i => <div key={i} className="cv2-row-ghost" />)}</div>
      ) : read.source === 'none' && read.error ? <Failed what="the drafts" detail={read.error} onRetry={read.refresh} />
        : !loading && stream.length === 0 && orphans.length === 0 ? (
          <div className="cv2-empty">
            <b>{`Nothing of ${who}waits for review.`}</b>
            <span><a href={dHash('content', 'ideas', { lane: show })}>Ideas →</a><a href={dHash('content', 'calendar')}>Calendar →</a></span>
          </div>
        ) : (
          <>{sharedHold && <p className="cv2-ask cv2-ask-hold cv2-ask-shared">{sharedHoldWord && <b>{sharedHoldWord}. </b>}{sharedHold}</p>}
          <div ref={list} className={`cv2-list${openId ? '' : ' cv2-grid'}`} role="list" aria-label="Drafts to decide">
            {orphans.map((e, i) => <DeskStrip key={e.id} e={e} i={i} slot={slot} busy={false} verbs={verbs} />)}
            {stream.map((c, i) => renderRow(c, i + orphans.length))}
          </div></>
        )}

      {desk.waiting.length > 0 && (
        <section className="cv2-fold" aria-label="Approved, next step waiting">
          <button type="button" className="cv2-fold-h" aria-expanded={waitOpen} data-verb="wait-fold" onClick={() => setWaitOpen(o => !o)}>
            <i aria-hidden="true">{waitOpen ? '▾' : '▸'}</i><b>{desk.waiting.length} approved</b><span>{show === 'ivan' ? 'waiting for a date' : 'waiting for the next step'}</span>
          </button>
          {waitOpen && <div className={`cv2-list${openId ? '' : ' cv2-grid'}`} role="list" aria-label="Approved, next step waiting">{desk.waiting.map((c, i) => renderRow(c, i))}</div>}
        </section>
      )}

      {folded.length > 0 && (
        <section className="cv2-fix" aria-label="Needs a fix">
          <button type="button" className="cv2-banner cv2-banner-warn" aria-expanded={fixOpen} data-verb="fix-fold" onClick={() => setFixOpen(o => !o)}>
            <span className="cv2-ico" aria-hidden="true">!</span>
            <span><b>{folded.length} need{folded.length === 1 ? 's' : ''} a fix</b> · not counted above · oldest {ageWords(oldestFix)}</span>
            <span className="cv2-grow" /><span className="cv2-fold-word">{fixOpen ? 'Hide' : 'Show'}</span>
          </button>
          {fixOpen && <div className="cv2-fixlist">{folded.map(fixRow)}</div>}
        </section>
      )}

      {show !== 'ivan' && (
        <section className="cv2-fold cv2-board" aria-label="On board">
          <h2 className="cv2-fold-h"><b>On board</b><span>{boardRead?.error && !boardRead.loadedAt ? 'Unavailable' : boardRead?.loading && !boardRead.loadedAt ? 'Reading…' : `${desk.board.length} post${desk.board.length === 1 ? '' : 's'}`}</span></h2>
          {boardRead?.error && <Failed what="the board posts" detail={boardRead.error} onRetry={boardRead.refresh} />}
          {desk.board.length > 0
            ? <div className={`cv2-list${openId ? '' : ' cv2-grid'}`} role="list" aria-label="Posts on board">{desk.board.map((c, i) => renderRow(c, i))}</div>
            : !(boardRead?.loading && !boardRead.loadedAt) && !boardRead?.error && !loading && <p className="cv2-note">No posts on the board yet.</p>}
        </section>
      )}

      {moving && (
        <MovePanel key={moving.r.id} r={moving.r} lane={moving.lane} first={firstDay} seatRows={seatRows(moving.lane)} phone quickCommit={moving.r.board_visible !== true}
          onClose={() => setMoving(null)} onDone={onChanged} />
      )}
      <Sheet open={keys} onClose={() => setKeys(false)} title="Review keys" className="cv2-keys-sheet">
        <dl className="cv2-keys">
          {[['j / k', 'Next / previous draft'], ['a', 'Approve the focused draft'], ['d', 'Drop: pick the reason'], ['1-6, 0', 'The reason (it commits the drop) / Other'],
            ['e', 'Open the post with the editor'], ['Enter', 'Open the post'], ['o', 'Preview in place'], ['z', 'Undo the newest held verdict'], ['Esc', 'Close the reasons or the post'], ['?', 'This sheet']]
            .map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
        </dl>
      </Sheet>
    </section>
  )
}

function ageWords(ms: number): string {
  const d = Math.floor(ms / 86_400_000)
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`
  const h = Math.max(1, Math.round(ms / 3_600_000))
  return `${h}h`
}

function whenOf(c: WeekCard, now: number): string {
  const at = c.r.scheduled_at
  if (!at) return age(c.r.created_at, now)
  const hm = c.lane === 'risedtc' ? `${warsawHm(at)} · ${ptOf(at)}` : warsawHm(at)
  return `${dayLabel(warsawDay(at)).replace(/ \w+$/, '')}, ${hm}`
}

/** The source tag: the first thing on every row. */
export function SourceChip({ tag }: { tag: SourceTagView }) {
  return <span className={`cv2-srctag cv2-srctag-${tag.key}`} title={`Source: ${tag.title}`} data-source={tag.key}>{tag.label}</span>
}

const QA_WORD: Record<string, string> = { QA_FAILED_HAND_REVIEW: 'Hand review', FAIL: 'QA fail', REVIEW: 'QA review' }
/** "Hand review · QA 64", not the flag's raw "QA qa failed hand review 64". */
function qaWord(r: ContentDraft): string {
  const v = (r.qa_verdict ?? '').trim()
  const n = r.qa_score ? Math.round(Number(r.qa_score)) || r.qa_score : ''
  const word = QA_WORD[v.toUpperCase()] ?? (v ? v.toLowerCase().replace(/_/g, ' ').replace(/^qa /, '') : 'QA')
  return n !== '' ? `${word[0].toUpperCase()}${word.slice(1)} · QA ${n}` : word
}

const norm = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
/** The first body line under the hook that is not the hook again, for the row's second line. */
export function snippetOf(c: Pick<WeekCard, 'body' | 'title'>): string {
  const t = norm(c.title)
  const line = c.body.split('\n').map(l => l.trim()).find(l => l && !(t && norm(l).startsWith(t))) ?? ''
  return line.length > 220 ? `${line.slice(0, 218)}…` : line
}

function ReviewRow({ c, i, now, grid, focused, open, busy, held, read, repeat, slot, src, srcLoading, more, setMore, hideHold = false, picking, setPicking, onFocus, onOpen, onEdit, onApprove, onDrop, onSkip, onBoard, onSchedule, onDate, onChanged }: {
  c: WeekCard; i: number; now: number; focused: boolean; open: boolean; busy: boolean; held: boolean
  /** The 3-up card grid (no post open): the whole post, its media, edited in place. */
  grid: boolean
  read?: PatternRead; repeat?: Repeat; slot: Slot | null
  src: ReturnType<typeof sourceOf>; srcLoading: boolean
  more: boolean; setMore: (v: boolean) => void
  /** The hold is said once above the list. */
  hideHold?: boolean
  picking: boolean; setPicking: (v: boolean) => void
  onFocus: () => void; onOpen: () => void; onEdit: () => void; onApprove: () => void
  onDrop: (slug: string, note: string | null) => void; onSkip: () => void; onBoard: () => void
  onSchedule: (at?: Date) => void; onDate: () => void; onChanged: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [pic, setPic] = useState<string[] | undefined>(undefined)
  // The in-place edit lives on the row, so typed text survives the post opening beside the grid or the preview toggling.
  const [edit, setEdit] = useState<string | null>(null)
  const editBase = useRef('') // the body the edit started from: the compare-and-swap base
  // The body just saved, shown until the list's next read carries it (no flash of the old text).
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => { setSaved(null) }, [c.r.post_body, c.r.updated_at])
  const postNow = saved ?? (c.r.post_body ?? '')
  const inPlace = c.lane === 'ivan' || clientEditable(c.r.status, c.lane)
  const startEdit = () => { editBase.current = postNow; setEdit(postNow) }
  const id = c.r.id
  const judgeable = c.judge
  // Time to verdict starts when a draft to judge is first on screen (once per draft), as on the stack.
  useEffect(() => {
    if (!judgeable) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { markShown(id); return }
    const io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { markShown(id); io.disconnect() } }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [judgeable, id])
  useEffect(() => { setPic(undefined) }, [c.r.image_urls])

  // What the client said on the panel outranks the desk's own reading (db/243).
  const hold = c.lane === 'ivan' ? null : clientHoldOf(c.r, OWNER[c.lane])
  const pill = hold ? { tone: (hold.kind === 'removed' ? 'bad' : 'warn') as Tone, text: hold.text } : pillOf(c)
  const qa = c.flags.find(f => f.key === 'qa' && f.tone === 'warn')
  const kindFlag = c.flags.find(f => f.key === 'kind')
  const noImg = c.flags.find(f => f.key === 'noimg')
  const title = c.title
  const tag = sourceTag(c.r, OWNER[c.lane])
  const next = nextOf(c)
  const body = (c.r.post_body ?? '').trim() || c.title
  const editablePic = pictureEditable(c.r, c.lane)
  const snippet = snippetOf(c)
  const boardWord = `Put on ${POSS[c.lane]} board`
  const canDate = c.canDate && (c.r.board_visible !== true || (c.lane !== 'swishdm' && hold?.kind !== 'removed'))
  const boardDate = c.lane !== 'ivan' && c.r.board_visible === true && canDate

  const menu: MenuItem[] = [
    { key: 'open', label: 'Open post', run: onOpen },
    { key: 'preview', label: more ? 'Hide preview' : 'Preview here', run: () => setMore(!more) },
    { key: 'edit', label: 'Edit', run: onEdit },
    ...(c.judge ? [{ key: 'drop', label: 'Drop…', run: () => setPicking(true), danger: true }] : []),
    ...(!c.judge && c.primary === 'approve' ? [{ key: 'skip', label: 'Skip', run: onSkip }] : []),
    ...(canDate ? [{ key: 'date', label: c.r.scheduled_at ? 'Move date' : 'Add a date', run: onDate }] : []),
  ]

  let primary: React.ReactNode = null
  if (boardDate) primary = <button type="button" className={`cv2-k${c.r.scheduled_at ? ' cv2-k-q' : ' cv2-k-p'}`} data-key-main data-verb="card-board-date" disabled={busy} onClick={onDate}>{c.r.scheduled_at ? 'Change date' : 'Schedule'}</button>
  else if (c.judge || c.primary === 'approve') primary = <button type="button" className="cv2-k cv2-k-p" data-key-safe data-verb={c.judge ? 'card-keep' : 'card-approve'} disabled={busy} onClick={onApprove}>Approve</button>
  else if (c.primary === 'board' || next === 'board') primary = <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-board" disabled={busy} title={boardWord} onClick={onBoard}>{busy ? 'Working…' : <><span className="cv2-wide-only">{boardWord}</span><span className="cv2-narrow-only">Put on board</span></>}</button>
  else if (next === 'schedule' && (c.r.scheduled_at || slot)) primary = <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-schedule" disabled={busy} onClick={() => onSchedule(c.r.scheduled_at ? undefined : slot!.at)}>
    {busy ? 'Working…' : c.r.scheduled_at ? `Schedule ${whenOf(c, now)}` : `Schedule ${slotWord(slot!)}`}</button>
  else if (next === 'date' && canDate) primary = <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-date-it" disabled={busy} onClick={onDate}>Date it</button>

  // A tap on the row opens the post; a tap on any control inside it does only that control.
  const onRowClick = (e: React.MouseEvent) => {
    // mid-edit, a stray click on the card never opens the post; it puts the cursor back in the box (so Esc still cancels)
    if (edit !== null) { if (!(e.target as HTMLElement).closest('button,a,input,select')) ref.current?.querySelector('textarea')?.focus(); return }
    if ((e.target as HTMLElement).closest('button,a,input,textarea,select,label,[role="menu"],.cv2-row-more,.cv2-why')) return
    onOpen()
  }

  return (
    <article ref={ref} className={`cv2-row${open ? ' cv2-row-open' : ''}${more ? ' cv2-row-x' : ''}`} role="listitem" data-card-id={id} data-lane={c.lane} data-held={held || undefined}
      style={{ '--i': Math.min(i, 10) } as React.CSSProperties}
      tabIndex={focused ? 0 : -1} aria-current={focused ? 'true' : undefined} aria-label={`${tag.label}: ${title}`} onFocus={onFocus} onClick={onRowClick}>
      <div className="cv2-row-main">
        <SourceChip tag={tag} />
        <div className="cv2-row-text">
          <b className="cv2-row-t">{title}</b>
          {snippet && <span className="cv2-row-sub">{snippet}</span>}
          {/* The grid card: the whole post as the feed shows it, with its media or an empty square, and the text
              edits in place (Ivan 2026-10-30: "see and edit from here fast"). The list row keeps the one-line snippet. */}
          {grid && !more && <GridPost c={c} body={postNow} text={edit} setText={setEdit} base={editBase.current} canEdit={inPlace}
            onStart={startEdit} onSaved={setSaved} onChanged={onChanged} />}
        </div>
        <div className="cv2-row-meta">
          {(taxonomyValue(c.r.taxonomy, 'pillar') === 'personal' || taxonomyValue(c.r.taxonomy, 'register') === 'personal') && <span className="cv2-tag" data-pillar="personal">Personal</span>}
          {kindFlag && <span className="cv2-tag">{kindFlag.text}</span>}
          {/* Ivan's text-first drafts often have no picture yet (the selfie assigner adds one): only a client's missing picture is a tag. */}
          {noImg?.tone === 'warn' && <span className="cv2-tag cv2-tag-warn">No image</span>}
          {repeat && <span className="cv2-tag cv2-tag-warn" title="The same picture sits on another post of this seat within two weeks">Same picture</span>}
          {qa && <Pill tone="warn" title={qa.title}>{qaWord(c.r)}</Pill>}
          {read?.state === 'ready' && <EarlyReadChip read={read} lane={c.lane} />}
          <span className="cv2-row-age" title={`Created ${age(c.r.created_at, now)} ago`}>{c.r.board_visible === true && !c.r.scheduled_at ? 'No date yet' : whenOf(c, now)}</span>
          {/* Every row of the list needs review: only a different status earns a pill. */}
          {pill.text !== 'Needs review' && !(hideHold && hold) && <Pill tone={pill.tone} title={hold?.kind === 'changes' ? undefined : hold?.detail}>{pill.text}</Pill>}
        </div>
        <div className="cv2-row-keys">
          {c.judge && c.lane !== 'swishdm' && <button type="button" className="cv2-k cv2-k-q" data-verb="card-drop" disabled={busy} onClick={() => setPicking(true)}>Drop</button>}
          {!c.judge && c.primary === 'approve' && <button type="button" className="cv2-k cv2-k-q" data-verb="card-skip" disabled={busy} onClick={onSkip}>Skip</button>}
          <button type="button" className="cv2-k cv2-k-q cv2-wide-only" data-verb="card-edit" disabled={busy || (grid && !more && edit !== null)} onClick={grid && !more && inPlace ? startEdit : onEdit}>Edit</button>
          {next === 'schedule' && !c.r.scheduled_at && <button type="button" className="cv2-k cv2-k-q cv2-wide-only" data-verb="card-pick-day" disabled={busy} onClick={onDate}>Pick a day</button>}
          {primary}
          <button type="button" className="cv2-chev" aria-expanded={more} aria-label={more ? 'Hide the preview' : 'Preview the post here'} data-verb="row-preview" onClick={() => setMore(!more)}>
            <DIcon name="chevDown" />
          </button>
          <Menu label="More for this draft" items={menu} />
        </div>
      </div>
      {hold?.kind === 'changes' && hold.detail && <p className="cv2-ask" data-ask><b>{OWNER[c.lane]} on the panel:</b> “{hold.detail}”</p>}
      {hold && hold.kind !== 'changes' && hold.detail && !hideHold && <p className="cv2-ask cv2-ask-hold">{hold.detail}</p>}
      {picking && <div className="cv2-row-why"><ReasonPicker lane={c.lane} onPick={onDrop} onCancel={() => setPicking(false)} /></div>}
      {more && (
        <div className="cv2-row-more">
          <div className="cv2-row-post">
            <LinkedInCard lane={c.lane} body={body} images={pic ?? c.r.image_urls} type={c.r.type} videoUrl={c.r.video_url} bare open />
          </div>
          <div className="cv2-row-side">
            {editablePic && <div className="cv2-pic" data-repeat={repeat ? 'yes' : undefined}><PictureRow d={c.r} lane={c.lane} onShow={setPic} onDone={onChanged} disabled={busy} /></div>}
            <BrainDraftBadge draft={c.r} />
            {(src.author || src.result || src.kind) && <div className="cv2-src"><SourceCol src={src} loading={srcLoading} /></div>}
            <button type="button" className="cv2-k" data-verb="card-open" onClick={onOpen}>Open the post</button>
          </div>
        </div>
      )}
    </article>
  )
}

/** The grid card's post. A click on the text opens it for editing in place; ⌘/Ctrl+Enter saves, Esc cancels.
 *  The save is the editor's own compare-and-swap against the body the edit started from (a body changed
 *  elsewhere meanwhile is refused, never overwritten). A client draft the DB won't edit opens the post instead. */
function GridPost({ c, body, text, setText, base, canEdit, onStart, onSaved, onChanged }: {
  c: WeekCard; body: string; text: string | null; setText: (v: string | null) => void; base: string; canEdit: boolean
  onStart: () => void; onSaved: (body: string) => void; onChanged: () => void
}) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const editing = text !== null
  const fit = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }
  useEffect(() => { if (editing) requestAnimationFrame(() => ta.current?.focus()) }, [editing])
  // The box grows with the text, so the whole post stays in view while editing.
  useLayoutEffect(() => { if (editing && ta.current) fit(ta.current) }, [editing, text])
  const save = async () => {
    if (text === null || inFlight.current) return
    if (text === base) { setText(null); return }
    inFlight.current = true; setSaving(true)
    try {
      await (c.lane === 'ivan' ? saveDraftBody : saveClientDraftBody)(c.r.id, text, c.r.taxonomy, base, c.r.updated_at ?? null)
      onSaved(text)
      setText(null)
      toast.show({ id: `grid-save-${c.r.id}`, message: 'Saved.' })
      onChanged()
    } catch (e) {
      toast.show({ id: `grid-save-${c.r.id}`, message: e instanceof DraftSaveConflict ? 'This post changed elsewhere. Open it to compare.' : `Not saved: ${e instanceof Error ? e.message : String(e)}` })
    } finally { inFlight.current = false; setSaving(false) }
  }
  if (editing) return (
    <div className="cv2-gp cv2-gp-edit">
      <textarea ref={ta} value={text} disabled={saving} aria-label="Post text" spellCheck
        onChange={e => { setText(e.target.value); fit(e.target) }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(null) }
        }} />
      <div className="cv2-gp-keys">
        <button type="button" className="cv2-k cv2-k-p" data-verb="grid-save" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="cv2-k cv2-k-q" data-verb="grid-cancel" disabled={saving} onClick={() => setText(null)}>Cancel</button>
      </div>
    </div>
  )
  return (
    <div className={`cv2-gp${canEdit ? '' : ' cv2-gp-ro'}`} data-verb="grid-edit-text" title={canEdit ? 'Click the text to edit' : undefined}
      onClick={e => { if (!canEdit || !(e.target as HTMLElement).closest('.cv2-li-b')) return; e.stopPropagation(); onStart() }}>
      <LinkedInCard lane={c.lane} body={body.trim() || c.title} images={c.r.image_urls} type={c.r.type} bare compact open expandable={false} emptyMedia />
    </div>
  )
}

/** Drop's reason IS the commit: one tap (or 1-6), "Other" takes a line. Nothing is written before a reason. */
function ReasonPicker({ lane, onPick, onCancel }: { lane: Lane; onPick: (slug: string, note: string | null) => void; onCancel: () => void }) {
  const [other, setOther] = useState(false)
  const [note, setNote] = useState('')
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus({ preventScroll: true }) }, [])
  return (
    <div className="cv2-why" role="group" aria-label="Why drop it">
      <div className="cv2-why-chips">
        {DESK_REASONS.map(([slug, label, key], i) => (
          <button key={slug} ref={i === 0 ? first : undefined} type="button" style={{ '--j': i } as React.CSSProperties} data-verb="desk-reason" data-reason={slug}
            onClick={() => (slug === 'other' ? setOther(true) : onPick(slug, null))}><kbd>{key}</kbd>{label}</button>
        ))}
        <button type="button" className="cv2-why-x" data-verb="desk-reason-cancel" onClick={onCancel}>Cancel</button>
      </div>
      {other && (
        <form className="cv2-why-note" onSubmit={e => { e.preventDefault(); if (note.trim()) onPick('other', note.trim()) }}>
          <input type="text" value={note} maxLength={500} autoFocus placeholder="What was it?" aria-label="What was it?" onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOther(false) } }} />
          <button type="submit" className="cv2-k cv2-k-p" data-verb="desk-reason-note" disabled={!note.trim()}>Drop</button>
        </form>
      )}
      <p className="cv2-fine">{lane === 'ivan' ? 'Drop deletes the draft.' : `Drop deletes the draft from ${OWNER[lane]}’s queue.`} <span className="cv2-fine-x">The reason is kept and the next weekly pick reads it. </span>Undo for 5 seconds.</p>
    </div>
  )
}

/** The decided row: what was decided, the reason, Undo draining for 5 s, then the seat's next step once SAVED. */
function DeskStrip({ e, c, i, slot, busy, verbs, onDate }: {
  e: Judged; c?: WeekCard; i: number; slot: Slot | null; busy: boolean
  verbs: ReturnType<typeof useWeekVerbs>; onDate?: () => void
}) {
  const [elapsed] = useState(() => Math.min(VERDICT_HOLD_MS, Math.max(0, Date.now() - e.at)))
  const keep = e.verdict === 'keep'
  const failed = e.phase === 'failed'
  const word = failed ? 'Not saved' : !keep ? 'Dropped' : e.saved?.verdict === 'edited' ? 'Approved after your edit' : e.lane === 'ivan' ? 'Approved' : 'Approved · board unchanged'
  const reason = e.reasons[0]
  // The seat's next step: never while the verdict is held or saving (a schedule must not race cb39_verdict_set).
  const saved = e.phase === 'saved' && keep && !!c
  return (
    <article className={`cv2-strip cv2-strip-${e.verdict}${failed ? ' cv2-strip-bad' : ''}`} role="listitem" data-strip-id={e.id} data-phase={e.phase} style={{ '--i': Math.min(i, 10) } as React.CSSProperties}>
      <div className="cv2-strip-row" aria-live="polite">
        <span className="cv2-glyph" aria-hidden="true">{failed ? '!' : keep ? '✓' : '✕'}</span>
        <b>{word}</b>
        <span className="cv2-strip-t">{splitTitleTag(e.title).text}</span>
        {reason && !failed && <span className="cv2-dim">· {reason === 'skip' ? 'no reason' : reasonLabel(reason)}</span>}
        <span className="cv2-grow" />
        {e.phase === 'held' && (
          <button type="button" className="cv2-undo" data-verb="verdict-undo" onClick={() => undoVerdict(e.id)}>
            Undo<i className="cv2-drain" aria-hidden="true" style={{ animationDuration: `${VERDICT_HOLD_MS}ms`, animationDelay: `-${elapsed}ms` }} />
          </button>
        )}
        {e.phase === 'saving' && <span className="cv2-dim" role="status">Saving…</span>}
        {e.phase === 'saved' && <>
          {saved && c.lane === 'ivan' && slot && <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="next-schedule" disabled={busy} onClick={() => void verbs.schedule(c, c.r.scheduled_at ? undefined : slot.at)}>
            Schedule {c.r.scheduled_at ? `${dayLabel(warsawDay(c.r.scheduled_at)).replace(/ \w+$/, '')} · ${warsawHm(c.r.scheduled_at)}` : slotWord(slot)}</button>}
          {saved && c.lane === 'ivan' && onDate && <button type="button" className="cv2-k" data-verb="next-pick-day" onClick={onDate}>Pick a day</button>}
          {saved && c.lane === 'risedtc' && c.r.board_visible !== true && <button type="button" className="cv2-k cv2-k-p" data-verb="next-board" disabled={busy} onClick={() => void verbs.board(c)}>Put on {POSS[c.lane]} board</button>}
          {saved && c.lane === 'arch' && c.canDate && onDate && <button type="button" className="cv2-k cv2-k-p" data-verb="next-date" onClick={onDate}>Date it</button>}
          <button type="button" className="cv2-x" data-verb="verdict-close" aria-label="Close" onClick={() => forgetVerdict(e.id)}>×</button>
        </>}
      </div>
      {failed && (
        <div className="cv2-strip-fail">
          <p role="alert">{e.error ?? 'That did not go through.'}</p>
          <button type="button" className="cv2-k" data-verb="verdict-retry" onClick={() => retryVerdict(e.id)}>Try again</button>
          <button type="button" className="cv2-k" data-verb="verdict-forget" onClick={() => forgetVerdict(e.id)}>Keep the card</button>
        </div>
      )}
      {e.error && !failed && <p className="cv2-note" role="alert">{e.error} {reason && <button type="button" className="cv2-link" onClick={() => giveReason(e.id, reason, e.note)}>Try again</button>}</p>}
    </article>
  )
}
