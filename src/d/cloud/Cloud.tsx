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
import { listCloudJobs, readConversation, replyCloudJob, startCloudJob, subscribeCloud } from './api'
import {
  conversations, errorWords, firstLine, liveLine, merge, statusWord, submissionDone, submissionKey, upsert, LIVE,
  type CloudJob, type Convo,
} from './model'
import '../claude/claude.css'
import '../desk/desk.css'
import './cloud.css'

function Mark() {
  return <span className="dk-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5z" /></svg></span>
}

/** The list, plus the open conversation read by its root id (any age). Every read and every live
 *  change merges by id and keeps the newer copy (Sol r2 #6, #7). */
function useCloudJobs(openId: string | null) {
  const [jobs, setJobs] = useState<CloudJob[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [convoRead, setConvoRead] = useState<{ id: string; state: 'loading' | 'done' | 'failed' } | null>(null)
  const openRef = useRef(openId)
  openRef.current = openId
  // Only the newest read for the conversation on screen may set its state: a late answer for one
  // Ivan left never overwrites the one he is looking at (Sol r3 #6). Rows always merge.
  const seq = useRef(0)
  const readOne = useCallback((id: string) => {
    const n = ++seq.current
    setConvoRead(c => (c?.id === id && c.state === 'done' ? c : { id, state: 'loading' }))
    const mine = () => n === seq.current && openRef.current === id
    readConversation(id).then(
      rows => { setJobs(l => merge(l ?? [], rows)); if (mine()) setConvoRead({ id, state: 'done' }) },
      () => { if (mine()) setConvoRead({ id, state: 'failed' }) },
    )
  }, [])
  const read = useCallback(() => {
    listCloudJobs().then(rows => { setJobs(l => merge(l ?? [], rows)); setFailed(false) }, () => setFailed(true))
    if (openRef.current) readOne(openRef.current)
  }, [readOne])
  useEffect(() => { if (openId) readOne(openId) }, [openId, readOne])
  useEffect(() => {
    read()
    const uid = currentUserId()
    const off = uid ? subscribeCloud(uid, { row: r => setJobs(l => upsert(l ?? [], r)), resubscribed: read }) : () => {}
    const onVis = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVis)
    return () => { off(); document.removeEventListener('visibilitychange', onVis) }
  }, [read])
  const convoState = openId ? (convoRead?.id === openId ? convoRead.state : 'loading') : null
  return { jobs, failed, read, convoState }
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
  const { jobs, failed, read, convoState } = useCloudJobs(openId)
  const convos = useMemo(() => conversations(jobs ?? []), [jobs])
  const open = openId ? convos.find(c => c.root.id === openId) ?? null : null
  // Every composer, draft, error and busy mark belongs to one destination: 'new' (the list) or a
  // conversation's root id. Switching destination never carries text or an error across (Sol r2 #2).
  const dest = openId ?? 'new'
  const destRef = useRef(dest)
  destRef.current = dest
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ dest: string; text: string } | null>(null)
  const [prefill, setPrefill] = useState<{ dest: string; text: string; n: number } | null>(null)

  const start = async (text: string) => {
    if (busy || !text.trim()) return
    const d = 'new'
    setBusy(d); setNote(null)
    const key = submissionKey(d, text, newKey)
    const r = await startCloudJob(text, key)
    setBusy(null)
    if (!r.ok || !r.job_id) { setNote({ dest: d, text: errorWords(r.error) }); setPrefill({ dest: d, text, n: Date.now() }); return }
    submissionDone(d, key)
    read()
    if (destRef.current === d) onOpen(r.job_id)
  }
  const reply = async (c: Convo, text: string) => {
    if (busy || !text.trim() || !c.replyTo) return
    const d = c.root.id
    setBusy(d); setNote(null)
    const key = submissionKey(d, text, newKey)
    const r = await replyCloudJob(c.replyTo.id, text, key)
    setBusy(null)
    if (!r.ok) { setNote({ dest: d, text: errorWords(r.error) }); setPrefill({ dest: d, text, n: Date.now() }); return }
    submissionDone(d, key)
    read()
  }

  const title = open ? firstLine(open.root.title, 60) || 'Cloud job' : openId ? 'Cloud job' : 'Cloud jobs'
  const back = openId ? () => onOpen(null) : onBack
  const showComposer = openId ? !!open && open.canReply : jobs !== null
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
            {!openId && jobs === null && !failed && <div className="dk-empty" aria-busy="true"><span className="dk-typing"><i /><i /><i /></span>Reading your jobs</div>}
            {!openId && failed && jobs === null && <div className="dk-empty dk-empty-off" role="alert"><p>Could not read your cloud jobs.</p><button type="button" className="dk-pill" onClick={read}>Try again</button></div>}
            {!openId && jobs !== null && <JobList convos={convos} onOpen={onOpen} />}
            {openId && !open && convoState === 'loading' && <div className="dk-empty" aria-busy="true"><span className="dk-typing"><i /><i /><i /></span>Reading the job</div>}
            {openId && !open && convoState === 'failed' && <div className="dk-empty dk-empty-off" role="alert"><p>Could not read this job.</p><button type="button" className="dk-pill" onClick={read}>Try again</button></div>}
            {openId && !open && convoState === 'done' && <div className="dk-empty" role="status">That job is not here. <button type="button" className="dk-pill" onClick={() => onOpen(null)}>All jobs</button></div>}
            {open && <Turns c={open} />}
          </div>
        </div>
      </div>
      {note && note.dest === dest && <div className="cj-note" role="alert">{note.text}</div>}
      {showComposer && (
        <DeskComposer
          key={dest}
          noPhoto busy={busy !== null} autoFocus={layout === 'desktop'}
          prefill={prefill && prefill.dest === dest ? { text: prefill.text, n: prefill.n } : null}
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
