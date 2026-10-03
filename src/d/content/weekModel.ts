// D · Content > Review: THIS WEEK, one stack across the three seats. Pure: rows
// in, the groups and cards the page draws out. Every rule it leans on is
// today's (lib/content, calendarItems.canMoveDate, model.ts); this file only
// arranges them.
//
// ORDER (Ivan 29 Sep, "much nicer, smooth and useful"): today first (with any
// post that did not go out on its time), then each upcoming day of the next
// seven, then the drafts still in review with no date this week (newest first,
// older than two weeks in a fold).
//
// AN ARCH CARD IS VIEW ONLY. Arch's publisher posts rows at review without an
// approval (Davorin reviews on Friday), so the stack's one-tap keys stay off
// Arch cards: no date control, no status action, its one key is Open. The open
// post and the Planner keep every Arch control they had before.
import { canMoveDate } from '../../lib/calendarItems'
import { isStuckGenerating, normalizeImageUrls, singlePhoto, stageOfLane, type ContentDraft } from '../../lib/content'
import { isBrainPost } from '../../lib/brainDraft'
import type { StoredVerdict, Verdict } from '../../lib/verdicts'
import { warsawDay, warsawDm, warsawDow, warsawHm } from '../ui/time'
import { DAY_MS, WAIT_DAYS, imgOf, splitTitleTag, titleOf, type Lane } from './model'

export type Show = 'all' | Lane
export const SHOWS: readonly Show[] = ['all', 'ivan', 'risedtc', 'arch']

/** The one key a card carries. */
export type Primary = 'approve' | 'schedule' | 'board' | 'open'
export const PRIMARY_LABEL: Record<Primary, string> = { approve: 'Approve', schedule: 'Schedule', board: 'Put on board', open: 'Open' }

export type FlagTone = 'dim' | 'warn' | 'ok'
export type Flag = { key: string; text: string; tone: FlagTone; title?: string }

export type WeekCard = {
  r: ContentDraft
  lane: Lane
  /** Warsaw day key of the post's date, or null (undated). */
  day: string | null
  primary: Primary
  /** A date control is offered (Ivan and Rise only, the statuses operator_set_schedule_date takes). */
  canDate: boolean
  viewOnly: boolean
  /** Dated in the past and never went out. */
  overdue: boolean
  flags: Flag[]
  thumb: string | null
  title: string
  body: string
  /** A brain draft Ivan can still judge: its two keys are Drop + Approve (run 39). */
  judge: boolean
  /** An open verdict strip (held / saving / saved / failed) stands in this card's place. */
  strip: boolean
  /** Approved and put away (this session or a saved verdict): a normal card with an "Approved" flag. */
  kept: boolean
}

export type WeekGroup = { key: string; kind: 'today' | 'day' | 'review'; label: string; date: string | null; cards: WeekCard[] }

export type Week = {
  groups: WeekGroup[]
  /** Review drafts older than two weeks (the fold), newest first. */
  older: WeekCard[]
  /** Every card id in reading order (the fold last): the walk the open post takes with j/k. */
  ids: string[]
  lanes: Map<string, Lane>
  /** Cards per seat, before the lane filter (the chip counts). */
  perLane: Record<Lane, number>
  /** Cards whose one key is a decision (approve / put on board / schedule), per seat; the older fold is not counted. */
  toDecide: Record<Lane, number>
  /** Brain drafts still to judge (Approve or Drop), before the seat filter; per seat in toJudgeByLane. */
  toJudge: number
  toJudgeByLane: Record<Lane, number>
}

/** The part of a session verdict (verdictStore.Judged) the model needs. */
export type JudgedLite = { verdict: Verdict; phase: 'held' | 'saving' | 'saved' | 'failed'; collapsed: boolean }

export type Pending = ReadonlyMap<string, 'approve' | 'skip'>

export const WINDOW_DAYS = 7
/** How far back a dated post that never went out still shows (in Today). */
export const OVERDUE_DAYS = 7

const KEEP = new Set(['review', 'approved', 'scheduled', 'published', 'error'])
const LANE_ORDER: Record<Lane, number> = { ivan: 0, risedtc: 1, arch: 2 }

/** Which seat a raw carousel_drafts row belongs to (null / 'ivan' = Ivan), or null for any other tenant. */
export function laneOfRow(r: Pick<ContentDraft, 'client_id'>): Lane | null {
  const c = r.client_id
  if (c == null || c === 'ivan') return 'ivan'
  return c === 'risedtc' || c === 'arch' ? c : null
}

/** The next `n` Warsaw day keys from `now` (today first). */
export function windowDays(now: number, n: number = WINDOW_DAYS): string[] {
  const out: string[] = []
  for (let i = 0; out.length < n && i < n + 2; i++) {
    const k = warsawDay(now + i * DAY_MS)
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/** "Tomorrow" / "Thu" for a day key. */
export function dayWord(key: string, now: number): string {
  const t = Date.parse(`${key}T10:00:00Z`)
  if (key === warsawDay(now)) return 'Today'
  if (key === warsawDay(now + DAY_MS)) return 'Tomorrow'
  return warsawDow(t)
}

export function dayDate(key: string): string {
  const t = Date.parse(`${key}T10:00:00Z`)
  return `${warsawDow(t)} ${warsawDm(t)}`
}

/** Armed = something will publish it on its date (Ivan: status scheduled; a client: on his board at review/scheduled). */
export function armed(r: ContentDraft, lane: Lane): boolean {
  if (r.published_at || !r.scheduled_at) return false
  if (lane === 'ivan') return r.status === 'scheduled'
  return r.board_visible === true && (r.status === 'review' || r.status === 'scheduled')
}

export function primaryOf(r: ContentDraft, lane: Lane): Primary {
  if (lane === 'arch' || r.published_at || r.status === 'published') return 'open'
  if (lane === 'ivan') {
    if (r.status === 'review') return 'approve'
    if (r.status === 'approved' && r.scheduled_at) return 'schedule'
    return 'open'
  }
  return r.status === 'review' && r.board_visible !== true ? 'board' : 'open'
}

export function canDateOf(r: ContentDraft, lane: Lane): boolean {
  return lane !== 'arch' && !r.published_at && canMoveDate(r)
}

const PASSY = /^(pass|approved|rewrite_ok|ok)$/i

export function flagsOf(r: ContentDraft, lane: Lane, o: { now: number; overdue: boolean; blocked: string | null }): Flag[] {
  const f: Flag[] = []
  if (o.blocked) f.push({ key: 'blocked', text: 'Blocked', tone: 'warn', title: o.blocked })
  else if (o.overdue || stageOfLane(r, lane, o.now) === 'stuck') f.push({ key: 'stuck', text: 'Did not go out', tone: 'warn' })
  else if (r.status === 'error') f.push({ key: 'error', text: 'Error', tone: 'warn' })
  else if (r.published_at || r.status === 'published') f.push({ key: 'posted', text: `Posted${r.published_at ? ` ${warsawHm(r.published_at)}` : ''}`, tone: 'dim' })
  else if (armed(r, lane)) f.push({ key: 'armed', text: 'Scheduled', tone: 'ok' })
  else if (lane !== 'ivan' && r.board_visible === true) f.push({ key: 'board', text: 'On board', tone: 'dim' })
  else if (r.scheduled_at) f.push({ key: 'planned', text: lane === 'ivan' ? 'Not scheduled' : 'Not on board', tone: 'warn', title: 'Dated, but nothing will publish it yet' })
  const imgs = normalizeImageUrls(r.image_urls)
  if (r.type === 'carousel') f.push({ key: 'kind', text: `Carousel${imgs.length ? ` · ${imgs.length}` : ''}`, tone: 'dim' })
  else if (r.type === 'video') f.push({ key: 'kind', text: 'Video', tone: 'dim' })
  else if (singlePhoto(r.type) && imgs.length === 0) f.push({ key: 'noimg', text: 'No image', tone: lane === 'ivan' ? 'dim' : 'warn' })
  else if (imgs.some(u => /selfie/i.test(u))) f.push({ key: 'selfie', text: 'Selfie', tone: 'dim' })
  if (r.qa_verdict || r.qa_score) {
    // A passing verdict is just its score; anything else names itself, in the warn tone.
    const v = (r.qa_verdict ?? '').trim()
    const s = r.qa_score ? Math.round(Number(r.qa_score)) || r.qa_score : ''
    const pass = !v || PASSY.test(v)
    f.push({ key: 'qa', text: `QA ${pass ? '' : `${v.toLowerCase().replace(/_/g, ' ')} `}${s}`.trim(), tone: pass ? 'dim' : 'warn', title: v ? `QA verdict: ${v}` : undefined })
  }
  if (lane === 'arch') f.push({ key: 'view', text: 'View only', tone: 'dim', title: 'Davorin reviews Arch posts on Friday. Open the post for its board, date and picture controls.' })
  return f
}

/** The card's opening: the title line (a leading [tag] dropped) and the body without a repeat of it. */
export function openingOf(r: ContentDraft): { title: string; body: string } {
  const { text } = splitTitleTag(titleOf(r))
  const norm = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
  const lines = (r.post_body ?? '').split('\n')
  const first = lines.findIndex(l => l.trim())
  const body = first >= 0 && norm(lines[first]) === norm(text) ? lines.slice(first + 1).join('\n') : (r.post_body ?? '')
  return { title: text, body: body.replace(/^\s*\n+/, '') }
}

/**
 * LinkedIn's "…see more": the feed shows about three lines and cuts. Lines are
 * counted the way the feed wraps them (a blank line is a line, a long one takes
 * as many as it wraps to at `perLine` characters). The cut lands on a word.
 */
export function foldText(body: string, maxLines = 3, perLine = 46): { head: string; folded: boolean } {
  const text = body.replace(/\s+$/, '')
  const lines = text.split('\n')
  const out: string[] = []
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const need = Math.max(1, Math.ceil(line.length / perLine))
    if (used + need <= maxLines) { out.push(line); used += need; continue }
    const room = (maxLines - used) * perLine
    if (room > 0) {
      const cut = line.slice(0, room)
      const sp = cut.lastIndexOf(' ')
      out.push((sp > room * 0.5 ? cut.slice(0, sp) : cut).trimEnd())
    }
    return { head: out.join('\n').replace(/\s+$/, ''), folded: true }
  }
  return { head: text, folded: false }
}

function cardOf(r: ContentDraft, lane: Lane, now: number, overdue: boolean, blocks: Map<string, string> | null | undefined): WeekCard {
  const { title, body } = openingOf(r)
  return {
    r, lane,
    day: r.scheduled_at ? warsawDay(r.scheduled_at) : null,
    primary: primaryOf(r, lane),
    canDate: canDateOf(r, lane),
    viewOnly: lane === 'arch',
    overdue,
    flags: flagsOf(r, lane, { now, overdue, blocked: blocks?.get(r.id) ?? null }),
    thumb: imgOf(r.image_urls, 240),
    title, body,
    judge: false, strip: false, kept: false,
  }
}

const byAt = (a: WeekCard, b: WeekCard) => {
  const x = a.r.scheduled_at ?? '', y = b.r.scheduled_at ?? ''
  return x < y ? -1 : x > y ? 1 : LANE_ORDER[a.lane] - LANE_ORDER[b.lane]
}
const byNewest = (a: WeekCard, b: WeekCard) => Date.parse(b.r.created_at) - Date.parse(a.r.created_at)

export function buildWeek(rows: readonly ContentDraft[], o: {
  now: number
  show?: Show
  pending?: Pending
  /** Board visibility written from here and not read back yet (optimistic). */
  board?: ReadonlyMap<string, boolean>
  blocks?: Map<string, string> | null
}): Week {
  const { now, show = 'all', pending, board, blocks } = o
  const today = warsawDay(now)
  const days = windowDays(now)
  const inWindow = new Set(days)
  const oldest = warsawDay(now - OVERDUE_DAYS * DAY_MS)
  const cut = now - WAIT_DAYS * DAY_MS
  const dayCards = new Map<string, WeekCard[]>()
  const review: WeekCard[] = []
  const older: WeekCard[] = []
  const perLane: Record<Lane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  const toDecide: Record<Lane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  const seen = new Set<string>()

  for (const raw of rows) {
    const lane = laneOfRow(raw)
    if (!lane || seen.has(raw.id)) continue
    seen.add(raw.id)
    const p = pending?.get(raw.id)
    if (p === 'skip') continue
    let r = p === 'approve' && raw.status === 'review' ? { ...raw, status: 'approved' } : raw
    if (board?.has(r.id)) r = { ...r, board_visible: board.get(r.id) }
    if (!KEEP.has(r.status)) continue
    const k = r.scheduled_at ? warsawDay(r.scheduled_at) : null
    const posted = !!r.published_at || r.status === 'published'
    let place: 'day' | 'today-overdue' | 'review' | null = null
    if (k && inWindow.has(k)) place = 'day'
    else if (k && k < today && k >= oldest && !posted && armed(r, lane)) place = 'today-overdue'
    else if (r.status === 'review') place = 'review'
    if (!place) continue
    const c = cardOf(r, lane, now, place === 'today-overdue', blocks)
    const stale = place === 'review' && Date.parse(r.created_at) <= cut
    perLane[lane] += 1
    // The fold (review older than two weeks) is not counted as work, the same cut the frame's count makes.
    if (c.primary !== 'open' && !stale) toDecide[lane] += 1
    if (show !== 'all' && show !== lane) continue
    if (place === 'review') (stale ? older : review).push(c)
    else {
      const key = place === 'today-overdue' ? today : (k as string)
      const a = dayCards.get(key); if (a) a.push(c); else dayCards.set(key, [c])
    }
  }

  const groups: WeekGroup[] = []
  for (const key of days) {
    const cards = dayCards.get(key)
    if (!cards?.length) continue
    cards.sort((a, b) => (a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : byAt(a, b)))
    groups.push({ key, kind: key === today ? 'today' : 'day', label: dayWord(key, now), date: dayDate(key), cards })
  }
  review.sort(byNewest)
  older.sort(byNewest)
  if (review.length) groups.push({ key: 'review', kind: 'review', label: 'In review', date: 'no date this week', cards: review })
  const ids = [...groups.flatMap(g => g.cards), ...older].map(c => c.r.id)
  const lanes = new Map<string, Lane>()
  for (const g of groups) for (const c of g.cards) lanes.set(c.r.id, c.lane)
  for (const c of older) lanes.set(c.r.id, c.lane)
  return { groups, older, ids, lanes, perLane, toDecide, toJudge: 0, toJudgeByLane: { ivan: 0, risedtc: 0, arch: 0 } }
}

/**
 * Now holds only unfinished work. The planner owns already armed and published posts.
 *
 * APPROVE / DROP (run 39). `verdicts` = the saved verdicts read from the database, `judged` = this session's
 * taps (verdictStore). A failed tap counts as no verdict. A Dropped draft is hidden once its strip is put
 * away; an Approved one stays as a normal card with an "Approved" flag and no Approve/Drop keys. While a strip is open
 * (held, saving, saved, not yet put away) the card's slot stays in the model (`strip`) so the list can draw
 * the strip in place, and the card is not counted as work (not in the counts, `ids`, `lanes`).
 */
export function buildNow(rows: readonly ContentDraft[], o: {
  now: number; show?: Show; pending?: Pending; blocks?: Map<string, string> | null
  verdicts?: ReadonlyMap<string, StoredVerdict>
  judged?: ReadonlyMap<string, JudgedLite>
}): Week {
  const { now, show = 'all', pending, blocks, verdicts, judged } = o
  const needsFix: WeekCard[] = [], drafts: WeekCard[] = []
  const quiet = new Set<string>()
  const perLane: Record<Lane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  const toDecide: Record<Lane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  const toJudgeByLane: Record<Lane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  const seen = new Set<string>()
  for (const r of rows) {
    const lane = laneOfRow(r)
    if (!lane || seen.has(r.id) || pending?.has(r.id) || r.published_at || r.status === 'published') continue
    seen.add(r.id)
    const s = judged?.get(r.id)
    const verdict: StoredVerdict | undefined = (s && s.phase !== 'failed' ? s.verdict : undefined) ?? verdicts?.get(r.id)
    const strip = !!s && !s.collapsed
    if (verdict === 'drop' && !strip) continue
    const stage = stageOfLane(r, lane, now)
    const stalled = stage === 'generating' && isStuckGenerating(r, now)
    const bad = r.status === 'error' || stage === 'stuck' || stalled || !!blocks?.has(r.id)
    const needsDraft = lane === 'ivan' ? r.status === 'review' || r.status === 'approved' : r.status === 'review' && r.board_visible !== true
    if (!bad && !needsDraft) continue
    const c = cardOf(r, lane, now, stage === 'stuck', blocks)
    if (stalled) c.flags.unshift({ key: 'stalled', text: 'Generation stalled', tone: 'warn' })
    if (bad) { c.primary = 'open'; c.canDate = false }
    c.judge = isBrainPost(r) && (r.status === 'review' || r.status === 'error') && !verdict
    c.strip = strip
    // An Arch brain draft to judge is not view only any more: Approve / Drop are on the card.
    if (c.judge) c.flags = c.flags.filter(f => f.key !== 'view')
    if ((verdict === 'keep' || verdict === 'edited') && !strip) {
      c.kept = true
      c.flags.unshift({ key: 'kept', text: 'Approved', tone: 'dim', title: verdict === 'edited' ? 'You approved this draft after editing it' : 'You approved this draft' })
      // Approve on Ivan's seat approved it; a read that still says review must not offer Approve again.
      if (lane === 'ivan' && r.status === 'review') c.primary = 'open'
    }
    // An open strip (not a failed one: that draft is still undecided) is not work.
    const counted = !strip || s?.phase === 'failed'
    if (!counted) quiet.add(r.id)
    else {
      perLane[lane]++
      if (c.primary !== 'open') toDecide[lane]++
      if (c.judge) toJudgeByLane[lane]++
    }
    if (show !== 'all' && show !== lane) continue
    ;(bad ? needsFix : drafts).push(c)
  }
  const order = (a: WeekCard, b: WeekCard) => {
    if (a.r.scheduled_at && !b.r.scheduled_at) return -1
    if (!a.r.scheduled_at && b.r.scheduled_at) return 1
    return a.r.scheduled_at && b.r.scheduled_at ? byAt(a, b) : byNewest(a, b) || LANE_ORDER[a.lane] - LANE_ORDER[b.lane]
  }
  needsFix.sort(order); drafts.sort(order)
  const groups: WeekGroup[] = []
  if (needsFix.length) groups.push({ key: 'fix', kind: 'review', label: 'Needs a fix', date: null, cards: needsFix })
  if (drafts.length) groups.push({ key: 'drafts', kind: 'review', label: 'Drafts', date: null, cards: drafts })
  const cards = [...needsFix, ...drafts].filter(c => !quiet.has(c.r.id))
  return {
    groups, older: [], ids: cards.map(c => c.r.id), lanes: new Map(cards.map(c => [c.r.id, c.lane])), perLane, toDecide,
    toJudge: toJudgeByLane.ivan + toJudgeByLane.risedtc + toJudgeByLane.arch, toJudgeByLane,
  }
}
