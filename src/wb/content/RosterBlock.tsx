/* ==========================================================================
   AGAINST THE ROSTER: rendered inside "Who the posts reached", after Winners.

   Own rows come from the reach read already on screen; the roster read is its
   own RPC. Failure here never hides the reach block: the section shows Failed
   with a retry on its own. All arithmetic lives in lib/roster.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { Failed } from './parts'
import { dayLabel, type PostAudienceRow } from '../../lib/reach'
import { ROSTER_FLOOR, ROSTER_ROLE_LABEL, fetchRosterPosts, liftLine, rosterAngles, rosterCompare, rosterTop, type RosterAccount, type RosterRead } from '../../lib/roster'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import { num } from '../../lib/benchmark'
import './reach.css'

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
const med = (v: number | null) => (v === null ? '–' : num(v))

function AccountRow({ a, you = false }: { a: RosterAccount; you?: boolean }) {
  return (
    <li className={`a-reach-roster-r${you ? ' a-reach-roster-you' : ''}`}>
      <span className="a-reach-roster-l">{a.who}</span>
      <span className="a-mono">{num(a.posts)}</span>
      <span className="a-mono">{med(a.comments)}</span>
      <span className="a-mono">{med(a.reposts)}</span>
    </li>
  )
}

export function RosterView({ read, own, lane, now, onRetry }: { read: RosterRead | null; own: PostAudienceRow[]; lane: ContentLane; now: number; onRetry?: () => void }) {
  const thisYear = new Date(now).getUTCFullYear()
  const youLabel = LANE_LABEL[lane].split(' ')[0]
  const c = useMemo(() => (read?.kind === 'ready' ? rosterCompare(own, read.posts, read.roster, youLabel, now) : null), [read, own, youLabel, now])
  const top = useMemo(() => (read?.kind === 'ready' ? rosterTop(read.posts, now) : []), [read, now])
  const angles = useMemo(() => (read?.kind === 'ready' ? rosterAngles(read.posts, now) : []), [read, now])
  if (!read) return <div className="a-reach-sec" data-reach-roster="loading"><div className="a-eyebrow">Against the roster</div><div className="a-ct-sub">Reading the roster…</div></div>
  if (read.kind !== 'ready') {
    return <div className="a-reach-sec" data-reach-roster={read.kind}><div className="a-eyebrow">Against the roster</div><Failed what="The roster" message={read.message} onRetry={onRetry} /></div>
  }
  if (!c) return null
  const others = Object.entries(c.otherRoles).map(([r, n]) => `${plural(n, 'post')} from ${ROSTER_ROLE_LABEL[r] ?? r}s`).join(', ')
  return (
    <div className="a-reach-sec" data-reach-roster="ready" data-roster-competitors={c.competitors.length}>
      <div className="a-eyebrow">Against the roster · last {c.weeks} weeks</div>
      <div className="a-reach-foot">
        Comments and reposts per post, median, since {dayLabel(c.from, thisYear)}. Direct competitors from this lane's watch roster with at least {ROSTER_FLOOR} posts in the window. LinkedIn shows reach only to the author, so nothing here compares reach.
      </div>
      <ul className="a-reach-roster">
        <li className="a-reach-roster-r a-reach-roster-h"><span>Account</span><span>Posts</span><span>Comments</span><span>Reposts</span></li>
        <AccountRow a={c.you} you />
        {c.competitors.map(a => <AccountRow key={a.who} a={a} />)}
      </ul>
      {c.competitors.length === 0 ? <div className="a-dim-2 a-reach-share-none">No direct competitor on the roster has {ROSTER_FLOOR} posts in these weeks.</div> : null}
      <div className="a-reach-foot">
        {c.you.comments === null ? `${youLabel}: ${plural(c.you.posts, 'post')} in the window, under the ${ROSTER_FLOOR}-post floor, so no median. ` : ''}
        {c.underFloor.length ? `Under the floor: ${c.underFloor.map(u => `${u.who} (${u.posts})`).join(', ')}. ` : ''}
        {c.silent.length ? `No post collected in the window: ${c.silent.join(', ')}. ` : ''}
        {others ? `Also on the roster: ${others}, not in the table.` : ''}
      </div>

      <div className="a-eyebrow">Most commented on the roster</div>
      {top.length ? (
        <ul className="a-reach-posts a-reach-winners">
          {top.map((p, i) => (
            <li className="a-reach-post" key={`${p.url ?? p.who}-${i}`}>
              {p.url
                ? <a className="a-reach-post-t" href={p.url} target="_blank" rel="noopener noreferrer">{p.text || `${p.who}, post text not collected`}</a>
                : <span className="a-reach-post-t">{p.text || `${p.who}, post text not collected`}</span>}
              <span className="a-reach-post-m">
                <span>{p.who} · {ROSTER_ROLE_LABEL[p.role] ?? p.role}</span>
                <span className="a-mono">{p.at ? dayLabel(p.at.slice(0, 10), thisYear) : 'Date unknown'}</span>
                <span className="a-mono">{plural(p.comments ?? 0, 'comment')}</span>
                {p.reposts ? <span className="a-mono">{plural(p.reposts, 'repost')}</span> : null}
              </span>
              <span className="a-reach-post-d">{liftLine(p) ?? `Under ${ROSTER_FLOOR} posts from this author in the window, so no lift.`}</span>
            </li>
          ))}
        </ul>
      ) : <div className="a-dim-2 a-reach-share-none">No commented competitor or buyer-voice post collected in these weeks.</div>}

      <div className="a-eyebrow">Angles not taken</div>
      {angles.length ? (
        <>
          <div className="a-reach-foot">Analysed on the competitor's post; none of these is marked as used. Most commented first.</div>
          <ul className="a-reach-posts a-reach-winners" data-roster-angles={angles.length}>
            {angles.map((a, i) => (
              <li className="a-reach-post" key={`${a.url ?? a.who}-${i}`}>
                {a.url
                  ? <a className="a-reach-post-t" href={a.url} target="_blank" rel="noopener noreferrer">{a.topic ?? `${a.who}'s post`}</a>
                  : <span className="a-reach-post-t">{a.topic ?? `${a.who}'s post`}</span>}
                <span className="a-reach-post-m">
                  <span>{a.who}</span>
                  <span className="a-mono">{a.at ? dayLabel(a.at.slice(0, 10), thisYear) : 'Date unknown'}</span>
                  <span className="a-mono">{plural(a.comments, 'comment')}</span>
                </span>
                <span className="a-reach-post-d">{a.angle}</span>
              </li>
            ))}
          </ul>
        </>
      ) : <div className="a-dim-2 a-reach-share-none">No unused angle on a roster post in these weeks.</div>}
    </div>
  )
}

export function RosterSection({ lane, own, now }: { lane: ContentLane; own: PostAudienceRow[]; now: number }) {
  const [read, setRead] = useState<{ lane: ContentLane; read: RosterRead } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRead(null)
    fetchRosterPosts(lane)
      .then(r => { if (live) setRead({ lane, read: r }) })
      .catch(e => { if (live) setRead({ lane, read: { kind: 'failed', message: e instanceof Error ? e.message : 'The roster could not be read.' } }) })
    return () => { live = false }
  }, [lane, tick])
  const current = read?.lane === lane ? read.read : null
  return <RosterView read={current} own={own} lane={lane} now={now} onRetry={() => setTick(t => t + 1)} />
}
