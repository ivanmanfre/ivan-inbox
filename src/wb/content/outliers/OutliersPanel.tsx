/* The Outliers view without the fetch: `read` in, markup out. Filters, the
   week, the sort and the pager are local state; the lane's read is fetched
   once by index.tsx and never refetched for a filter change. */
import { useMemo, useState } from 'react'
import { Segmented } from '../../../ds'
import {
  ALL_WEEKS, OUTLIER_RULE, TRAIT_RULE, dayText, filterRows, freshnessLines, groupByWeek, platformCounts,
  rowKey, weekLabel, weekOptions, weekPhrase,
  type OutlierRow, type OutlierSort, type OutliersRead, type PlatformFilter,
} from '../../../lib/outliers'
import { OutlierCard, type UseState } from './OutlierCard'

const PAGE = 24

export type OutliersPanelProps = {
  read: OutliersRead | null
  stateOf: (r: OutlierRow) => UseState
  /** The RPC's reason for a failed "Use this", if the last tap failed. */
  failOf?: (r: OutlierRow) => string | undefined
  onUse: (r: OutlierRow) => void
  onRetry: () => void
}

function Loading() {
  return (
    <div className="ol-cards" role="status" aria-label="Loading outliers" aria-busy="true">
      {[0, 1, 2].map(i => <div key={i} className="ol-skel" />)}
    </div>
  )
}

export function OutliersPanel({ read, stateOf, failOf, onUse, onRetry }: OutliersPanelProps) {
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [week, setWeek] = useState<string>(ALL_WEEKS)
  const [sort, setSort] = useState<OutlierSort>('lift')
  const [shown, setShown] = useState(PAGE)

  const data = read && read.kind === 'ready' ? read.data : null
  const rows = useMemo(() => (data ? filterRows(data.rows, platform, week) : []), [data, platform, week])
  const groups = useMemo(() => groupByWeek(rows, sort), [rows, sort])
  const weeks = useMemo(() => (data ? weekOptions(data, platform) : []), [data, platform])
  const counts = useMemo(() => platformCounts(data ? data.rows : [], week), [data, week])
  const wkMax = Math.max(1, ...weeks.map(w => w.n))
  const allN = data ? filterRows(data.rows, platform, ALL_WEEKS).length : 0
  const weekBtns = [{ week: ALL_WEEKS, label: 'All recent', n: allN }, ...weeks.map(w => ({ week: w.week, label: dayText(w.week), n: w.n }))]

  const pick = (fn: () => void) => { fn(); setShown(PAGE) }

  // Cut the grouped list at the pager without breaking a week header off its cards.
  let left = shown
  const paged: [string, OutlierRow[], number][] = []
  for (const [w, xs] of groups) {
    if (left <= 0) break
    paged.push([w, xs.slice(0, left), xs.length])
    left -= xs.length
  }
  const remaining = Math.max(0, rows.length - shown)

  let body
  if (!read) body = <Loading />
  else if (read.kind === 'failed') {
    body = (
      <div className="ol-fail" role="alert">
        <b>Outliers did not load</b>
        <span>{read.message}</span>
        <small>Nothing has loaded yet, so an empty screen here would not mean no outliers.</small>
        <button type="button" className="ol-use" data-state="off" onClick={onRetry}>Try again</button>
      </div>
    )
  } else if (!rows.length) {
    const noX = platform === 'x' && !read.data.studies.x
    const where = platform === 'all' ? '' : platform === 'x' ? 'X ' : 'LinkedIn '
    body = (
      <div className="ol-empty" role="status">
        <span>{noX ? 'No X outliers yet.' : week === ALL_WEEKS ? `No ${where}outliers in the current study.` : `No ${where}outliers in the ${weekPhrase(week)}.`}</span>
        <small>{noX ? 'X arrives with the first weekly run.' : 'Pick another week or platform.'}</small>
      </div>
    )
  } else {
    body = (
      <>
        {paged.map(([w, xs, total]) => (
          <section className="ol-grp" key={w}>
            <h3 className="ol-gh">{weekLabel(w)}<span>{total} {total === 1 ? 'post' : 'posts'}</span></h3>
            <ul className="ol-cards">
              {xs.map(r => <OutlierCard key={rowKey(r)} row={r} use={stateOf(r)} fail={failOf?.(r)} onUse={() => onUse(r)} />)}
            </ul>
          </section>
        ))}
        {remaining > 0 ? (
          <button type="button" className="ol-pager" onClick={() => setShown(s => s + PAGE)}>
            Show {Math.min(PAGE, remaining)} more <span>{remaining} left</span>
          </button>
        ) : null}
      </>
    )
  }

  const span = week === ALL_WEEKS ? `across ${weeks.length} recent ${weeks.length === 1 ? 'week' : 'weeks'}` : weekPhrase(week)
  return (
    <div className="ol" data-outliers-view>
      <div className="ol-in">
      <aside className="ol-side">
        <div className="ol-fig">
          <b className="ol-n">{data ? rows.length : '-'}</b>
          <p className="ol-u">{data ? `posts at 3x or more their author's own median, ${span}` : "posts at 3x or more their author's own median"}</p>
        </div>
        {data ? (
          <div className="ol-fresh">
            {freshnessLines(data).map(f => <p key={f.platform}><b>{f.platform}</b> {f.line}</p>)}
          </div>
        ) : null}
        {data && weeks.length ? (
          <>
            <ul className="ol-weeks" aria-label="Week">
              {weekBtns.map(w => (
                <li key={w.week}>
                  <button type="button" className="ol-wk" aria-pressed={week === w.week} onClick={() => pick(() => setWeek(w.week))}>
                    <span>{w.label}</span>
                    <span className="ol-wk-bar" aria-hidden="true"><i style={{ width: `${w.week === ALL_WEEKS ? 100 : Math.round((w.n / wkMax) * 100)}%` }} /></span>
                    <span className="ol-wk-n">{w.n}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="ol-chips" role="group" aria-label="Week">
              {weekBtns.map(w => (
                <button type="button" key={w.week} className="ol-chip-w" aria-pressed={week === w.week} onClick={() => pick(() => setWeek(w.week))}>
                  {w.label} · {w.n}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <details className="ol-rule">
          <summary>How this is read</summary>
          <p>{OUTLIER_RULE}</p>
          <p>{TRAIT_RULE}</p>
        </details>
      </aside>

      <div className="ol-main">
        <div className="ol-ctl">
          <Segmented label="Platform" markerId="ol-platform" value={platform} onChange={v => pick(() => setPlatform(v as PlatformFilter))}
            options={[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'linkedin', label: 'LinkedIn', count: counts.linkedin },
              { id: 'x', label: 'X', count: counts.x },
            ]} />
          <Segmented label="Sort" markerId="ol-sort" value={sort} onChange={v => pick(() => setSort(v as OutlierSort))}
            options={[{ id: 'lift', label: 'Lift' }, { id: 'buyer', label: 'Who commented' }]} />
        </div>
        {body}
      </div>
      </div>
    </div>
  )
}
