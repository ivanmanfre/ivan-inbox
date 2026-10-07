import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pictureEditable, type ContentDraft } from '../../../lib/content'
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
import { LANE_NAME, OWNER, POSS, age, dayLabel, nextFreeWeekday, ptOf, splitTitleTag, titleOf, type Lane, type Slot } from '../model'
import { PictureRow } from '../PictureRow'
import { useRowVerbs } from '../rowVerbs'
import { useEarlyReads } from '../useEarlyReads'
import type { WeekRead } from '../useWeek'
import { forgetVerdict, giveReason, markShown, retryVerdict, undoVerdict, useJudged, VERDICT_HOLD_MS, type Judged } from '../verdictStore'
import { useWeekVerbs } from '../weekVerbs'
import { SHOWS, type Show, type Week, type WeekCard } from '../weekModel'
import { LinkedInCard } from './LinkedInCard'
import { picRepeats, type Repeat } from './picRepeat'
import { Answer, Menu, Pill, SeatAv, Seg, useDeferred, type MenuItem, type Tone } from './ui'

// CONTENT > REVIEW, THE ONE DESK (Brief 4, SPEC-content §2.2; upgrades #1, #3, #5).
// Every draft decision happens here: a 2-up grid of the posts as LinkedIn will
// show them (hook and picture together), the top 6 then a fold, two-tap Drop
// with the reason as the commit, the picture fixable on the card with a repeat
// warning, the seat's next step once a verdict is saved, and keys for all of it.
// Writes are today's functions, unchanged: useWeekVerbs (Approve held 8 s, board
// and schedule confirmed), verdictStore.judge + giveReason (held 5 s),
// useRowVerbs (Skip held 8 s), PictureRow.write (Undo), MovePanel (stored-day
// receipt). Arch stays view only on the card.

const SEAT_WORD: Record<Show, string> = { all: 'All', ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }
const FIRST = 6

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

type Quick = 'decide' | 'noimg'

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

const slotWord = (s: Slot) => `${warsawDow(s.at)} ${warsawDm(s.at).split(' ')[0]} · ${warsawHm(s.at)}`

export function ReviewDesk({ week, total, read, show, setShow, now, openId, focusId, onOpen, onEdit, onChanged, firstDay, seatRows, rows, armed, armedFailed }: {
  /** The desk's cards (buildNow, this seat filter). */
  week: Week
  /** Every seat's work (buildNow without the filter): the seat counts and the tab number. */
  total: Week
  read: WeekRead
  show: Show
  setShow: (s: Show) => void
  now: number
  openId: string | null
  /** A card to land on (Content Brain's "Up next"). */
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
}) {
  const toast = useToast()
  const judged = useJudged()
  const pending = usePendingDecisions()
  const [busy, setBusy] = useState<string | null>(null)
  const [moving, setMoving] = useState<WeekCard | null>(null)
  const [all, setAll] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)
  const [quick, setQuick] = useState<Quick | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(focusId)
  const [more, setMore] = useState<ReadonlySet<string>>(() => new Set())
  const [keys, setKeys] = useState(false)
  const grid = useRef<HTMLDivElement>(null)

  const verbs = useWeekVerbs({ ids: week.ids, onChanged, onOpen, setBusy })
  const rowVerbs = useRowVerbs(onChanged)
  const slot = useMemo(() => (armed ? nextFreeWeekday(armed, now) : armedFailed ? nextFreeWeekday(new Set(), now) : null), [armed, armedFailed, now])

  const fixGroup = week.groups.find(g => g.key === 'fix')?.cards ?? []
  const drafts = week.groups.find(g => g.key === 'drafts')?.cards ?? []
  // A post dated today or earlier that did not go out stays pinned on top; the rest of "Needs a fix" folds into its banner.
  // Only a recent miss (dated in the last 48 h) is pinned: a 12-day-old miss is history, it folds with the rest.
  const pinned = fixGroup.filter(c => c.flags.some(f => f.key === 'stuck') && !!c.r.scheduled_at && now - Date.parse(c.r.scheduled_at) < 2 * 86_400_000)
  const folded = fixGroup.filter(c => !pinned.includes(c))
  const qf = (c: WeekCard) => quick === 'decide' ? c.judge || c.primary !== 'open' : quick === 'noimg' ? c.flags.some(f => f.key === 'noimg') : true
  const stream = [...pinned, ...drafts].filter(c => c.strip || qf(c))
  const shown = all ? stream : stream.slice(0, FIRST)
  const qn = { decide: [...pinned, ...drafts].filter(c => !c.strip && (c.judge || c.primary !== 'open')).length, noimg: [...pinned, ...drafts].filter(c => !c.strip && c.flags.some(f => f.key === 'noimg')).length }
  const inList = new Set([...fixGroup, ...drafts].map(c => c.r.id))
  const orphans = [...judged.values()].filter(e => !e.collapsed && !inList.has(e.id) && (show === 'all' || show === e.lane)).sort((a, b) => a.at - b.at)

  const earlyReads = useEarlyReads([...shown, ...(fixOpen ? folded : [])].map(c => c.r))
  const srcIds = useMemo(() => stream.slice(0, 60).map(c => c.r.id), [stream.map(c => c.r.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const sources = useSources(srcIds)
  const repeats = useMemo(() => picRepeats(rows), [rows])
  const work = stream.filter(c => !c.strip)
  const created = work.map(c => Date.parse(c.r.created_at)).filter(Number.isFinite)
  const loading = read.source === 'none' && !read.settled
  const ghosts = useDeferred(loading)

  // Focus lands on the first card, or on the card Content Brain sent.
  const cardIds = useMemo(() => shown.filter(c => !c.strip).map(c => c.r.id), [shown])
  useEffect(() => {
    if (focus && (cardIds.includes(focus) || !cardIds.length)) return
    setFocus(cardIds[0] ?? null)
  }, [cardIds, focus])
  useEffect(() => {
    if (!focusId) return
    setFocus(focusId)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${focusId}"]`)?.scrollIntoView?.({ block: 'center' }))
  }, [focusId])

  const cardOf = useCallback((id: string | null) => stream.find(c => c.r.id === id) ?? null, [stream])
  const moveFocus = (dir: 1 | -1) => {
    const list = Array.from(grid.current?.querySelectorAll<HTMLElement>('article[data-card-id]') ?? [])
    if (!list.length) return
    const i = list.findIndex(el => el.dataset.cardId === focus)
    const next = list[Math.min(list.length - 1, Math.max(0, i < 0 ? 0 : i + dir))]
    setFocus(next.dataset.cardId ?? null)
    next.focus({ preventScroll: true })
    next.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  const approveCard = (c: WeekCard) => {
    if (c.judge) void verbs.judgeIt(c, 'keep')
    else if (c.primary === 'approve') verbs.approve(c)
  }
  // judgeIt never waits on a Drop (only Approve on an errored Ivan draft asks first), so the held verdict exists
  // when it returns: the reason rides along with it in ONE write, exactly ContentBrain's judge + giveReason.
  const dropWith = (c: WeekCard, slug: string, note: string | null) => {
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
      if (document.querySelector('.d-confirm, .d-sheet, .cv2-menu:not([hidden])')) return
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
        const held = [...judged.values()].filter(x => x.phase === 'held').sort((a, b) => b.at - a.at)[0]
        if (held) { e.preventDefault(); undoVerdict(held.id); return }
        const last = [...pending.keys()].pop()
        if (last && undoDecision(last)) { e.preventDefault(); toast.show({ id: `decide-${last}`, message: 'Undone. Nothing was written.' }) }
      }
      else if (!c) return
      else if (e.key === 'a') { e.preventDefault(); approveCard(c) }
      else if (e.key === 'd' && c.judge) { e.preventDefault(); setPicking(c.r.id) }
      else if (e.key === 'e' && c.lane !== 'arch') { e.preventDefault(); onEdit(c.r.id, c.lane) }
      else if (e.key === 'Enter' && !(el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName))) { e.preventDefault(); onOpen(c.r.id, c.lane) }
      else if (e.key === 'o') { e.preventDefault(); setMore(m => { const n = new Set(m); if (n.has(c.r.id)) n.delete(c.r.id); else n.add(c.r.id); return n }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const seatCount = (s: Show) => s === 'all' ? total.ids.length : total.perLane[s]
  const who = show === 'all' ? '' : show === 'ivan' ? 'Ivan’s ' : `${OWNER[show]}’s `
  const n = work.length + (quick ? 0 : folded.length)
  const fixBy = (['risedtc', 'arch', 'ivan'] as Lane[]).map(l => [l, folded.filter(c => c.lane === l).length] as const).filter(([, k]) => k > 0)
  const oldestFix = folded.length ? Math.max(...folded.map(c => now - Date.parse(c.r.created_at))) : 0
  const sync = read.memberReadState && read.memberReadState !== 'idle'
    ? (read.memberReadState === 'pending' ? 'Checking brain draft visibility.' : read.memberReadState === 'failed' ? 'Brain drafts are hidden until visibility can be verified.' : 'Brain draft visibility checked.')
    : read.source === 'cache' && !read.error ? `saved copy ${read.at ? warsawHm(read.at) : ''}, refreshing` : null

  const renderCard = (c: WeekCard, i: number) => {
    const e = c.strip ? judged.get(c.r.id) : undefined
    if (e) return <DeskStrip key={c.r.id} e={e} c={c} i={i} slot={slot} busy={busy === c.r.id} verbs={verbs} onDate={() => setMoving(c)} />
    return (
      <ReviewCard key={c.r.id} c={c} i={i} now={now} focused={c.r.id === focus} open={c.r.id === openId} busy={busy === c.r.id}
        read={earlyReads.get(c.r.id)} repeat={repeats.get(c.r.id)} slot={slot}
        src={sourceOf(c.r, sources.map.get(c.r.id))} srcLoading={!sources.map.has(c.r.id) && sources.pending}
        more={more.has(c.r.id)} setMore={v => setMore(m => { const nx = new Set(m); if (v) nx.add(c.r.id); else nx.delete(c.r.id); return nx })}
        picking={picking === c.r.id} setPicking={v => setPicking(v ? c.r.id : null)}
        onFocus={() => setFocus(c.r.id)}
        onOpen={() => onOpen(c.r.id, c.lane)} onEdit={() => onEdit(c.r.id, c.lane)}
        onApprove={() => approveCard(c)} onDrop={(slug, note) => dropWith(c, slug, note)}
        onSkip={() => void rowVerbs.run(c.r, c.lane, 'skip')}
        onBoard={() => void verbs.board(c)} onSchedule={(at?: Date) => void verbs.schedule(c, at)} onDate={() => setMoving(c)}
        onChanged={onChanged} />
    )
  }

  return (
    <section className="cv2 cv2-review" aria-label="Review" data-cv2="review">
      <div className="cv2-bar">
        <Seg label="Seat" verb="show" value={show} onChange={id => setShow(id as Show)}
          options={SHOWS.map(s => ({ id: s, label: s === 'all' ? 'All' : <><SeatAv lane={s} />{SEAT_WORD[s]}</>, count: loading ? '…' : seatCount(s) }))} />
        <div className="cv2-quick" role="group" aria-label="Filter the desk">
          <button type="button" aria-pressed={quick === 'decide'} data-verb="quick-decide" onClick={() => setQuick(q => q === 'decide' ? null : 'decide')}>To decide<b className="cv2-n">{qn.decide}</b></button>
          {qn.noimg > 0 && <button type="button" aria-pressed={quick === 'noimg'} data-verb="quick-noimg" onClick={() => setQuick(q => q === 'noimg' ? null : 'noimg')}>No image<b className="cv2-n">{qn.noimg}</b></button>}
        </div>
        <span className="cv2-grow" />
        <button type="button" className="cv2-keyhint" aria-label="Keyboard shortcuts" data-verb="desk-keys" onClick={() => setKeys(true)}>
          {['j', 'k', 'a', 'd', 'e', 'z'].map(k => <kbd key={k}>{k}</kbd>)}<kbd>?</kbd>
        </button>
      </div>

      <Answer tail={sync ? ` · ${sync}` : null}>
        {loading ? 'Reading the drafts…' : n === 0 ? `Nothing of ${who || 'yours '}waits for review.`
          : <>{n} {who}draft{n === 1 ? '' : 's'} to decide.{created.length > 0 && <> Newest {age(new Date(Math.max(...created)).toISOString(), now)}, oldest {ageWords(now - Math.min(...created))}.</>}</>}
      </Answer>
      {read.source !== 'none' && read.error && (
        <div className="cv2-banner cv2-banner-bad" role="alert"><span>Could not refresh: {read.error}</span><button type="button" onClick={read.refresh}>Retry</button></div>
      )}
      {read.capped != null && <p className="cv2-note" role="status">Showing the newest 1,000 of {read.capped.toLocaleString('en-US')} rows.</p>}

      {folded.length > 0 && !quick && (
        <section className="cv2-fix" aria-label="Needs a fix">
          <button type="button" className="cv2-banner cv2-banner-warn" aria-expanded={fixOpen} data-verb="fix-fold" onClick={() => setFixOpen(o => !o)}>
            <span className="cv2-ico" aria-hidden="true">!</span>
            <span><b>{folded.length} need{folded.length === 1 ? 's' : ''} a fix</b> · {fixBy.map(([l, k]) => `${LANE_NAME[l]} ${k}`).join(', ')} · oldest {ageWords(oldestFix)}</span>
            <span className="cv2-grow" /><span className="cv2-fold-word">{fixOpen ? 'Hide' : 'Show'}</span>
          </button>
          {fixOpen && <div className="cv2-fixlist">{folded.map(c => (
            <article key={c.r.id} className="cv2-fixrow" data-card-id={c.r.id} data-lane={c.lane}>
              <SeatAv lane={c.lane} />
              <span className="cv2-fixt"><b>{splitTitleTag(c.title).text}</b><small>{c.flags.filter(f => f.tone === 'warn').map(f => f.text).join(' · ')} · created {age(c.r.created_at, now)} ago</small></span>
              {c.lane !== 'arch' && <ConfirmProvider><RetryDraft d={c.r} lane={c.lane} onDone={onChanged} label="Fix" /></ConfirmProvider>}
              <button type="button" className="cv2-k" data-verb="card-open" onClick={() => onOpen(c.r.id, c.lane)}>Open</button>
            </article>
          ))}</div>}
        </section>
      )}

      {ghosts && loading ? (
        <div className="cv2-grid" aria-busy="true" aria-label="Reading the drafts">{[0, 1].map(i => <div key={i} className="cv2-ghost" />)}</div>
      ) : read.source === 'none' && read.error ? <Failed what="the drafts" detail={read.error} onRetry={read.refresh} />
        : !loading && stream.length === 0 && orphans.length === 0 ? (
          <div className="cv2-empty">
            <b>{quick ? 'Nothing matches this filter.' : `Nothing of ${who || 'yours '}waits for review.`}</b>
            <span><a href={dHash('content', 'ideas', show !== 'all' ? { lane: show } : {})}>Ideas →</a><a href={dHash('content', 'calendar')}>Calendar →</a></span>
          </div>
        ) : (
          <div ref={grid} className="cv2-grid" role="list" aria-label="Drafts to decide">
            {orphans.map((e, i) => <DeskStrip key={e.id} e={e} i={i} slot={slot} busy={false} verbs={verbs} />)}
            {shown.map((c, i) => renderCard(c, i + orphans.length))}
          </div>
        )}
      {stream.length > FIRST && (
        <button type="button" className="cv2-showmore" data-verb="desk-show-more" aria-expanded={all} onClick={() => setAll(a => !a)}>
          {all ? `Show the top ${FIRST}` : `Show ${stream.length - FIRST} more`}
        </button>
      )}

      {moving && (
        <MovePanel key={moving.r.id} r={moving.r} lane={moving.lane} first={firstDay} seatRows={seatRows(moving.lane)} phone quickCommit
          onClose={() => setMoving(null)} onDone={onChanged} />
      )}
      <Sheet open={keys} onClose={() => setKeys(false)} title="Review keys" className="cv2-keys-sheet">
        <dl className="cv2-keys">
          {[['j / k', 'Next / previous card'], ['a', 'Approve the focused card'], ['d', 'Drop: pick the reason'], ['1-6, 0', 'The reason (it commits the drop) / Other'],
            ['e', 'Open the post with the editor'], ['Enter', 'Open the post'], ['o', 'See more / less'], ['z', 'Undo the newest held verdict'], ['Esc', 'Close the reasons or the post'], ['?', 'This sheet']]
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

function ReviewCard({ c, i, now, focused, open, busy, read, repeat, slot, src, srcLoading, more, setMore, picking, setPicking, onFocus, onOpen, onEdit, onApprove, onDrop, onSkip, onBoard, onSchedule, onDate, onChanged }: {
  c: WeekCard; i: number; now: number; focused: boolean; open: boolean; busy: boolean
  read?: PatternRead; repeat?: Repeat; slot: Slot | null
  src: ReturnType<typeof sourceOf>; srcLoading: boolean
  more: boolean; setMore: (v: boolean) => void
  picking: boolean; setPicking: (v: boolean) => void
  onFocus: () => void; onOpen: () => void; onEdit: () => void; onApprove: () => void
  onDrop: (slug: string, note: string | null) => void; onSkip: () => void; onBoard: () => void
  onSchedule: (at?: Date) => void; onDate: () => void; onChanged: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [pic, setPic] = useState<string[] | undefined>(undefined)
  const [srcOpen, setSrcOpen] = useState(false)
  const id = c.r.id
  const judgeable = c.judge
  // Time to verdict starts when a card to judge is first half on screen (once per draft), as on today's stack.
  useEffect(() => {
    if (!judgeable) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { markShown(id); return }
    const io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { markShown(id); io.disconnect() } }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [judgeable, id])
  useEffect(() => { setPic(undefined) }, [c.r.image_urls])

  const pill = pillOf(c)
  const qa = c.flags.find(f => f.key === 'qa' && f.tone === 'warn')
  const tag = splitTitleTag(titleOf(c.r)).tag
  const next = nextOf(c)
  const editable = c.lane !== 'arch'
  const menu: MenuItem[] = [
    { key: 'open', label: 'Open post', run: onOpen },
    ...(c.canDate ? [{ key: 'date', label: c.r.scheduled_at ? 'Move date' : 'Add a date', run: onDate }] : []),
    ...(editable ? [{ key: 'edit', label: 'Edit', run: onEdit }] : []),
  ]
  const head = <>{tag && <span>Source tag: {tag}</span>}{c.viewOnly && <span>Arch is view only here: Davorin reviews his posts on Friday and his publisher posts from review.</span>}</>
  const body = (c.r.post_body ?? '').trim() || c.title
  const editablePic = pictureEditable(c.r, c.lane)
  const kind = c.r.type === 'carousel' ? `Carousel · ${(Array.isArray(c.r.image_urls) ? c.r.image_urls.length : 0) || '?'} slides` : c.r.type === 'video' ? 'Video' : null

  let keys: React.ReactNode
  if (picking) keys = <ReasonPicker lane={c.lane} onPick={onDrop} onCancel={() => setPicking(false)} />
  else {
    const primary = c.judge ? <button type="button" className="cv2-k cv2-k-p" data-key-safe data-verb="card-keep" disabled={busy} onClick={onApprove}>Approve</button>
      : c.primary === 'approve' ? <button type="button" className="cv2-k cv2-k-p" data-key-safe data-verb="card-approve" disabled={busy} onClick={onApprove}>Approve</button>
        : c.primary === 'board' || next === 'board' ? <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-board" disabled={busy} onClick={onBoard}>{busy ? 'Working…' : `Put on ${POSS[c.lane]} board`}</button>
          : next === 'schedule' && (c.r.scheduled_at || slot) ? <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-schedule" disabled={busy} onClick={() => onSchedule(c.r.scheduled_at ? undefined : slot!.at)}>
            {busy ? 'Working…' : c.r.scheduled_at ? `Schedule ${whenOf(c, now)}` : `Schedule ${slotWord(slot!)}`}</button>
            : next === 'date' ? <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-date-it" disabled={busy} onClick={onDate}>Date it</button>
              : null
    keys = <>
      {c.judge && <button type="button" className="cv2-k" data-verb="card-drop" disabled={busy} onClick={() => setPicking(true)}>Drop</button>}
      {!c.judge && c.primary === 'approve' && <button type="button" className="cv2-k" data-verb="card-skip" disabled={busy} onClick={onSkip}>Skip</button>}
      {editable && <button type="button" className="cv2-k" data-verb="card-edit" disabled={busy} onClick={onEdit}>Edit</button>}
      {next === 'schedule' && !c.r.scheduled_at && <button type="button" className="cv2-k" data-verb="card-pick-day" disabled={busy} onClick={onDate}>Pick a day</button>}
      <button type="button" className="cv2-k cv2-k-q" data-verb="card-open" onClick={onOpen}>Details</button>
      <span className="cv2-grow" />
      {primary}
    </>
  }

  return (
    <article ref={ref} className={`cv2-rc${open ? ' cv2-rc-open' : ''}`} role="listitem" data-card-id={id} data-lane={c.lane} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
      tabIndex={focused ? 0 : -1} aria-current={focused ? 'true' : undefined} aria-label={`${LANE_NAME[c.lane]} draft: ${splitTitleTag(c.title).text}`} onFocus={onFocus}>
      <header className="cv2-rc-meta">
        <SeatAv lane={c.lane} /><b>{LANE_NAME[c.lane]}</b>
        <span className="cv2-dim">{whenOf(c, now)}</span>
        {qa && <Pill tone="warn" title={qa.title}>{qa.text}</Pill>}
        <span className="cv2-grow" />
        <EarlyReadChip read={read} lane={c.lane} />
        <Pill tone={pill.tone}>{pill.text}</Pill>
        <Menu label="More for this draft" items={menu} head={tag || c.viewOnly ? head : undefined} />
      </header>
      <div className="cv2-rc-post" onClick={onOpen}>
        <LinkedInCard lane={c.lane} body={body} images={pic ?? c.r.image_urls} type={c.r.type} open={more} onToggle={setMore} />
      </div>
      <BrainDraftBadge draft={c.r} />
      <div className={`cv2-pic${editablePic ? '' : ' cv2-pic-ro'}`} data-repeat={repeat ? 'yes' : undefined}>
        {editablePic ? <PictureRow d={c.r} lane={c.lane} onShow={setPic} onDone={onChanged} disabled={busy} />
          : <span className="cv2-pic-line">{kind ?? (c.r.image_urls && Array.isArray(c.r.image_urls) && c.r.image_urls.length ? 'Picture' : 'Text only')}{kind === null && c.r.published_at ? ' · posted' : ''}</span>}
        {repeat && <span className="cv2-rep" title="The same picture sits on another post of this seat within two weeks">Same picture {repeat.label}</span>}
      </div>
      {(src.author || src.result || src.kind) && (
        <div className="cv2-src">
          <button type="button" className="cv2-src-line" aria-expanded={srcOpen} data-verb="card-source" onClick={() => setSrcOpen(o => !o)}>
            <span>{src.author ? `From ${src.author}` : src.kind}{src.result ? ` · ${src.result}` : ''}</span><i aria-hidden="true">{srcOpen ? '▾' : '▸'}</i>
          </button>
          {srcOpen && <SourceCol src={src} loading={srcLoading} />}
        </div>
      )}
      <div className={`cv2-rc-keys${picking ? ' cv2-rc-why' : ''}`}>{keys}</div>
    </article>
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
      <p className="cv2-fine">{lane === 'ivan' ? 'Drop deletes the draft.' : `Drop deletes the draft from ${OWNER[lane]}’s queue.`} The reason is kept and the next weekly pick reads it. Undo for 5 seconds.</p>
    </div>
  )
}

/** The decided card: what was decided, the reason, Undo draining for 5 s, then the seat's next step once SAVED. */
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
    <article className={`cv2-strip cv2-strip-${e.verdict}${failed ? ' cv2-strip-bad' : ''}`} role="listitem" data-strip-id={e.id} data-phase={e.phase} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
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
          {saved && c.lane === 'arch' && onDate && <button type="button" className="cv2-k cv2-k-p" data-verb="next-date" onClick={onDate}>Date it</button>}
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
