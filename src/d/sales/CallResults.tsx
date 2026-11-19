import { useEffect, useState } from 'react'
import { callResultLabel, DEAL_STATUS, fetchSalesCallResults, type SalesCallResult } from '../../lib/salesCallResults'
import { dHash } from '../route'
import { AnswerRow } from '../ui/AnswerRow'
import { DIcon } from '../ui/icons'
import { Empty, Failed, Skeleton } from '../ui/states'
import { warsawDay } from '../ui/time'

const RESULTS = dHash('sales', 'results')

export function CallResultsLink({ navigate }: { navigate: (hash: string) => void }) {
  return <a href={RESULTS} className="sl-orbit" data-verb="open-call-results" title="Call results" onClick={e => { e.preventDefault(); navigate(RESULTS) }}><DIcon name="check" /><span>Call results</span></a>
}

type Read =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ok'; rows: SalesCallResult[] }

export function CallResultsPage({ navigate }: { navigate: (hash: string) => void }) {
  const [read, setRead] = useState<Read>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    fetchSalesCallResults().then(rows => {
      if (active) setRead({ state: 'ok', rows })
    }).catch(() => {
      if (active) setRead({ state: 'failed' })
    })
    return () => { active = false }
  }, [attempt])

  function retry() {
    setRead({ state: 'loading' })
    setAttempt(n => n + 1)
  }

  return (
    <div className="sl-page sl-em">
      <AnswerRow title="Call results" />
      <div className="sl-orbitback">
        <button type="button" className="d-ib" aria-label="Back to Sales" onClick={() => navigate(dHash('sales'))}><DIcon name="back" /></button>
        <small>Past sales bookings · Warsaw dates</small>
      </div>
      {read.state === 'loading' && <Skeleton lines={6} label="Reading call results" />}
      {read.state === 'failed' && <Failed what="call results" onRetry={retry} />}
      {read.state === 'ok' && (read.rows.length === 0
        ? <Empty title="No past sales bookings." />
        : <ul className="sl-results">
          {read.rows.map(row => {
            const thread = row.prospect_id ? dHash('dms', null, { seat: 'ivan', thread: row.prospect_id }) : null
            const deal = DEAL_STATUS.get(row.deal_status ?? '')
            return (
              <li className="sl-em-row" key={row.meeting_id}>
                <div className="sl-em-name">
                  {thread ? <a href={thread} onClick={e => { e.preventDefault(); navigate(thread) }}>{row.name}</a> : <b>{row.name}</b>}
                </div>
                <div className="sl-em-stats">
                  <time dateTime={row.starts_at}>{warsawDay(row.starts_at)}</time>
                  <b>{callResultLabel(row.outcome)}</b>
                  {deal && <span>{deal}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
