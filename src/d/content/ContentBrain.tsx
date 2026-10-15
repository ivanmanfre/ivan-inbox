import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDecisionHistory, fetchDraftSources, learnedFrom, sourceOf, type DecisionHistory, type DraftSourceRead, type SourceView } from '../../lib/brainPage'
import type { ContentDraft } from '../../lib/content'
import { readEditorialDirection, type EditorialDirectionRead } from '../../lib/editorialDirection'
import type { EditorialClient } from '../../lib/editorialTypes'
import { fetchInputs, type InputsOutlier, type InputsPayload, type InputsState } from '../../lib/cb22'
import { fetchOutliers, putOutlierOnBoard, type OutlierRow, type OutliersPayload } from '../../lib/outliers'
import { fetchPostAudience, type PostAudienceRow, type ReachRead } from '../../lib/reach'
import { supabase } from '../../lib/supabase'
import { readSwr, writeSwr } from '../../lib/swr'
import { BRAIN_DROP_REASONS, reasonLabel, type SavedVerdict } from '../../lib/verdicts'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { dHash } from '../route'
import { useFrameMaybe } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import { Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { DAY_MS, LANES, LANE_NAME, OWNER, POSS, age, dayLabel, titleOf, type Lane } from './model'
import type { WeekRead } from './useWeek'
import { VerdictStrip } from './VerdictStrip'
import { foldText, laneOfRow } from './weekModel'
import { giveReason, judge, markShown, useJudged } from './verdictStore'
import './verdict.css'
import './brain-page.css'

// CONTENT BRAIN (run 51, 5 Oct; Astra's "one Content Brain page"). One page per account that opens on the
// drafts waiting for review, newest first. Each card: the source on the left (the post's own text, or the
// labelled example for a pattern-led idea; author, date, how it did against that author's usual) and the
// draft on the right. Use = the existing Approve verdict (Ivan: approved, nothing publishes; Rise/Arch: the
// verdict only, board unchanged). Edit = the existing open post and its editor (before/after kept as today).
// Drop asks why first (chips or a sentence) and writes through the same verdict call, so every drop on this
// page carries a reason. Below: what's working in the niche (the Outliers page's list), the seat's best posts,
// then the recent decisions. Old planning views stay one link away; nothing was deleted.

const ClientDirectionPanel = lazy(() => import('../../wb/content/research/ResearchWorkspace').then(m => ({ default: m.ClientDirectionPanel })))

const FIRST = 8
const MAX_SOURCES = 60
const CHIPS = [...BRAIN_DROP_REASONS, ['other', 'Other']] as const
const VERDICT_WORD: Record<string, string> = { keep: 'Approved', edited: 'Approved after your edit', drop: 'Dropped' }

/** Review's own rule (weekModel.buildNow): in review and unpublished; a Rise/Arch draft already on the client's board is his to decide. */
export function waitsForReview(r: Pick<ContentDraft, 'status' | 'published_at' | 'client_id' | 'board_visible'>): boolean {
  const lane = laneOfRow(r)
  return !!lane && r.status === 'review' && !r.published_at && (lane === 'ivan' || r.board_visible !== true)
}

export function ContentBrain({ lane, setLane, read, verdicts, openId, onOpen, onChanged }: {
  lane: Lane
  setLane: (l: Lane) => void
  read: WeekRead
  verdicts: Map<string, SavedVerdict>
  openId: string | null
  onOpen: (id: string, lane: Lane) => void
  onChanged: () => void
}) {
  const judged = useJudged()
  const [all, setAll] = useState(false)
  const waitingAll = useMemo(() => read.rows.filter(waitsForReview), [read.rows])
  const counts = useMemo(() => Object.fromEntries(LANES.map(l => [l, waitingAll.filter(r => laneOfRow(r) === l && !verdicts.has(r.id) && !judged.has(r.id)).length])) as Record<Lane, number>, [waitingAll, verdicts, judged])
  // Newest first. A draft with a saved verdict leaves; one judged in this session keeps its place as the strip.
  const waiting = useMemo(() => waitingAll
    .filter(r => laneOfRow(r) === lane && !verdicts.has(r.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)), [waitingAll, lane, verdicts])
  const shown = all ? waiting : waiting.slice(0, FIRST)
  const ids = useMemo(() => waiting.slice(0, MAX_SOURCES).map(r => r.id), [waiting])
  const sources = useSources(ids)
  const own = usePostAudience(lane)

  return (
    <div className="cb" data-content-brain data-lane={lane}>
      <div className="cb-top">
        <div className="cn-wk2-chips" role="tablist" aria-label="Account">
          {LANES.map(l => (
            <button key={l} type="button" role="tab" aria-selected={l === lane} data-verb={`brain-lane-${l}`} onClick={() => setLane(l)}>
              {LANE_NAME[l]}<b>{read.source === 'none' ? '…' : counts[l]}</b>
            </button>
          ))}
        </div>
        <DirectionLine lane={lane} />
      </div>

      <section className="cb-sec" aria-label="Ready to review">
        <h2 className="cb-h"><b>Ready to review</b><span>{read.source === 'none' ? 'reading…' : `${counts[lane]} waiting · newest first`}</span>
          <a href={dHash('content', 'now', lane === 'ivan' ? {} : { lane })}>All drafts →</a></h2>
        <ReadState read={read} />
        {read.source === 'none' && !read.settled ? <Skeleton lines={6} title={false} label="Reading the drafts" />
          : read.source === 'none' && read.error ? <Failed what="the drafts" detail={read.error} onRetry={read.refresh} />
            : waiting.length === 0 ? <p className="cb-empty">Nothing of {LANE_NAME[lane]}’s waits for review.</p>
              : <>
                {sources.error && <p className="cb-note" role="alert">Could not read the sources: {sources.error} <button type="button" onClick={sources.retry}>Retry</button></p>}
                {shown.map(r => {
                  const e = judged.get(r.id)
                  if (e && !(e.phase === 'saved' && e.collapsed)) return <VerdictStrip key={r.id} e={e} chips={CHIPS} />
                  if (e) return null
                  return <DraftCard key={r.id} r={r} lane={lane} src={sourceOf(r, sources.map.get(r.id))} srcLoading={!sources.map.has(r.id) && sources.pending} open={r.id === openId} onOpen={() => onOpen(r.id, lane)} onChanged={onChanged} />
                })}
                {waiting.length > FIRST && <button type="button" className="cb-more" data-verb="brain-show-all" onClick={() => setAll(v => !v)}>{all ? `Show the newest ${FIRST}` : `Show all ${waiting.length}`}</button>}
              </>}
      </section>

      <NicheIdeas lane={lane} />
      <BestPosts lane={lane} own={own} />
      <RecentDecisions lane={lane} verdicts={verdicts} />

      <nav className="cb-links" aria-label="History and sources">
        <div><b>Browse sources</b>
          <a href={dHash('content', 'strategy', { lane, section: 'research' })}>Research library</a>
          <a href={dHash('content', 'inputs', { lane })}>Outliers</a>
          <a href={dHash('content', 'strategy', { lane, section: 'markets' })}>Markets</a>
        </div>
        <div><b>History and evidence</b>
          <a href={dHash('content', 'strategy', { lane, section: 'this-week' })}>Saved weekly plans</a>
          <a href={dHash('content', 'brain', { lane, view: 'patterns' })}>Patterns and benchmarks</a>
          <a href={dHash('content', 'results', { lane })}>Results</a>
          <a href={dHash('lanes', null, { sheet: 'outreach', for: lane })}>DM outreach results</a>
        </div>
      </nav>
    </div>
  )
}

function ReadState({ read }: { read: WeekRead }) {
  if (read.source === 'cache') return <p className="cb-note" role="status">Saved copy{read.error ? <> · could not refresh: {read.error} <button type="button" onClick={read.refresh}>Retry</button></> : ' · refreshing…'}</p>
  if (read.source === 'live' && read.error) return <p className="cb-note cb-bad" role="alert">Could not refresh: {read.error} <button type="button" onClick={read.refresh}>Retry</button></p>
  return null
}

export function useSources(ids: string[]) {
  const key = ids.join(',')
  const [state, setState] = useState<{ key: string; map: Map<string, DraftSourceRead>; loaded: boolean; error: string | null }>({ key: '', map: new Map(), loaded: false, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!key) { setState({ key, map: new Map(), loaded: true, error: null }); return }
    let live = true
    setState(s => ({ ...s, loaded: s.key === key && s.loaded, error: null }))
    fetchDraftSources(key.split(','))
      .then(map => { if (live) setState({ key, map, loaded: true, error: null }) })
      .catch(e => { if (live) setState(s => ({ ...s, loaded: false, error: e instanceof Error ? e.message : 'read failed' })) })
    return () => { live = false }
  }, [key, tick])
  // Pending = the read for the drafts on screen now has not answered yet (a newer list re-reads; the old map stays).
  return { map: state.map, pending: !state.error && !(state.key === key && state.loaded), error: state.error, retry: () => setTick(t => t + 1) }
}

function DraftCard({ r, lane, src, srcLoading, open, onOpen, onChanged }: {
  r: ContentDraft; lane: Lane; src: SourceView; srcLoading: boolean; open: boolean; onOpen: () => void; onChanged: () => void
}) {
  const wide = useFrameMaybe()?.layout === 'desktop'
  const [more, setMore] = useState(false)
  const [why, setWhy] = useState(false)
  const [chip, setChip] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const ref = useRef<HTMLElement>(null)
  const title = titleOf(r)
  const body = (r.post_body ?? '').trim()
  const learning = learnedFrom(r, lane)
  const fold = foldText(body, wide ? 9 : 6, wide ? 64 : 40)
  const id = r.id
  // Time to verdict starts when the card is half on screen (once per draft), as on Review.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { markShown(id); return }
    const io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { markShown(id); io.disconnect() } }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [id])
  const use = () => judge(id, 'keep', { lane, title, onCommitted: onChanged })
  const canDrop = !!chip || note.trim().length > 0
  const drop = () => {
    if (!canDrop) return
    judge(id, 'drop', { lane, title, onCommitted: onChanged })
    giveReason(id, chip ?? 'other', note.trim() || null)
  }
  return (
    <article ref={ref} className={`cb-card${open ? ' cb-card-on' : ''}`} data-card-id={id} data-lane={lane}>
      <SourceCol src={src} loading={srcLoading} />
      <div className="cb-draft">
        <div className="cb-lbl">Your draft<span>{LANE_NAME[lane]} · created {age(r.created_at)} ago{r.qa_verdict ? ` · QA ${String(r.qa_verdict).toLowerCase()}${r.qa_score ? ` ${r.qa_score}` : ''}` : ''}</span></div>
        <button type="button" className="cb-title" data-verb="brain-open" onClick={onOpen}>{title}</button>
        {body && <p className="cb-body">{(more ? body : fold.head).replace(/\n{3,}/g, '\n\n')}
          {fold.folded && !more && <>{' '}<button type="button" className="cb-see" data-verb="brain-see-more" onClick={() => setMore(true)}>…see more</button></>}</p>}
        {learning && <p className="cb-meta" data-learned-from>Learned from: {learning}</p>}
        {!why ? (
          <div className="cb-acts">
            <button type="button" className="cb-key cb-use" data-verb="brain-use" onClick={use}>Use</button>
            <button type="button" className="cb-key" data-verb="brain-edit" onClick={onOpen}>Edit</button>
            <button type="button" className="cb-key cb-drop" data-verb="brain-drop" onClick={() => setWhy(true)}>Drop</button>
          </div>
        ) : (
          <form className="cb-why" aria-label="Why drop it" onSubmit={e => { e.preventDefault(); drop() }}>
            <span className="cb-lbl">Why drop it?</span>
            <div className="cb-chips" role="group" aria-label="Reason">
              {BRAIN_DROP_REASONS.map(([slug, label]) => (
                <button key={slug} type="button" data-verb="brain-reason" data-reason={slug} aria-pressed={chip === slug} onClick={() => setChip(c => c === slug ? null : slug)}>{label}</button>
              ))}
            </div>
            <input type="text" value={note} maxLength={500} placeholder="Or say why in a few words" aria-label="Why, in your words" onChange={e => setNote(e.target.value)} />
            <div className="cb-acts">
              <button type="button" className="cb-key" data-verb="brain-drop-cancel" onClick={() => { setWhy(false); setChip(null); setNote('') }}>Cancel</button>
              <button type="submit" className="cb-key cb-drop" data-verb="brain-drop-confirm" disabled={!canDrop}>Drop it</button>
            </div>
            <p className="cb-fine">{lane === 'ivan' ? 'Drop deletes the draft.' : `Drop deletes the draft from ${OWNER[lane]}’s queue.`} The reason is kept and the next weekly pick reads it. Undo for 5 seconds.</p>
          </form>
        )}
      </div>
    </article>
  )
}

export function SourceCol({ src, loading }: { src: SourceView; loading: boolean }) {
  const [full, setFull] = useState(false)
  const text = src.text?.trim() ?? ''
  const fold = foldText(text, 8, 58)
  return (
    <div className="cb-src" data-source-kind={src.kind}>
      <div className="cb-lbl">{src.example ? 'Pattern-led idea' : 'Where it came from'}<span>{src.kind}</span></div>
      {(src.author || src.date) && <p className="cb-who">{[src.author, src.date ? dayLabel(src.date) : null].filter(Boolean).join(' · ')}</p>}
      {src.result && <p className="cb-res">{src.result}</p>}
      {text ? (
        <blockquote className="cb-quote">
          {src.example && <span className="cb-ex">Example of the pattern, not the post this draft adapts</span>}
          {full ? text : fold.head}
          {fold.folded && <>{' '}<button type="button" className="cb-see" data-verb="brain-source-more" onClick={() => setFull(f => !f)}>{full ? 'Show less' : '…show all'}</button></>}
        </blockquote>
      ) : src.kind === 'Lead magnet launch' ? <p className="cb-dim">The launch post for a resource; there is no source post.</p>
        : loading ? <p className="cb-dim">Reading the source text…</p> : <p className="cb-dim">Source text not stored for this draft.</p>}
      {src.borrowed && <p className="cb-meta"><b>We borrowed</b> {src.borrowed}</p>}
      {src.why && <p className="cb-meta"><b>Why this idea</b> {src.why}</p>}
      {src.url && <a className="cb-open" href={src.url} target="_blank" rel="noreferrer" data-verb="brain-source-open">Open the original ↗</a>}
    </div>
  )
}

// DIRECTION, READ IN FULL (Ivan 2026-10-15: "Direction i cant even read it", one truncated line of
// objective · "4 posts a week (buyer 1, reach 2, consideration 1)" · adopted date). Now the weekly count in
// plain words first, "4 posts a week: 2 for reach, 1 for trust, 1 for buyers" (the Aim words the calendar and
// the draft window already print: Reach, Trust, Buyers), the aim sentence under it, quieter. Both wrap.
const AIM_WORD: Record<string, string> = { reach: 'reach', consideration: 'trust', trust: 'trust', buyer: 'buyers', buyers: 'buyers' }
const AIM_ORDER = ['reach', 'trust', 'buyers']

export type DirectionWords = { main: string; aim: string | null; weekly: number | null }

/** Pure: the direction's weekly policy in plain words. `weekly` = weekly_total (the Brain's dated target reads it). */
export function directionWords(policy: Record<string, unknown> | null | undefined): DirectionWords {
  const p = policy ?? null
  const weekly = typeof p?.weekly_total === 'number' && p.weekly_total > 0 ? p.weekly_total : null
  const values = p && typeof p.allocation === 'object' && p.allocation ? (p.allocation as { values?: Record<string, unknown> }).values ?? null : null
  const parts: [string, number][] = []
  for (const [k, v] of Object.entries(values ?? {})) {
    if (typeof v !== 'number' || v <= 0) continue
    const w = AIM_WORD[k.toLowerCase()] ?? k.replace(/_/g, ' ').toLowerCase()
    const at = parts.findIndex(x => x[0] === w)
    if (at >= 0) parts[at][1] += v; else parts.push([w, v])
  }
  parts.sort((a, b) => (AIM_ORDER.indexOf(a[0]) + 1 || 9) - (AIM_ORDER.indexOf(b[0]) + 1 || 9))
  const mix = parts.map(([w, v]) => `${v} for ${w}`).join(', ')
  const main = weekly != null ? `${weekly} post${weekly === 1 ? '' : 's'} a week${mix ? `: ${mix}` : ''}` : mix ? `Each week: ${mix}` : 'No weekly count set.'
  const objective = typeof p?.objective === 'string' && p.objective.trim() ? p.objective.trim().replace(/\s*[—–]\s*/g, ', ') : null
  // SwishDM's mix is a planning draft (weekly_policy.status), not adopted yet: say so on the quiet line.
  const draft = typeof p?.status === 'string' && p.status !== 'adopted'
  const aim = [draft ? 'Draft, not adopted yet.' : null, objective ? (/[.!?]$/.test(objective) ? objective : `${objective}.`) : null].filter(Boolean).join(' ') || null
  return { main, aim, weekly }
}

export type DirectionState = { d: EditorialDirectionRead | null; err: string | null; refresh: () => void }

/** One direction read per seat; the Brain page reads it once for the line and the dated target. */
export function useDirection(lane: Lane): DirectionState {
  const [d, setD] = useState<EditorialDirectionRead | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setD(null); setErr(null)
    readEditorialDirection(supabase as unknown as EditorialClient, lane)
      .then(x => { if (live) setD(x) })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Direction could not be read.') })
    return () => { live = false }
  }, [lane, tick])
  const refresh = useCallback(() => setTick(t => t + 1), [])
  return { d, err, refresh }
}

/** The weekly policy when the seat has an adopted direction; null while reading or with none. */
export function policyOf(st: DirectionState): Record<string, unknown> | null {
  return st.d?.status === 'active' ? (st.d.direction?.weekly_policy ?? null) as Record<string, unknown> | null : null
}

export function DirectionLine({ lane }: { lane: Lane }) {
  return <DirectionView lane={lane} st={useDirection(lane)} />
}

export function DirectionView({ lane, st }: { lane: Lane; st: DirectionState }) {
  const [edit, setEdit] = useState(false)
  const { d, err } = st
  const words = d?.status === 'active' ? directionWords(policyOf(st)) : null
  const main = !d ? (err ? 'Direction could not be read.' : 'Reading direction…') : words ? words.main : 'No direction set yet.'
  return (
    <div className="cb-dir" data-direction>
      <span className="cb-lbl">Direction</span>
      <div className="cb-dir-t">
        <p className="cb-dir-main">{main}</p>
        {words?.aim && <p className="cb-dir-aim" title={d?.updated_at ? `Set ${dayLabel(d.updated_at.slice(0, 10))}` : undefined}>{words.aim}</p>}
      </div>
      <button type="button" className="cb-link" data-verb="brain-direction-edit" onClick={() => setEdit(true)}>Edit</button>
      <Sheet open={edit} onClose={() => { setEdit(false); st.refresh() }} title={`${LANE_NAME[lane]} · direction`} sub="Posts a week, what they are for, and the full direction" className="cb-dir-sheet">
        {edit && <div className="cn-legacy app wb ds-shell wb-work" data-wblane={lane}><ConfirmProvider><Suspense fallback={<Skeleton lines={4} label="Reading the direction" />}><ClientDirectionPanel lane={lane} /></Suspense></ConfirmProvider></div>}
      </Sheet>
    </div>
  )
}

// WHAT'S WORKING IN YOUR NICHE (Ivan 2026-10-15 on the old "Next post ideas": "are these outliers? ...
// separated by purpose? for ivan i dont see any poland topics ... it shows more of the famous ppl so idk if
// its fair to say they are outliers", and "when i open all sources it opens top outliers which is a weird
// separated section"). One list with the Outliers page: the fit-checked picks of cb22_inputs come first, in
// its order (saved, recommended, the fit judge, then lift; failed post checks already dropped), each with its
// purpose and one line of why it fits. The rest of the last 21 days fill in after them, ranked by lift WITHIN
// their platform (a 300x X post from a famous account and a 6x LinkedIn post are both the top of their own
// list), one post per author, X never more than half the list, so famous X accounts cannot fill it. Those
// rows say plainly that their fit is not confirmed (cb22 returns at most 5 picks and does not say which of
// the others were judged). Every post sits in the fold under it, the same reader the Outliers page folds;
// nothing jumps to another page.
const NICHE_DAYS = 21
const NICHE_FIRST = 4
const NICHE_MAX = 12
const PLAT_WORD: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' }
const PURPOSE_WORD: Record<string, string> = { reach: 'For reach', consideration: 'For trust', trust: 'For trust', buyer: 'For buyers', buyers: 'For buyers' }
const OutliersView = lazy(() => import('../../wb/content/outliers'))

export type NicheRow = {
  key: string; platform: 'linkedin' | 'x'; post_id: string; author: string; url: string | null; text: string
  published_at: string | null; lift: number | null; likes: number | null
  /** From the fit-checked picks (cb22_inputs top). */
  picked: boolean
  fit: number | null; purpose: string | null; why: string | null; state: InputsState
}

const cleanText = (t: string) => t.replace(/(https?:\/\/\S+|@\w+|#\w+)/g, '').replace(/\s+/g, ' ').trim()

/** The fit judge's reason, cut to its first clause: one plain line, never a paragraph. */
export function shortReason(reason: string | null | undefined, max = 120): string | null {
  const s = (reason ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  let first = s.split(/(?<=[.!?])\s+|;\s*/)[0].replace(/[.;,:]+$/, '').trim()
  if (first.length > max) first = `${first.slice(0, max).replace(/\s+\S*$/, '')}…`
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null
}

/** The post's first line (a short first line takes the next one too), cut on a whole word. */
export function firstLine(text: string, max = 160): string {
  const lines = text.replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean)
  let h = lines[0] ?? ''
  for (let i = 1; h.length < 40 && i < lines.length; i++) h += ' ' + lines[i]
  return h.length > max ? `${h.slice(0, max).replace(/\s+\S*$/, '')}…` : h
}

/** Lift ranked within each platform: the top of each platform's own list scores 1, its bottom near 0. */
export function platformRanked<T extends { platform: string; lift: number | null }>(rows: readonly T[]): T[] {
  const by = new Map<string, T[]>()
  for (const r of rows) by.set(r.platform, [...(by.get(r.platform) ?? []), r])
  const scored: { r: T; pct: number; lift: number }[] = []
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => (Number(b.lift) || 0) - (Number(a.lift) || 0))
    sorted.forEach((r, i) => scored.push({ r, pct: (sorted.length - i) / sorted.length, lift: Number(r.lift) || 0 }))
  }
  const plat = (p: string) => (p === 'linkedin' ? 0 : 1)
  return scored.sort((a, b) => b.pct - a.pct || plat(a.r.platform) - plat(b.r.platform) || b.lift - a.lift).map(x => x.r)
}

/**
 * The fit-checked picks first (never dropped), then the ranked fill, X never more than half of any prefix
 * of the list (ceil): famous X accounts cannot crowd it. X still fills once no LinkedIn post is left.
 */
export function capX<T extends { platform: string }>(picks: readonly T[], ranked: readonly T[], max: number): T[] {
  const out = picks.slice(0, max)
  let x = out.filter(r => r.platform === 'x').length
  const rest = [...ranked]
  while (out.length < max && rest.length) {
    const room = x + 1 <= Math.ceil((out.length + 1) / 2)
    let i = rest.findIndex(r => r.platform !== 'x' || room)
    if (i < 0) i = 0
    const [r] = rest.splice(i, 1)
    out.push(r)
    if (r.platform === 'x') x++
  }
  return out
}

/** Pure: the niche list (cb22 picks + the platform-balanced fill), at most `max` rows. */
export function nicheList(top: readonly InputsOutlier[], pool: readonly OutlierRow[], now: number, max = NICHE_MAX): NicheRow[] {
  const picks: NicheRow[] = top.map(o => ({
    key: `${o.platform}:${o.post_id}`, platform: o.platform, post_id: o.post_id, author: o.author, url: o.url, text: o.text,
    published_at: o.published_at, lift: o.lift, likes: o.likes ?? o.likes_line ?? null, picked: true,
    fit: o.fit, purpose: o.purpose && o.purpose !== 'none' ? o.purpose : null, why: shortReason(o.reason), state: o.state,
  }))
  const seen = new Set(picks.map(r => r.key))
  const since = now - NICHE_DAYS * DAY_MS
  const fill: NicheRow[] = pool
    .filter(r => !r.idea && !seen.has(`${r.platform}:${r.post_id}`) && Date.parse(r.published_at) >= since && cleanText(r.text ?? '').length >= 60)
    .map(r => ({
      key: `${r.platform}:${r.post_id}`, platform: r.platform, post_id: r.post_id, author: r.author, url: r.url, text: r.text ?? '',
      published_at: r.published_at, lift: Number.isFinite(Number(r.lift)) ? Number(r.lift) : null, likes: r.likes, picked: false,
      fit: null, purpose: null, why: null, state: null,
    }))
  // One post per author in the fill (2026-10-15: two of the four were the same famous X account).
  const authors = new Set(picks.map(r => r.author.toLowerCase()))
  const ranked = platformRanked(fill).filter(r => { const k = r.author.toLowerCase(); if (authors.has(k)) return false; authors.add(k); return true })
  return capX(picks, ranked, max)
}

const liftWords = (r: Pick<NicheRow, 'lift' | 'likes'>) => r.lift != null && Number.isFinite(r.lift) ? `${Number(r.lift.toFixed(1))}x their usual`
  : r.likes != null ? `${r.likes.toLocaleString('en-US')} likes` : null

/** Reads start only when the section comes near the screen; the first paint is the saved copy. */
function useNear<T extends HTMLElement>() {
  const box = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { box, near }
}

export function NicheIdeas({ lane, now = Date.now() }: { lane: Lane; now?: number }) {
  const toast = useToast()
  const tracked = lane !== 'swishdm'   // operator_outliers and cb22_inputs know ivan, risedtc and arch only
  // The same saved copies the Outliers page and the old ideas list wrote: one cache per reader.
  const seedTop = useMemo(() => readSwr<InputsPayload>(`cb22-inputs:${lane}`), [lane])
  const seedPool = useMemo(() => readSwr<OutliersPayload>(`outliers:${lane}`), [lane])
  const [top, setTop] = useState<InputsOutlier[] | null>(() => seedTop?.payload?.top ?? null)
  const [pool, setPool] = useState<OutlierRow[] | null>(() => seedPool?.payload?.rows ?? null)
  const [topErr, setTopErr] = useState<string | null>(null)
  const [poolErr, setPoolErr] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [fold, setFold] = useState(false)
  const [used, setUsed] = useState<Record<string, string>>({})
  const { box, near } = useNear<HTMLElement>()
  useEffect(() => {
    setMore(false); setFold(false)
    if (!near || !tracked) return
    let live = true
    setTop(seedTop?.payload?.top ?? null); setPool(seedPool?.payload?.rows ?? null); setTopErr(null); setPoolErr(null)
    void fetchInputs(lane).then(r => {
      if (!live) return
      if (r.kind === 'ready') { setTop(r.data.top); writeSwr(`cb22-inputs:${lane}`, r.data) } else setTopErr(r.message)
    }).catch(e => { if (live) setTopErr(e instanceof Error ? e.message : 'read failed') })
    void fetchOutliers(lane).then(r => {
      if (!live) return
      if (r.kind === 'ready') { setPool(r.data.rows); writeSwr(`outliers:${lane}`, r.data) } else setPoolErr(r.message)
    }).catch(e => { if (live) setPoolErr(e instanceof Error ? e.message : 'read failed') })
    return () => { live = false }
  }, [lane, seedTop, seedPool, near, tracked])
  const list = useMemo(() => nicheList(top ?? [], pool ?? [], now), [top, pool, now])
  const shown = more ? list : list.slice(0, NICHE_FIRST)
  const save = useCallback(async (r: NicheRow) => {
    setUsed(u => ({ ...u, [r.key]: 'busy' }))
    const res = await putOutlierOnBoard(lane, r.platform, r.post_id)
    if (res.ok) { setUsed(u => ({ ...u, [r.key]: 'done' })); toast.show({ message: lane === 'ivan' ? 'Saved to Ideas.' : `Saved to ${OWNER[lane]}’s Ideas.`, sub: 'Nothing is scheduled or sent.' }) }
    else setUsed(u => ({ ...u, [r.key]: res.message }))
  }, [lane, toast])
  const reading = tracked && (top === null && !topErr) && (pool === null && !poolErr)
  const failed = tracked && !reading && top === null && pool === null
  const ideasHref = dHash('content', 'ideas', lane === 'ivan' ? {} : { lane })
  return (
    <section ref={box} className="cb-sec" aria-label="What’s working in your niche" data-niche>
      <h2 className="cb-h"><b>What’s working in your niche</b><span>posts that beat their author’s usual, best fit first</span></h2>
      {!tracked ? <p className="cb-empty">No niche posts tracked for {LANE_NAME[lane]} yet.</p>
        : reading ? <Skeleton lines={3} title={false} label="Reading niche posts" />
          : failed ? <Failed what="the niche posts" detail={topErr ?? poolErr ?? 'read failed'} />
            : list.length === 0 ? <p className="cb-empty">No niche posts this week.</p>
              : <>
                {topErr && <p className="cb-note" role="status">Could not read the fit picks, so every post below is unconfirmed.</p>}
                <ol className="cb-ideas">{shown.map(r => {
                  const st = used[r.key]
                  const purpose = r.purpose ? PURPOSE_WORD[r.purpose] ?? null : null
                  const lift = liftWords(r)
                  return <li key={r.key} className="cb-idea" data-niche-row data-platform={r.platform} data-picked={r.picked || undefined}>
                    <div className="cb-lbl">{PLAT_WORD[r.platform]}<span>{r.author}{r.published_at ? ` · ${dayLabel(r.published_at.slice(0, 10))}` : ''}</span>{purpose && <i className="cb-ptag">{purpose}</i>}</div>
                    {lift && <p className="cb-res">{lift}</p>}
                    <p className="cb-idea-t">{firstLine(r.text)}</p>
                    {r.why ? <p className="cb-fitwhy">{r.why}</p>
                      : <p className="cb-fitq">{r.picked ? 'Not checked for fit yet' : 'Fit not confirmed'}</p>}
                    <div className="cb-acts">
                      {r.url && <a className="cb-link" href={r.url} target="_blank" rel="noreferrer">Open ↗</a>}
                      {r.state === 'in_review' || st === 'done' ? <a className="cb-link" href={ideasHref} data-verb="brain-open-idea">In Ideas →</a>
                        : r.state === 'decided' ? <span className="cb-fitq">Already decided</span>
                          : <button type="button" className="cb-key" data-verb="brain-save-idea" disabled={st === 'busy'} onClick={() => void save(r)}>{st === 'busy' ? 'Saving…' : 'Save idea'}</button>}
                    </div>
                    {st && st !== 'busy' && st !== 'done' && <p className="cb-note cb-bad" role="alert">{st}</p>}
                  </li>
                })}</ol>
                {list.length > NICHE_FIRST && <button type="button" className="cb-more" data-verb="brain-niche-more" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? 'Show fewer' : 'Show more'}</button>}
              </>}
      {tracked && pool && pool.length > 0 && (
        <details className="cb-fold" data-niche-fold open={fold} onToggle={e => setFold((e.currentTarget as HTMLDetailsElement).open)}>
          <summary data-verb="brain-every-post">Every niche post ({pool.length.toLocaleString('en-US')})</summary>
          {fold && <div className="cn-legacy app wb ds-shell wb-work" data-wblane={lane}>
            <ConfirmProvider><Suspense fallback={<Skeleton lines={5} label="Reading every niche post" />}><OutliersView key={lane} lane={lane} humanLabels /></Suspense></ConfirmProvider>
          </div>}
        </details>
      )}
    </section>
  )
}

/** One read of the seat's own posts (operator_post_audience): the Brain's best-post tile and best posts share it. */
export function usePostAudience(lane: Lane): ReachRead | null {
  const [own, setOwn] = useState<ReachRead | null>(null)
  useEffect(() => {
    let live = true
    setOwn(null)
    void fetchPostAudience(lane).then(r => { if (live) setOwn(r) }).catch(e => { if (live) setOwn({ kind: 'failed', message: e instanceof Error ? e.message : 'read failed' }) })
    return () => { live = false }
  }, [lane])
  return own
}

/** Pure: the seat's most seen posts (impressions, the headline's metric) in the last `weeks` weeks. */
export function bestPosts(rows: readonly PostAudienceRow[], now: number, weeks = 12, n = 3): PostAudienceRow[] {
  const since = now - weeks * 7 * DAY_MS
  return rows.filter(p => p.published_at && Date.parse(p.published_at) >= since && Date.parse(p.published_at) <= now && typeof p.impressions === 'number')
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, n)
}

// YOUR BEST POSTS (2026-10-15): ranked by impressions, the same measure as the Brain's "Best post" tile (it
// was comments, so the two disagreed), the last 12 weeks, top 3.
export function BestPosts({ lane, own, now = Date.now() }: { lane: Lane; own: ReachRead | null; now?: number }) {
  const top = own?.kind === 'ready' ? bestPosts(own.rows, now) : []
  return (
    <section className="cb-sec" aria-label="Best posts" data-best-posts>
      <h2 className="cb-h"><b>{POSS[lane]} best posts</b><span>most seen in the last 12 weeks</span></h2>
      {own == null ? <Skeleton lines={3} title={false} label="Reading the posts" />
        : own.kind !== 'ready' ? <p className="cb-empty">{lane === 'swishdm' ? 'No posts tracked for SwishDM yet.' : 'Could not read the posts.'}</p>
          : top.length === 0 ? <p className="cb-empty">No post with impressions in the last 12 weeks.</p>
            : <ol className="cb-own">{top.map(p => <li key={p.activity_id}>
              <span>{p.published_at ? dayLabel(p.published_at.slice(0, 10)) : 'date not recorded'}</span>
              <b title={p.title ?? undefined}>{cutTitle(p.title) || 'Published post'}</b>
              <em>{(p.impressions ?? 0).toLocaleString('en-US')} impressions</em>
              {p.post_url && <a href={p.post_url} target="_blank" rel="noreferrer">Open ↗</a>}
            </li>)}</ol>}
    </section>
  )
}

/** The stored title is the post's first ~80 characters: end it on a whole word, never mid-word. */
function cutTitle(t: string | null | undefined): string {
  const s = (t ?? '').trim()
  if (s.length < 70 || /[.!?…]$/.test(s)) return s
  const whole = s.replace(/\s+\S*$/, '')
  return /[.!?]$/.test(whole) ? whole : `${whole}…`
}

export function RecentDecisions({ lane, verdicts }: { lane: Lane; verdicts: Map<string, SavedVerdict> }) {
  const [h, setH] = useState<DecisionHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const mine = useMemo(() => [...verdicts.values()].filter(v => v.client_id === lane).sort((a, b) => b.decided_at.localeCompare(a.decided_at)).slice(0, 10), [verdicts, lane])
  const n = mine.length
  useEffect(() => {
    let live = true
    // A seat switch clears the last seat's history (SwishDM showed Ivan's "older decisions" under its own name).
    setErr(null); setH(null)
    fetchDecisionHistory(lane).then(x => { if (live) setH(x) }).catch(e => { if (live) setErr(e instanceof Error ? e.message : 'read failed') })
    return () => { live = false }
  }, [lane, n])
  const rulings = h?.rulings ?? []
  return (
    <section className="cb-sec" aria-label="Your recent decisions">
      <h2 className="cb-h"><b>Your recent decisions</b><span>what you kept or dropped, why, and what happened next</span></h2>
      {/* the history read does not know SwishDM yet ("unknown client"): no history, not a failure */}
      {err && lane !== 'swishdm' && <p className="cb-note cb-bad" role="alert">Could not read the earlier decisions. {err}</p>}
      {mine.length === 0 ? <p className="cb-empty">No decisions saved for {LANE_NAME[lane]} yet. Approve or Drop a draft in Review and it shows here.</p>
        : <ol className="cb-dec">{mine.map(v => {
          const link = h?.links.get(v.draft_id)
          const body = (v as SavedVerdict & { body_snapshot?: string | null }).body_snapshot ?? v.body_after ?? ''
          const t = body.split('\n').map(s => s.trim()).find(Boolean) ?? 'Draft'
          const why = [...v.reasons.map(reasonLabel), v.note].filter(Boolean).join(' · ')
          const after = v.verdict === 'drop' ? (v.draft_action === 'archived' ? 'archived' : 'deleted')
            : link?.published_at ? `published ${dayLabel(link.published_at.slice(0, 10))}${link.impressions != null ? ` · ${link.impressions.toLocaleString('en-US')} impressions` : ''}${link.comments != null ? ` · ${link.comments} comments` : ''}`
              : link?.status ? 'not posted yet' : 'no result yet'
          return <li key={v.verdict_id} data-verdict-id={v.verdict_id}>
            <span>{dayLabel(v.decided_at.slice(0, 10))}</span>
            <b>{t}</b>
            <em><i className={`cb-v cb-v-${v.verdict}`}>{VERDICT_WORD[v.verdict] ?? v.verdict}</i>{why ? ` · ${why}` : v.verdict === 'drop' ? ' · no reason given' : ''} → {after}{link?.post_url ? <> · <a href={link.post_url} target="_blank" rel="noreferrer">post ↗</a></> : null}</em>
          </li>
        })}</ol>}
      {rulings.length > 0 && <details className="cb-rul">
        <summary>Older decisions on weekly plans ({rulings.length})</summary>
        <ol>{rulings.map((x, i) => <li key={`${x.target_id}-${i}`}><span>{dayLabel(x.at.slice(0, 10))} · {x.action.replace(/_/g, ' ')}</span><p>{x.reason}</p></li>)}</ol>
      </details>}
    </section>
  )
}
