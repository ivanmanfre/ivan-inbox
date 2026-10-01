import { useEffect, useState } from 'react'
import { fetchRepeatEngagers } from '../../lib/brainAccount'
import { brainDate, safeBrainUrl, type RepeatEngagersData } from '../../lib/brainAccount'
import { Failed, Skeleton } from '../ui/states'
import type { Lane } from './model'
import './brain-account.css'

export function RepeatEngagersBody({ lane, data, error, onRetry }: { lane: Lane; data: RepeatEngagersData | null; error: string | null; onRetry: () => void }) {
  const checked = data?.client === lane ? data : null
  const mismatch = data && !checked ? 'The engager list returned a different client.' : null
  return <section className="cn-result-section cn-repeat-engagers" aria-label="Repeat engagers"><h2>Repeat engagers</h2>
    <p className="cn-brain-note">People with repeat engagement and their recorded relationship evidence. Read-only; nothing is contacted from this list.</p>
    {error || mismatch ? <Failed what="repeat engagers" detail={error || mismatch!} onRetry={onRetry} /> : !checked ? <Skeleton lines={3} label="Reading repeat engagers" /> : <>
      {checked.state === 'source_unavailable' ? <p className="cn-brain-notice">{checked.reason === 'verified_repeat_activation_source_supports_RISE_only' ? 'The verified repeat-engager source covers RISE. Current relationship evidence is unavailable for this client.' : checked.reason || 'Repeat engagement and current relationship evidence are unavailable for this client.'}</p> : !checked.rows.length ? <p className="cn-brain-empty">No eligible repeat engagers are recorded for this client.</p> : <ul className="cn-repeat-list">{checked.rows.map(person => {
        const url = safeBrainUrl(person.profileUrl)
        return <li key={person.personKey}><div className="cn-repeat-heading">{url ? <a href={url} target="_blank" rel="noreferrer">{person.name || 'Name not recorded'} ↗</a> : <b>{person.name || 'Name not recorded'}</b>}<small>{person.engagedPosts} posts · last seen {brainDate(person.lastSeen)}</small></div>
          <p>{person.confirmedReturn ? 'Came back on 2+ posts' : 'Repeat engagement; timing unconfirmed'}. {person.relationshipState === 'no_tracked_conversation' ? 'No conversation is recorded in this client’s CRM or message history.' : `Relationship evidence: ${person.relationshipState.replaceAll('_', ' ')}.`}</p><ul className="cn-repeat-posts">{person.posts.map(post => { const href = safeBrainUrl(post.url); return <li key={post.postId}>{href ? <a href={href} target="_blank" rel="noreferrer">{'Open engaged post'} ↗</a> : <span>{`Post ${post.postId}`}</span>}{post.publishedAt && <small>{brainDate(post.publishedAt)}</small>}</li> })}</ul>{!person.postsComplete && <small className="cn-brain-note">The stored post list is incomplete.</small>}
        </li>
      })}</ul>}
      <p className="cn-brain-note">This covers recorded conversations; activity outside these records may be missing.</p>
      {(checked.limitation || checked.rows.some(person => person.relationshipBasis)) && <details className="cn-brain-details"><summary>Relationship evidence</summary>{checked.limitation && <p>{checked.limitation}</p>}<ul>{[...new Set(checked.rows.map(person => person.relationshipBasis).filter(Boolean))].map(basis => <li key={basis}>{basis}</li>)}</ul></details>}<p className="cn-brain-note">Based on stored observations. Engagement can be recorded after it happened; this list does not establish why someone returned.</p>
    </>}
  </section>
}

export function RepeatEngagers({ lane }: { lane: Lane }) {
  const [data, setData] = useState<RepeatEngagersData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true; const controller = new AbortController()
    setData(null); setError(null); setMoreError(null); setBusy(false)
    void fetchRepeatEngagers(lane, null, controller.signal).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not read repeat engagers.') })
    return () => { live = false; controller.abort() }
  }, [lane, tick])
  const more = async () => {
    if (!data || data.client !== lane || !data.nextAfterPerson || busy) return
    setBusy(true); setMoreError(null)
    try {
      const page = await fetchRepeatEngagers(lane, data.nextAfterPerson)
      if (page.state !== 'ready') throw new Error(page.reason || 'The next page has no usable source evidence.')
      const keys = new Set(data.rows.map(r => r.personKey))
      if (page.rows.some(r => keys.has(r.personKey))) throw new Error('The next page repeated a person. Refresh the list.')
      setData(prev => !prev || prev.client !== page.client || prev.client !== lane ? prev : { ...page, rows: [...prev.rows, ...page.rows], returned: prev.returned + page.returned })
    } catch (e) { setMoreError(e instanceof Error ? e.message : 'Could not read more people.') }
    finally { setBusy(false) }
  }
  return <><RepeatEngagersBody lane={lane} data={data} error={error} onRetry={() => setTick(t => t + 1)} />{data?.client === lane && data.nextAfterPerson && <button type="button" className="cn-quiet-link" disabled={busy} onClick={() => void more()}>{busy ? 'Reading more people…' : 'Read more repeat engagers'}</button>}{moreError && <p role="alert" className="cn-brain-notice">{moreError}</p>}</>
}
