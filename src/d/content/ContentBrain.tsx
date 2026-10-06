import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDecisionHistory, fetchDraftSources, learnedFrom, sourceOf, type DecisionHistory, type DraftSourceRead, type SourceView } from '../../lib/brainPage'
import type { ContentDraft } from '../../lib/content'
import { readEditorialDirection, type EditorialDirectionRead } from '../../lib/editorialDirection'
import type { EditorialClient } from '../../lib/editorialTypes'
import { fetchOutliers, putOutlierOnBoard, type OutlierRow, type OutliersPayload } from '../../lib/outliers'
import { fetchPostAudience, reachWinners, type ReachRead } from '../../lib/reach'
import { supabase } from '../../lib/supabase'
import { readSwr, writeSwr } from '../../lib/swr'
import { BRAIN_DROP_REASONS, reasonLabel, type SavedVerdict } from '../../lib/verdicts'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { dHash } from '../route'
import { useFrameMaybe } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import { Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { LANES, LANE_NAME, OWNER, age, dayLabel, titleOf, type Lane } from './model'
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
// page carries a reason. Below: next post ideas from the outlier catalogue and your own best posts, then your
// recent decisions. Old planning views stay one link away; nothing was deleted.

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

      <NextIdeas lane={lane} />
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

function useSources(ids: string[]) {
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

function SourceCol({ src, loading }: { src: SourceView; loading: boolean }) {
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

function DirectionLine({ lane }: { lane: Lane }) {
  const [d, setD] = useState<EditorialDirectionRead | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setD(null); setErr(null)
    readEditorialDirection(supabase as unknown as EditorialClient, lane)
      .then(x => { if (live) setD(x) })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Direction could not be read.') })
    return () => { live = false }
  }, [lane, tick])
  const p = (d?.direction?.weekly_policy ?? null) as Record<string, unknown> | null
  const total = typeof p?.weekly_total === 'number' ? p.weekly_total : null
  const alloc = p && typeof p.allocation === 'object' ? (p.allocation as { values?: Record<string, number> }).values ?? null : null
  const aim = typeof p?.objective === 'string' ? p.objective : null
  const line = !d ? (err ? 'Direction could not be read.' : 'Reading direction…')
    : d.status !== 'active' ? 'No adopted direction.'
      : [aim, total != null ? `${total} posts a week${alloc ? ` (${Object.entries(alloc).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}` : null, d.updated_at ? `adopted ${d.updated_at.slice(0, 10)}` : null].filter(Boolean).join(' · ')
  return (
    <div className="cb-dir">
      <span className="cb-lbl">Direction</span>
      <p>{line}</p>
      <button type="button" className="cb-link" data-verb="brain-direction-edit" onClick={() => setEdit(true)}>Edit</button>
      <Sheet open={edit} onClose={() => { setEdit(false); setTick(t => t + 1) }} title={`${LANE_NAME[lane]} · direction`} sub="Weekly total, aim and the full adopted direction" className="cb-dir-sheet">
        {edit && <div className="cn-legacy app wb ds-shell wb-work" data-wblane={lane}><ConfirmProvider><Suspense fallback={<Skeleton lines={4} label="Reading the direction" />}><ClientDirectionPanel lane={lane} /></Suspense></ConfirmProvider></div>}
      </Sheet>
    </div>
  )
}

function NextIdeas({ lane }: { lane: Lane }) {
  const toast = useToast()
  const seed = useMemo(() => readSwr<OutliersPayload>(`outliers:${lane}`), [lane])
  const [rows, setRows] = useState<OutlierRow[] | null>(() => seed?.payload?.rows ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [own, setOwn] = useState<ReachRead | null>(null)
  const [used, setUsed] = useState<Record<string, string>>({})
  // The outlier catalogue and own-post reads start only when this section comes near the screen.
  const box = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!near) return
    let live = true
    setRows(seed?.payload?.rows ?? null); setErr(null); setOwn(null)
    void fetchOutliers(lane).then(r => {
      if (!live) return
      if (r.kind === 'ready') { setRows(r.data.rows); writeSwr(`outliers:${lane}`, r.data) } else setErr(r.message)
    })
    void fetchPostAudience(lane).then(r => { if (live) setOwn(r) }).catch(e => { if (live) setOwn({ kind: 'failed', message: e instanceof Error ? e.message : 'read failed' }) })
    return () => { live = false }
  }, [lane, seed, near])
  // Newest week first, then the biggest lift over the author's usual; ones already saved as ideas leave.
  const ideas = useMemo(() => (rows ?? []).filter(r => !r.idea && (r.text ?? '').trim().length > 40)
    .sort((a, b) => b.week.localeCompare(a.week) || (Number(b.lift) || 0) - (Number(a.lift) || 0)).slice(0, 4), [rows])
  const winners = own?.kind === 'ready' ? reachWinners(own.rows).posts.slice(0, 3) : []
  const save = useCallback(async (r: OutlierRow) => {
    const k = `${r.platform}:${r.post_id}`
    setUsed(u => ({ ...u, [k]: 'busy' }))
    const res = await putOutlierOnBoard(lane, r.platform, r.post_id)
    if (res.ok) { setUsed(u => ({ ...u, [k]: 'done' })); toast.show({ message: lane === 'ivan' ? 'Saved to Ideas.' : `Saved to ${OWNER[lane]}’s Ideas.`, sub: 'Nothing is scheduled or sent.' }) }
    else setUsed(u => ({ ...u, [k]: res.message }))
  }, [lane, toast])
  return (
    <section ref={box} className="cb-sec" aria-label="Next post ideas">
      <h2 className="cb-h"><b>Next post ideas</b><span>industry posts that beat their author’s usual</span><a href={dHash('content', 'inputs', { lane })}>Browse all sources →</a></h2>
      {rows === null && !err ? <Skeleton lines={3} title={false} label="Reading outliers" />
        : err && !rows ? <Failed what="the outliers" detail={err} />
          : ideas.length === 0 ? <p className="cb-empty">No new industry outliers to suggest.</p>
            : <ol className="cb-ideas">{ideas.map(r => {
              const k = `${r.platform}:${r.post_id}`, st = used[k]
              return <li key={k} className="cb-idea">
                <div className="cb-lbl">{r.platform === 'x' ? 'X' : 'LinkedIn'}<span>{r.author}{r.published_at ? ` · ${dayLabel(r.published_at.slice(0, 10))}` : ''}</span></div>
                <p className="cb-res">{Number(r.lift).toFixed(1)}x their usual{r.likes != null ? ` · ${r.likes.toLocaleString('en-US')} likes` : ''}</p>
                <p className="cb-idea-t">{foldText((r.text ?? '').trim(), 3, 56).head}</p>
                <div className="cb-acts">
                  {r.url && <a className="cb-link" href={r.url} target="_blank" rel="noreferrer">Open ↗</a>}
                  <button type="button" className="cb-key" data-verb="brain-save-idea" disabled={st === 'busy' || st === 'done'} onClick={() => void save(r)}>{st === 'done' ? 'Saved to Ideas' : st === 'busy' ? 'Saving…' : 'Save idea'}</button>
                </div>
                {st && st !== 'busy' && st !== 'done' && <p className="cb-note cb-bad" role="alert">{st}</p>}
              </li>
            })}</ol>}
      {winners.length > 0 && <>
        <h3 className="cb-sub">Your best recent posts</h3>
        <ol className="cb-own">{winners.map(p => <li key={p.activity_id}>
          <span>{p.published_at ? dayLabel(p.published_at.slice(0, 10)) : 'date not recorded'}</span>
          <b>{p.title || 'Published post'}</b>
          <em>{[p.impressions != null ? `${p.impressions.toLocaleString('en-US')} impressions` : null, p.comments != null ? `${p.comments} comments` : null].filter(Boolean).join(' · ')}</em>
          {p.post_url && <a href={p.post_url} target="_blank" rel="noreferrer">Open ↗</a>}
        </li>)}</ol>
      </>}
    </section>
  )
}

function RecentDecisions({ lane, verdicts }: { lane: Lane; verdicts: Map<string, SavedVerdict> }) {
  const [h, setH] = useState<DecisionHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const mine = useMemo(() => [...verdicts.values()].filter(v => v.client_id === lane).sort((a, b) => b.decided_at.localeCompare(a.decided_at)).slice(0, 10), [verdicts, lane])
  const n = mine.length
  useEffect(() => {
    let live = true
    setErr(null)
    fetchDecisionHistory(lane).then(x => { if (live) setH(x) }).catch(e => { if (live) setErr(e instanceof Error ? e.message : 'read failed') })
    return () => { live = false }
  }, [lane, n])
  const rulings = h?.rulings ?? []
  return (
    <section className="cb-sec" aria-label="Your recent decisions">
      <h2 className="cb-h"><b>Your recent decisions</b><span>draft → what you did → why → what happened</span></h2>
      {err && <p className="cb-note cb-bad" role="alert">Could not read the history: {err}</p>}
      {mine.length === 0 ? <p className="cb-empty">No draft decisions saved for {LANE_NAME[lane]} yet. Use or Drop above records one.</p>
        : <ol className="cb-dec">{mine.map(v => {
          const link = h?.links.get(v.draft_id)
          const body = (v as SavedVerdict & { body_snapshot?: string | null }).body_snapshot ?? v.body_after ?? ''
          const t = body.split('\n').map(s => s.trim()).find(Boolean) ?? 'Draft'
          const why = [...v.reasons.map(reasonLabel), v.note].filter(Boolean).join(' · ')
          const after = v.verdict === 'drop' ? (v.draft_action === 'archived' ? 'archived' : 'deleted')
            : link?.published_at ? `published ${dayLabel(link.published_at.slice(0, 10))}${link.impressions != null ? ` · ${link.impressions.toLocaleString('en-US')} impressions` : ''}${link.comments != null ? ` · ${link.comments} comments` : ''}`
              : link?.status ? `${link.status}, not published yet` : 'no result linked yet'
          return <li key={v.verdict_id} data-verdict-id={v.verdict_id}>
            <span>{dayLabel(v.decided_at.slice(0, 10))}</span>
            <b>{t}</b>
            <em><i className={`cb-v cb-v-${v.verdict}`}>{VERDICT_WORD[v.verdict] ?? v.verdict}</i>{why ? ` · ${why}` : v.verdict === 'drop' ? ' · no reason given' : ''} → {after}{link?.post_url ? <> · <a href={link.post_url} target="_blank" rel="noreferrer">post ↗</a></> : null}</em>
          </li>
        })}</ol>}
      {rulings.length > 0 && <details className="cb-rul">
        <summary>Earlier brief decisions with reasons ({rulings.length}), recorded on the planning side</summary>
        <ol>{rulings.map((x, i) => <li key={`${x.target_id}-${i}`}><span>{x.at.slice(0, 10)} · {x.action}</span><p>{x.reason}</p></li>)}</ol>
      </details>}
    </section>
  )
}
