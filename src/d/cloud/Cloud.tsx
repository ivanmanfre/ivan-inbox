// Cloud jobs: send any task to Ivan Cloud (T3 on the cloud host) from the phone, see it work,
// read the answer, reply into the same thread. Nothing here sends, publishes or changes anything
// outside: the cloud thread itself asks before it does (its wrapper rule), and Ivan answers here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '../claude/Markdown'
import { DeskComposer } from '../desk/Composer'
import { newKey } from '../desk/model'
import { useKeyboardInset } from '../desk/useKeyboardInset'
import { currentUserId } from '../../lib/swr'
import { warsawDayWord, warsawHm } from '../ui/time'
import { listCloudJobs, replyCloudJob, startCloudJob, subscribeCloud } from './api'
import { conversations, errorWords, firstLine, liveLine, statusWord, upsert, LIVE, type CloudJob, type Convo } from './model'
import '../claude/claude.css'
import '../desk/desk.css'
import './cloud.css'

function Mark() {
  return <span className="dk-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5z" /></svg></span>
}

function useCloudJobs() {
  const [jobs, setJobs] = useState<CloudJob[] | null>(null)
  const [failed, setFailed] = useState(false)
  const read = useCallback(() => {
    listCloudJobs().then(rows => { setJobs(rows); setFailed(false) }, () => setFailed(true))
  }, [])
  useEffect(() => {
    read()
    const uid = currentUserId()
    const off = uid ? subscribeCloud(uid, { row: r => setJobs(l => upsert(l ?? [], r)), resubscribed: read }) : () => {}
    const onVis = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVis)
    return () => { off(); document.removeEventListener('visibilitychange', onVis) }
  }, [read])
  return { jobs, failed, read, add: (j: CloudJob) => setJobs(l => upsert(l ?? [], j)) }
}

export function Cloud({ layout, onBack, openId, onOpen }: {
  layout: 'phone' | 'desktop'
  onBack?: () => void
  /** The open conversation's root job id (the address's ?job=), or null for the list. */
  openId: string | null
  onOpen: (rootId: string | null) => void
}) {
  const root = useRef<HTMLElement>(null)
  useKeyboardInset(root)
  const { jobs, failed, read } = useCloudJobs()
  const convos = useMemo(() => conversations(jobs ?? []), [jobs])
  const open = openId ? convos.find(c => c.root.id === openId) ?? null : null
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null)

  const start = async (text: string) => {
    if (busy || !text.trim()) return
    setBusy(true); setNote(null)
    const r = await startCloudJob(text)
    setBusy(false)
    if (!r.ok || !r.job_id) { setNote(errorWords(r.error)); setPrefill({ text, n: Date.now() }); return }
    read()
    onOpen(r.job_id)
  }
  // The same reply text keeps its key until it goes through, so a retry after a lost answer
  // returns the reply it already made instead of a second one.
  const pending = useRef<{ text: string; key: string } | null>(null)
  const reply = async (c: Convo, text: string) => {
    if (busy || !text.trim()) return
    setBusy(true); setNote(null)
    if (pending.current?.text !== text) pending.current = { text, key: newKey() }
    const r = await replyCloudJob(c.latest.id, text, pending.current.key)
    setBusy(false)
    if (!r.ok) { setNote(errorWords(r.error)); setPrefill({ text, n: Date.now() }); return }
    pending.current = null
    read()
  }

  const title = open ? firstLine(open.root.title, 60) || 'Cloud job' : 'Cloud jobs'
  const back = open ? () => onOpen(null) : onBack
  return (
    <section ref={root} className={`dk dk-${layout} cj`} data-cloud aria-labelledby="cj-title">
      <header className="dk-head">
        {back && <button type="button" className="dk-back" aria-label="Back" onClick={back}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>}
        <Mark />
        <div className="dk-title">
          <b id="cj-title">{title}</b>
          <small>{open ? (open.live ? 'Working on Ivan Cloud' : statusWord(open)) : 'Runs on Ivan Cloud, laptop closed or not'}</small>
        </div>
        {open?.link && <a className="dk-headkey" href={open.link} target="_blank" rel="noreferrer" aria-label="Open in T3">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </a>}
      </header>
      <div className="dk-body">
        <div className="dk-list" role={open ? 'log' : undefined} aria-label={open ? 'The job and its answers' : 'Your cloud jobs'}>
          <div className="dk-flow">
            {jobs === null && !failed && <div className="dk-empty" aria-busy="true"><span className="dk-typing"><i /><i /><i /></span>Reading your jobs</div>}
            {failed && jobs === null && <div className="dk-empty dk-empty-off" role="alert"><p>Could not read your cloud jobs.</p><button type="button" className="dk-pill" onClick={read}>Try again</button></div>}
            {jobs !== null && !open && <JobList convos={convos} onOpen={onOpen} />}
            {jobs !== null && openId && !open && <div className="dk-empty" role="status">That job is not here. <button type="button" className="dk-pill" onClick={() => onOpen(null)}>All jobs</button></div>}
            {open && <Turns c={open} />}
          </div>
        </div>
      </div>
      {note && <div className="cj-note" role="alert">{note}</div>}
      {(!open || open.canReply) && (
        <DeskComposer
          noPhoto busy={busy} prefill={prefill} autoFocus={layout === 'desktop'}
          placeholder={open ? 'Reply in this thread' : 'What should Ivan Cloud do?'}
          label={open ? 'Reply to the cloud job' : 'Describe a cloud job'}
          onSend={t => void (open ? reply(open, t) : start(t))}
        />
      )}
      {open && !open.canReply && open.live && <div className="cj-wait" role="status"><span className="dk-typing" aria-hidden="true"><i /><i /><i /></span>You can reply once it answers. Your phone rings when it does.</div>}
    </section>
  )
}

function JobList({ convos, onOpen }: { convos: Convo[]; onOpen: (id: string) => void }) {
  if (!convos.length) {
    return (
      <div className="dk-hero" data-cloud-hero>
        <Mark />
        <h2>Send a job to Ivan Cloud</h2>
        <p>It runs in T3 on the cloud, even with the laptop closed. It asks you here before it sends, posts or changes anything, and your phone rings when it answers.</p>
      </div>
    )
  }
  let day = ''
  return (
    <ul className="cj-rows">
      {convos.map(c => {
        const d = warsawDayWord(c.updatedAt)
        const head = d !== day ? <li className="dk-day" key={`d-${d}`}><span>{d}</span></li> : null
        day = d
        const tail = c.live ? liveLine(c.latest.status) : firstLine(c.latest.result_summary) || statusWord(c)
        return [head, (
          <li key={c.root.id}>
            <button type="button" className={`cj-row${c.live ? ' cj-live' : ''}${c.latest.status === 'failed' ? ' cj-bad' : ''}`} onClick={() => onOpen(c.root.id)} data-cloud-job={c.root.id}>
              <span className="cj-row-top"><b>{firstLine(c.root.title, 90) || 'Cloud job'}</b><time>{warsawHm(c.updatedAt)}</time></span>
              <span className="cj-row-tail">{c.live && <i className="cj-dot" aria-hidden="true" />}{tail}</span>
              {c.turns.length > 1 && <span className="cj-row-n">{c.turns.length - 1} {c.turns.length === 2 ? 'reply' : 'replies'}</span>}
            </button>
          </li>
        )]
      })}
    </ul>
  )
}

function Turns({ c }: { c: Convo }) {
  return (
    <>
      {c.turns.map(t => (
        <div key={t.id} className="cj-turn" data-cloud-turn={t.id} data-status={t.status}>
          <div className="dk-me dk-fresh">
            <div className="dk-me-t">{t.brief}</div>
            <small>{warsawHm(t.created_at)}</small>
          </div>
          {t.status === 'done' && t.result_summary && (
            <div className="dk-ans">
              <div className="dk-by"><Mark /><b>Ivan Cloud</b><time>{warsawHm(t.updated_at)}</time></div>
              <div className="dk-text"><Markdown text={t.result_summary} /></div>
            </div>
          )}
          {t.status === 'failed' && (
            <div className="dk-ans dk-ans-err" role="status">
              <div className="dk-by"><Mark /><b>Ivan Cloud</b><time>{warsawHm(t.updated_at)}</time></div>
              <p className="dk-err-t">{t.result_summary || 'This one failed.'}</p>
              {t.t3_link && <a className="dk-pill" href={t.t3_link} target="_blank" rel="noreferrer">Open in T3</a>}
            </div>
          )}
          {LIVE.has(t.status) && (
            <div className="dk-ans dk-streaming" aria-busy="true">
              <span className="dk-typing"><i /><i /><i /><em>{liveLine(t.status)}</em></span>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
