import { useCallback, useEffect, useState } from 'react'
import { fetchContentEvidenceViews, type ContentEvidenceViews, type ContentEvidenceChoice } from '../../lib/contentEvidence'
import { fetchPostAudience, reachWinners, type ReachRead } from '../../lib/reach'
import { dHash } from '../route'
import { Failed, Skeleton } from '../ui/states'
import { dayLabel, LANES, LANE_NAME, type Lane } from './model'

export function Results({ lane, setLane }: { lane: Lane; setLane: (l: Lane) => void }) {
  const [own, setOwn] = useState<ReachRead | null>(null)
  const [evidence, setEvidence] = useState<ContentEvidenceViews | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let live = true
    setOwn(null); setEvidence(null); setEvidenceError(null)
    void fetchPostAudience(lane).then(r => { if (live) setOwn(r) }).catch(e => { if (live) setOwn({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not read the posts.' }) })
    void fetchContentEvidenceViews(lane).then(r => { if (live) setEvidence(r) }).catch(e => { if (live) setEvidenceError(e instanceof Error ? e.message : 'Could not read the weekly picks.') })
    return () => { live = false }
  }, [lane, tick])
  return <div className="cn-results">
    <div className="cn-wk2-chips" role="tablist" aria-label="Client">{LANES.map(l => <button key={l} type="button" role="tab" aria-selected={lane === l} onClick={() => setLane(l)}>{LANE_NAME[l]}</button>)}</div>
    <ResultsBody own={own} evidence={evidence} evidenceError={evidenceError} now={Date.now()} onRetry={retry} />
    <a className="cn-quiet-link" href={dHash('content', 'results', { lane, view: 'analytics' })}>Reach, audience and all analytics →</a>
  </div>
}

const pending = new Set(['candidate', 'needs_material', 'ready_for_review', 'approved', 'awaiting_publication', 'measuring'])
function outcome(c: ContentEvidenceChoice): string {
  if (pending.has(c.status)) return c.status === 'measuring' ? 'Still measuring' : c.status === 'needs_material' ? 'Needs material' : 'Waiting to publish'
  return c.outcome ? `${c.outcome.metric_label}: ${c.outcome.observed_value == null ? 'not recorded' : c.outcome.observed_value.toLocaleString('en-US')} · ${c.outcome.comparison_label}` : 'No result recorded yet'
}

export function ResultsBody({ own, evidence, evidenceError, now, onRetry }: { own: ReachRead | null; evidence: ContentEvidenceViews | null; evidenceError?: string | null; now: number; onRetry: () => void }) {
  const winners = own?.kind === 'ready' ? reachWinners(own.rows, now) : null
  const choices = evidence?.results.choices ?? []
  const picks = evidence?.thisWeek.candidates ?? []
  const measured = choices.filter(c => !pending.has(c.status) && c.outcome)
  return <>
    <p className="cn-results-verdict">{evidenceError || (own && own.kind !== 'ready') || evidence?.results.state === 'failed' || evidence?.thisWeek.state === 'failed' ? 'Some results could not be read.' : !own || !evidence ? 'Reading what worked…' : `${winners?.posts.length ?? 0} ${winners?.mode === 'flagged' ? `winning post${winners.posts.length === 1 ? '' : 's'}` : 'posts with the most comments'} · ${measured.length} brain pick${measured.length === 1 ? '' : 's'} measured.`}</p>
    <section className="cn-result-section" aria-label="Your own posts"><h2>{winners?.mode === 'flagged' ? 'Winning posts' : 'Your strongest posts'}</h2>
      {!own ? <Skeleton lines={3} label="Reading your posts" /> : own.kind !== 'ready' ? <Failed what="your post results" detail={own.message} onRetry={onRetry} /> : !winners?.posts.length ? <p className="cn-wk2-empty">No winning post recorded yet.</p> : winners.posts.slice(0, 5).map(p => <article className="cn-result-card" key={p.activity_id}>
        <small>{p.published_at ? dayLabel(p.published_at.slice(0, 10)) : 'Date not recorded'}{winners.mode === 'candidates' ? ' · Most comments' : ''}</small>
        <h3>{p.title || 'Published post'}</h3>
        <p>{[p.impressions != null ? `${p.impressions.toLocaleString('en-US')} impressions` : null, p.members_reached != null ? `${p.members_reached.toLocaleString('en-US')} people reached` : null, p.comments != null ? `${p.comments.toLocaleString('en-US')} comments` : null].filter(Boolean).join(' · ') || 'No metrics recorded yet'}</p>
        {p.post_url && <a href={p.post_url} target="_blank" rel="noreferrer">Open post ↗</a>}
      </article>)}
    </section>
    <section className="cn-result-section" aria-label="Content brain weekly picks"><h2>Content brain · weekly picks</h2>
      {evidenceError ? <Failed what="the weekly picks" detail={evidenceError} onRetry={onRetry} /> : !evidence ? <Skeleton lines={3} label="Reading weekly picks" /> : evidence.results.state === 'failed' || evidence.thisWeek.state === 'failed' ? <Failed what="the weekly picks" detail={evidence.results.message || evidence.thisWeek.message} onRetry={onRetry} /> : !choices.length && !picks.length ? <p className="cn-wk2-empty">No weekly pick recorded yet.</p> : <>
        {choices.map(c => <article className="cn-result-card" key={c.id}><small>{c.published_at ? `Published ${dayLabel(c.published_at.slice(0, 10))}` : 'Weekly pick'}</small><h3>{c.topic}</h3><p>{outcome(c)}</p>{c.incomplete_measurement && <small>Measurement is incomplete.</small>}</article>)}
        {picks.filter(p => !choices.some(c => c.id === p.id || c.topic === p.topic)).map(p => <article className="cn-result-card" key={p.id}><small>Weekly source pick</small><h3>{p.topic}</h3>{p.evidence_sentence && <p>{p.evidence_sentence}</p>}<p className="cn-result-pending">No result recorded yet</p>{p.source_url && <a href={p.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}</article>)}
      </>}
    </section>
  </>
}
