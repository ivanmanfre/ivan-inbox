/* ==========================================================================
   src/d/home/Tiles.tsx — the five Home tiles for one seat. One big number and
   a 1-3 word label each; every tile opens the page that acts on it.
   "…" while reading, a quiet "?" + Retry when a read failed. Never a guess.
   ========================================================================== */
import type { ReactNode } from 'react'
import { dHash } from '../route'
import { SEAT_NAME, type Seat } from '../seats'
import { invitesOf, limitRead, readyRead, when, type Read } from './model'
import type { HomeData } from './reads'

type P = { seat: Seat; h: HomeData }

function Tile<T>({ id, seat, href, label, r, big, tone, retry, children, after }: {
  id: string; seat: Seat; href: string; label: string; r: Read<T>; big: (v: T) => ReactNode
  tone?: string; retry: () => void; children?: ReactNode; after?: ReactNode
}) {
  return (
    <div className={`hm-tile${tone ? ' ' + tone : ''}`} data-tile={id} data-seat={seat}>
      <a className="hm-hit" href={href} aria-label={`${SEAT_NAME[seat]} ${label}`}>
        <span className="hm-l">{label}</span>
        {'wait' in r ? <em className="hm-n hm-q" aria-label="Reading">…</em>
          : 'fail' in r ? <em className="hm-n hm-q" title={r.fail}>?</em>
          : big(r.v)}
        {'v' in r && children}
      </a>
      {'fail' in r && <button type="button" className="hm-retry" data-verb="retry" onClick={retry}>Retry</button>}
      {'v' in r && after}
    </div>
  )
}

const num = (v: number | null, cls = '') => <em className={`hm-n${v == null ? ' hm-q' : v === 0 ? ' hm-z' : ''}${cls}`}>{v == null ? '?' : v.toLocaleString('en-US')}</em>

export function NextWeek({ seat, h }: P) {
  const r = h.content[seat]
  return (
    <Tile id="week" seat={seat} href={dHash('content', null, { lane: seat })} label="Next week" r={r} retry={h.retry.content}
      tone={'v' in r && r.v.below ? 'hm-warn' : undefined}
      big={w => <span className="hm-row">{num(w.n, w.below ? ' hm-w' : '')}{w.below && <b className="hm-flag">Below 3</b>}</span>}>
      {'v' in r && (
        <span className="hm-strip" aria-label={r.v.days.map(d => `${d.dow} ${d.posts}`).join(', ')}>
          {r.v.days.map(d => (
            <i key={d.key} className={d.posts ? 'hm-on' : undefined} title={`${d.dow} ${d.n}: ${d.posts} ${d.posts === 1 ? 'post' : 'posts'}`}>
              {d.posts > 1 ? d.posts : d.dow.slice(0, 1)}
            </i>
          ))}
        </span>
      )}
    </Tile>
  )
}

export function Drafts({ seat, h }: P) {
  const r = h.drafts[seat]
  return <Tile id="drafts" seat={seat} href={dHash('dms', null, { seat })} label="Drafts" r={r} retry={h.retry.drafts}
    big={v => num(v, v > 0 ? ' hm-on' : '')} />
}

export function Invites({ seat, h }: P) {
  const r = invitesOf(h.lanes, seat, h.now)
  return <Tile id="invites" seat={seat} href={dHash('lanes', null, { seat })} label="Invites today" r={r} retry={h.retry.lanes}
    big={v => num(v)} />
}

export function Ready({ seat, h }: P) {
  const r = readyRead(h.lanes, seat)
  const lanes = 'v' in r ? r.v.lanes.filter(l => l.n > 0) : []
  return (
    <Tile id="ready" seat={seat} href={dHash('lanes', null, { seat })} label="Ready" r={r} retry={h.retry.lanes}
      big={v => num(v.total)}
      after={lanes.length > 0 && (
        <ul className="hm-lanes">
          {lanes.map(l => (
            <li key={l.lane} className={l.off ? 'hm-off' : undefined} title={l.off ?? undefined}>
              <a href={l.campaignId ? dHash('lanes', null, { sheet: 'campaign', c: l.campaignId }) : dHash('lanes', null, { seat })}>
                <span>{l.label}</span><b>{l.capped ? '≥' : ''}{l.n}</b>
              </a>
            </li>
          ))}
        </ul>
      )} />
  )
}

export function Limit({ seat, h }: P) {
  const r = limitRead(h.lanes, seat, h.now)
  return (
    <Tile id="limit" seat={seat} href={dHash('lanes', null, { sheet: 'control', for: seat })} label="Rate limit" r={r} retry={h.retry.lanes}
      big={v => (
        <span className={`hm-word${v.limited ? ' hm-w' : ''}`}>{v.limited ? 'Limited' : 'Clear'}{v.limited && v.resumes && <small><span className="hm-dot"> · </span>resumes {when(v.resumes, h.now)}</small>}</span>
      )}>
      {'v' in r && r.v.lastTry && <span className={`hm-sub${r.v.refused ? ' hm-wt' : ''}`}>last try {when(r.v.lastTry, h.now)}</span>}
    </Tile>
  )
}
