import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { clientReal, fetchEmailLists, isUnused, shortDay, splitLists, type EmailClient, type EmailList, type EmailLists } from '../../lib/emailLists'
import { dHash } from '../route'
import { AnswerRow } from '../ui/AnswerRow'
import { DIcon } from '../ui/icons'
import { Empty, Failed, Skeleton } from '../ui/states'

// SALES > EMAIL (`#exp/d/sales/email`). Read only: one block per client, one
// row per list or lead magnet, real people only (test rows and our own
// addresses never count; the row says how many it left out). Replies and calls
// are not tracked for email, and the page says so once instead of showing 0.
// Hooks rule: every hook runs before any branch that returns.

const EMAIL = dHash('sales', 'email')

/** The tool in the Sales answer row, next to Orbit. */
export function EmailListsLink({ navigate }: { navigate: (hash: string) => void }) {
  return <a href={EMAIL} className="sl-orbit" data-verb="open-email-lists" onClick={e => { e.preventDefault(); navigate(EMAIL) }}><DIcon name="person" /><span>Email</span></a>
}

type St = { s: 'loading' } | { s: 'failed'; why: string } | { s: 'ok'; d: EmailLists }

function Stat({ n, label }: { n: number | string; label: string }) {
  return <span className="sl-em-st"><b className="d-n">{n}</b> {label}</span>
}

function ListRow({ l, armed }: { l: EmailList; armed: boolean }) {
  const hid = (l.hidden ?? 0) > 0 ? <small className="sl-em-hid">{l.hidden} test or own left out</small> : null
  let stats: ReactNode
  if (l.kind === 'broadcast') {
    stats = <><Stat n={l.issues ?? 0} label="issues sent" /><Stat n={shortDay(l.last_sent)} label="last" />{l.last_recipients != null && <Stat n={l.last_recipients} label="on the last one" />}</>
  } else if (l.kind === 'request') {
    stats = <><Stat n={l.real ?? 0} label="real" /><Stat n={l.last30 ?? 0} label="last 30 days" /><Stat n={shortDay(l.last_at)} label="last" />
      {l.key === 'swishdm_req:ai-search-report' && <><Stat n={l.qualifying ?? 0} label="$1M+" /><Stat n={l.reports_sent ?? 0} label="reports sent" /><Stat n={l.enrolled ?? 0} label="in nurture" /></>}</>
  } else {
    stats = <><Stat n={l.real ?? 0} label="real" /><Stat n={l.last30 ?? 0} label="last 30 days" /><Stat n={shortDay(l.last_at)} label="last" />
      {typeof l.sent === 'number' && <Stat n={l.sent} label="emails sent" />}{typeof l.unsub === 'number' && <Stat n={l.unsub} label="unsubscribed" />}{(l.bounced ?? 0) > 0 && <Stat n={l.bounced ?? 0} label="bounced" />}</>
  }
  // Same gate as enrollment: the switch AND step 1 live.
  const off = l.key === 'seq:swishdm_ai_search_report' && !(armed && l.step1_active === true)
  return (
    <li className="sl-em-row" data-email-list={l.key}>
      <div className="sl-em-name">{l.name}{off && <span className="sl-em-off">Off · waiting for your send</span>}</div>
      <div className="sl-em-stats">{stats}</div>
      {hid}
    </li>
  )
}

function ClientBlock({ c, armed }: { c: EmailClient; armed: boolean }) {
  const { shown, unused } = splitLists(c)
  const t = clientReal(c)
  // A list exists once there is a sequence or a request form; an empty sign-up table alone is no list.
  const nothing = !c.lists.some(l => l.kind === 'nurture' || l.kind === 'request' || !isUnused(l))
  return (
    <section className="sl-em-c" data-email-client={c.client}>
      <header><b>{c.label}</b><small>{t.real} real sign-up{t.real === 1 ? '' : 's'} · {t.last30} in the last 30 days</small></header>
      {nothing
        ? <Empty title="No list yet." reason={c.client === 'arch' ? 'The ARCH newsletter sign-up table is empty and no ARCH email sequence exists.' : 'Nobody has signed up and nothing has been sent.'} />
        : <ul>{shown.map(l => <ListRow key={l.key} l={l} armed={armed} />)}</ul>}
      {unused.length > 0 && <p className="sl-em-unused">{unused.length} more sequence{unused.length === 1 ? '' : 's'} never used: {unused.map(l => l.name).join(', ')}.</p>}
    </section>
  )
}

export function EmailListsPage({ navigate, layout }: { navigate: (hash: string) => void; layout: 'desktop' | 'phone' }) {
  const [st, setSt] = useState<St>({ s: 'loading' })
  const [reads, setReads] = useState(0)
  const retry = useCallback(() => setReads(n => n + 1), [])
  useEffect(() => {
    let alive = true
    setSt({ s: 'loading' })
    fetchEmailLists()
      .then(d => { if (alive) setSt({ s: 'ok', d }) })
      .catch(e => { if (alive) setSt({ s: 'failed', why: e instanceof Error ? e.message : String(e) }) })
    return () => { alive = false }
  }, [reads])

  const total = st.s === 'ok' ? st.d.clients.reduce((a, c) => a + clientReal(c).last30, 0) : 0
  const title = st.s === 'loading' ? <>Reading the email lists…</>
    : st.s === 'failed' ? <>Could not read the email lists.</>
      : <>Email lists: <b className="d-n">{total}</b> real sign-up{total === 1 ? '' : 's'} in the last 30 days.</>

  return (
    <div className={`sl-page sl-em sl-em-${layout}`} data-email-page>
      <AnswerRow title={title} />
      <div className="sl-orbitback">
        <button type="button" className="d-ib" aria-label="Back to Sales" onClick={() => navigate(dHash('sales'))}><DIcon name="back" /></button>
        <small>Sales · Email</small>
      </div>
      {st.s === 'loading' && <Skeleton lines={6} label="Reading the email lists" />}
      {st.s === 'failed' && <Failed what="the email lists" detail={`${st.why} This is not an empty list, it is an unread one.`} onRetry={retry} />}
      {st.s === 'ok' && <>
        <div className="sl-em-grid">{st.d.clients.map(c => <ClientBlock key={c.client} c={c} armed={st.d.swishdm_nurture_armed} />)}</div>
        <p className="sl-em-foot">Real people only: test rows and our own addresses (Ivan, SwishDM, RISE, ARCH) are left out. Replies and calls are not tracked for email yet. Ivan's cold email lane (Instantly) is not a nurture list and is not counted here.</p>
      </>}
    </div>
  )
}
