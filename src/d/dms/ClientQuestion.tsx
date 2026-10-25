import { useLayoutEffect, useState, type RefObject } from 'react'
import { clientOwner, type Thread } from '../../lib/inbox'
import { approveThreadEscalation, DISCARDED_REASON, fetchThreadEscalations, type OpsDraft } from '../../lib/ops'
import { useDConfirm } from '../ui/confirm'
import { Btn } from '../ui/Key'
import type { DmVerbs } from './verbs'
import './ClientQuestion.css'

// Reads only when opened. Preparing and sending each require their own button press.
export function ClientQuestion({ t, verbs, questionDirty }: { t: Thread; verbs: DmVerbs; questionDirty?: RefObject<boolean> }) {
  const owner = clientOwner(t.client_id)
  const confirm = useDConfirm()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState<OpsDraft | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const dirty = Boolean(question && body !== question.body)
  useLayoutEffect(() => {
    if (questionDirty) questionDirty.current = dirty || busy
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty || busy) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onUnload)
    return () => { if (questionDirty) questionDirty.current = false; window.removeEventListener('beforeunload', onUnload) }
  }, [questionDirty, dirty, busy])
  if (!owner || t.spam) return null
  const failed = Boolean(question?.send_blocked_reason && question.send_blocked_reason !== DISCARDED_REASON && !question.sent_at)
  const closed = Boolean(question?.sent_at || question?.send_blocked_reason === DISCARDED_REASON)
  const queued = Boolean(question?.approved_at && !question.send_blocked_reason && !question.sent_at)

  const read = async () => {
    setBusy(true); setError(''); setNote('')
    try {
      const [row] = await fetchThreadEscalations(t.prospect_id, t.client_id)
      setQuestion(row ?? null); setBody(old => dirty && row?.id === question?.id ? old : row?.body ?? ''); setLoaded(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the question.') }
    finally { setBusy(false) }
  }
  const prepare = async () => {
    setBusy(true); setError(''); setNote('')
    try { await verbs.askOwner(t); await read() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the question.') }
    finally { setBusy(false) }
  }
  const send = async () => {
    if (!question || !body.trim() || busy || queued || closed) return
    setBusy(true)
    const ok = await confirm({ title: `Send this question to ${owner.owner}?`,
      message: `Posts to the ${owner.notes} Slack channel about 2 minutes later.`, confirmText: 'Approve & send' })
    if (!ok) { setBusy(false); return }
    setError('')
    try {
      await approveThreadEscalation(question, body)
      setQuestion(null); setBody(''); setNote(`Question queued for ${owner.owner}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the question.') }
    finally { setBusy(false) }
  }
  return <div className="dm-rest dm-client-question" data-client-question>
    <Btn verb="client-question" disabled={busy} aria-expanded={open} onClick={() => {
      setOpen(v => !v)
      if (!open && !loaded) void read()
    }}>Ask {owner.owner} (optional)</Btn>
    {open && <div className="dm-ban">
      <Btn disabled={busy} onClick={() => void read()}>Refresh question</Btn>
      {busy && <p className="dm-meta" role="status">Working…</p>}
      {error && <p role="alert">{error} <Btn onClick={() => void read()}>Retry</Btn></p>}
      {note && <p role="status">{note}</p>}
      {failed && <p role="alert">Question could not be sent: {question!.send_blocked_reason}</p>}
      {queued && <p role="status">Question queued for {owner.owner}.</p>}
      {closed && <p className="dm-meta">{question?.sent_at ? 'Question sent.' : 'Question dismissed.'}</p>}
      {question?.sent_at && t.draft?.context_gap && <Btn disabled={busy} onClick={() => void prepare()}>Prepare new question</Btn>}
      {question && <>
        <label>Question for {owner.owner}
          <textarea aria-label={`Question for ${owner.owner}`} value={body} rows={6}
            disabled={busy} readOnly={closed || queued} onChange={e => setBody(e.target.value)} />
        </label>
        {!closed && !queued && <div className="dm-ban-row"><Btn verb="send-client-question" disabled={busy || !body.trim()} onClick={() => void send()}>{failed ? 'Retry sending to' : 'Send to'} {owner.owner}</Btn></div>}
      </>}
      {!busy && !error && !question && !note && <>
        <p className="dm-meta">No question prepared for this conversation.</p>
        {t.draft?.context_gap && <Btn disabled={busy} onClick={() => void prepare()}>Prepare question</Btn>}
      </>}
    </div>}
  </div>
}
