import { useCallback, useEffect, useState } from 'react'
import { displayTitle, fetchPlan, formatWord, pictureWord, planDay, postStatus, weekLabel, type PlanEvidence, type PlanPost, type PlanRead, type PlanSlot } from '../../lib/contentPlan'
import { fetchRankedIdeas } from '../../lib/rankedIdeas'
import { decideClientIdea } from '../../lib/clientIdeas'
import { Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { dHash } from '../route'
import { LANES, LANE_NAME, type Lane } from './model'
import type { IdeaItem } from './ideaModel'
import './plan.css'

// Plan (Ivan ruling 2026-10-11): the next full week stays planned for every account; when it is full the planner
// plans the week after. One card per slot with its topic, why now, the evidence, format, picture and status.
// Client slots the planner adds are proposals: nothing here dates, moves or publishes a post.
const timely = (it: IdeaItem) => it.src === 'X' || ['x_viral', 'x_search'].includes(it.ivan?.source ?? '') || /radar|viral|news/i.test(it.client?.source_label ?? '')

function Evidence({ ev }: { ev: PlanEvidence[] }) {
  if (!ev.length) return <p className="cn-plan-ev cn-plan-ev-none">No source recorded on this post.</p>
  return <ul className="cn-plan-ev">{ev.map((e, i) => <li key={i} data-ev={e.type}>{e.label}{e.quote ? <q>{e.quote}</q> : null}</li>)}</ul>
}

function PostCard({ p, lane }: { p: PlanPost; lane: Lane }) {
  const href = p.draft_id ? dHash('content', 'calendar', { draft: p.draft_id, lane }) : null
  const body = <>
    <span className="cn-plan-day">{planDay(p.day)}</span>
    <b className="cn-plan-topic">{displayTitle(p.title)}</b>
    <Evidence ev={p.evidence} />
    <span className="cn-plan-meta">{formatWord(p.format)} · {p.picture} · <em>{postStatus(lane, p.status)}</em></span>
  </>
  return <li className="cn-plan-card" data-kind="post">{href ? <a href={href}>{body}</a> : <div>{body}</div>}</li>
}

function SlotCard({ s, lane, onChanged }: { s: PlanSlot; lane: Lane; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const generate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await decideClientIdea(s.idea_ref, 'approved')
      toast.show({ message: 'Draft requested. It will appear in Review.', sub: 'Nothing is scheduled or sent.' })
      onChanged()
    } catch (e) { toast.show({ message: e instanceof Error ? e.message : 'The draft was not requested.', tone: 'failed' }) }
    finally { setBusy(false) }
  }
  const draftHref = s.draft_id ? dHash('content', 'now', { draft: s.draft_id, lane }) : null
  return <li className={`cn-plan-card${s.proposal ? ' cn-plan-proposal' : ''}`} data-kind="planned">
    <div>
      <span className="cn-plan-day">{s.day ? planDay(s.day) : 'No free weekday'} · {s.proposal ? 'Proposal · ' : ''}{s.status_label}</span>
      <b className="cn-plan-topic">{displayTitle(s.topic)}</b>
      <p className="cn-plan-why"><small>Why now</small>{s.why_now}</p>
      <Evidence ev={s.evidence} />
      <span className="cn-plan-meta">{formatWord(s.format)} · {pictureWord(s.picture)}</span>
    </div>
    <div className="cn-plan-acts">
      {draftHref && <a href={draftHref}>Open draft</a>}
      {s.proposal && s.idea_source === 'client_ideas' && s.status === 'proposal' &&
        <button type="button" data-verb="plan-generate" disabled={busy} onClick={() => void generate()}>{busy ? 'Working…' : 'Generate draft'}</button>}
    </div>
  </li>
}

export function Plan({ lane, setLane }: { lane: Lane; setLane: (l: Lane) => void }) {
  const [read, setRead] = useState<PlanRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pool, setPool] = useState<IdeaItem[] | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let live = true
    const c = new AbortController()
    setError(null)
    setRead(r => (r?.account === lane ? r : null))
    void fetchPlan(lane, c.signal).then(r => { if (live) setRead(r) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'The plan could not load.') })
    setPool(null)
    void fetchRankedIdeas(lane, c.signal).then(rows => { if (live) setPool(rows.filter(r => !r.outlier)) }).catch(() => { if (live) setPool([]) })
    return () => { live = false; c.abort() }
  }, [lane, tick])
  const r = read?.account === lane ? read : null
  const upcoming = r ? r.weeks.filter(w => w.which !== 'this') : []
  const thisWeek = r?.weeks.find(w => w.which === 'this')
  const timelyIdeas = (pool ?? []).filter(timely)
  const openIdeas = (pool ?? []).filter(i => !timely(i))
  return <div className="cn-plan">
    <div className="cn-client-switch" role="tablist" aria-label="Client">
      {LANES.map(l => <button key={l} type="button" role="tab" aria-selected={lane === l} className={lane === l ? 'cn-on' : ''} data-verb="lane" onClick={() => setLane(l)}>{LANE_NAME[l]}</button>)}
    </div>
    {error ? <Failed what="the plan" detail={error} onRetry={refresh} /> : !r ? <Skeleton lines={6} label="Reading the plan" /> : <>
      <p className="cn-plan-state">{r.state === 'two_weeks_planned'
        ? 'Next 2 weeks planned.'
        : `Planning the week from ${planDay(r.target_week!).replace(/^\w+ /, '')}: ${r.open} open of ${r.target}.`}
        <small> Cadence: {r.cadence_source}.{r.proposals_only ? ' New topics here are proposals until you generate them.' : r.auto_generate ? ' New topics get their draft written automatically. It waits in Review for approval.' : ''}</small></p>
      {r.warnings.length > 0 && <ul className="cn-plan-warn" aria-label="Warnings">{r.warnings.map((w, i) => <li key={i} data-code={w.code}>{w.text}</li>)}</ul>}
      {upcoming.map(w => <section key={w.start} className="cn-plan-week" aria-label={weekLabel(w)}>
        <h2>{weekLabel(w)} <span>{w.filled} of {w.target}{w.planned.length > 0 ? ` · ${w.dated ?? w.posts.length} dated` : ''}</span></h2>
        <ul>{w.posts.map((p, i) => <PostCard key={p.draft_id ?? p.queue_id ?? i} p={p} lane={lane} />)}
          {w.planned.map(s => <SlotCard key={s.slot_id} s={s} lane={lane} onChanged={refresh} />)}
          {w.open > 0 && Array.from({ length: w.open }, (_, i) => <li key={`open${i}`} className="cn-plan-card cn-plan-open"><div><span className="cn-plan-day">Open slot</span><b className="cn-plan-topic">Not planned yet</b></div></li>)}
        </ul>
        {w.planned.length > 0 && <p className="cn-plan-note">Planned posts show the first free weekday of their week. The real date is set when the post is scheduled.</p>}
      </section>)}
      {thisWeek && <details className="cn-plan-fold"><summary>This week · {thisWeek.posts.length} post{thisWeek.posts.length === 1 ? '' : 's'}</summary>
        <ul>{thisWeek.posts.map((p, i) => <PostCard key={p.draft_id ?? p.queue_id ?? i} p={p} lane={lane} />)}</ul>
        <p className="cn-plan-note">Timely or viral topics are never planned ahead. Once you approve one, it takes the next slot this week and the post it replaces moves to the next open day.</p>
      </details>}
      <details className="cn-plan-fold"><summary>Open idea pool · {pool === null ? '…' : openIdeas.length}</summary>
        {pool === null ? <Skeleton lines={3} title={false} label="Reading ideas" /> : <ul className="cn-plan-pool">
          {openIdeas.slice(0, 10).map(i => <li key={i.id}><b>{displayTitle(i.title)}</b><small>{i.proof || i.src}</small></li>)}
          {timelyIdeas.length > 0 && <li className="cn-plan-timely"><b>{timelyIdeas.length} timely idea{timelyIdeas.length === 1 ? '' : 's'}</b><small>Not planned ahead: they go into this week when you approve them.</small></li>}
        </ul>}
        <a className="cn-plan-link" href={dHash('content', 'ideas', { lane })}>All ideas →</a>
      </details>
      <details className="cn-plan-fold"><summary>Topics already done · {r.done.length} in 8 weeks</summary>
        <ul className="cn-plan-pool">{r.done.map((d, i) => <li key={i}><b>{displayTitle(d.title)}</b><small>{planDay(d.day)} · {formatWord(d.format)}</small></li>)}</ul>
      </details>
      {r.last_run && <p className="cn-plan-note">Planner last looked {new Date(r.last_run.ran_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })} Warsaw.</p>}
    </>}
  </div>
}
