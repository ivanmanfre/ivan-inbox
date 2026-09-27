// The pane's banners (mock `.df-ban`): owner question, dated follow-up + one-tap suggestion,
// owed with no draft, waiting on them, pushed to later, context gap (+ Ask Mattan/Davorin).
import { useEffect, useState } from 'react'
import { clientOwner, eventTime, isReplyRetryPending, type Thread } from '../../lib/inbox'
import { fetchFollowUp, followUpSuggestion, type FollowUp } from '../../lib/followUp'
import { formatReturn, returnsIn } from '../../lib/pushLater'
import { seatOf } from '../seats'
import { Btn } from '../ui/Key'
import { DIcon } from '../ui/icons'
import { warsawDm, warsawDow } from '../ui/time'
import { owedSince } from './model'
import type { DmVerbs } from './verbs'

const firstOf = (t: Thread) => t.prospect_name.split(' ')[0] || t.prospect_name

export function OwnerHoldBanner({ t, verbs, onNote, onRetry }: { t: Thread; verbs: DmVerbs; onNote: () => void; onRetry: () => void }) {
  const hold = t.ownerConfirmation
  if (!hold) return null
  const owner = clientOwner(t.client_id)?.owner ?? 'the owner'
  const retry = isReplyRetryPending(hold)
  return (
    <div className="dm-ban dm-ban-hl" role="note">
      <b><DIcon name="person" />{retry ? 'Drafting retries on its own' : `Confirm with ${owner}`}</b>
      <p>{hold.context_gap?.question || (retry ? 'The reply drafter will try again shortly.' : 'The drafter has a question only the owner can answer.')}</p>
      {hold.context_gap?.why && <p className="dm-meta">{hold.context_gap.why} · internal question, no reply is queued</p>}
      {!retry && <div className="dm-ban-row">
        <Btn verb="hold-note" onClick={onNote}>Add the answer as a note</Btn>
        <Btn verb="retry" onClick={onRetry}>Retry</Btn>
        <Btn verb="hold-discard" onClick={() => { void verbs.holdDiscard(t) }}>Discard</Btn>
      </div>}
    </div>
  )
}

/** Rise and Arch: the dated follow-up on this person, the planner's one-tap suggestion, or "Follow up
 *  on a date" (today's FollowUpStrip: with or without a draft, with the free-text note the drafter
 *  picks up). `open`/`setOpen` is the note form, lifted so the pane's Follow up key can open it. */
export function FollowUpBanner({ t, verbs, reload, open, setOpen }: { t: Thread; verbs: DmVerbs; reload: () => void; open: boolean; setOpen: (o: boolean) => void }) {
  const supported = seatOf(t.client_id) === 'risedtc' || seatOf(t.client_id) === 'arch'
  const [fu, setFu] = useState<FollowUp | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState('')
  useEffect(() => {
    if (!supported) return
    let live = true
    setState('loading')
    fetchFollowUp(t.prospect_id).then(f => { if (live) { setFu(f); setState('ok') } }).catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [t.prospect_id, supported])
  if (!supported || state === 'loading') return null
  if (state === 'failed') return <div className="dm-ban"><b><DIcon name="time" />Could not read the follow-up date.</b></div>
  const first = firstOf(t)
  const stamp = async (at: string | null, note: string) => {
    setBusy(true)
    const ok = await verbs.followUp(t, at, note)
    if (ok) { const f = await fetchFollowUp(t.prospect_id).catch(() => null); setFu(f); setOpen(false); setWhy(''); reload() }
    setBusy(false)
  }
  const form = open && (
    <div className="dm-fu-form">
      <label className="dm-field"><span>What the follow-up should pick up (optional)</span>
        <textarea rows={2} value={why} disabled={busy} onChange={e => setWhy(e.target.value)} placeholder="e.g. back mid October, we emailed the model, set the catch-up" />
      </label>
      <div className="dm-ban-row">
        <Btn verb="follow-up-cancel" disabled={busy} onClick={() => { setOpen(false); setWhy('') }}>Cancel</Btn>
        <Btn primary verb="follow-up-pick" disabled={busy} onClick={() => { void stamp(null, why) }}>Pick the date</Btn>
      </div>
    </div>
  )
  if (fu) {
    return (
      <div className="dm-ban">
        <b><DIcon name="time" />Follow-up drafts {formatReturn(fu.at)}</b>
        <p>{returnsIn(fu.at)}{fu.note ? ` · ${fu.note}` : ''} · if {first} writes first, the date is dropped.</p>
        {!open && <div className="dm-ban-row">
          <Btn verb="follow-up-date" disabled={busy} onClick={() => { setWhy(fu.note ?? ''); setOpen(true) }}>Change</Btn>
          <Btn verb="follow-up-clear" disabled={busy} onClick={async () => { setBusy(true); if (await verbs.followUpClear(t)) { setFu(null); reload() } setBusy(false) }}>Clear</Btn>
        </div>}
        {form}
      </div>
    )
  }
  const sug = followUpSuggestion(t.draft?.draft_evidence)
  if (sug && !open) {
    return (
      <div className="dm-ban dm-ban-hl">
        <b><DIcon name="time" />{first} asked to hear from you again later{sug.dated ? `, around ${formatReturn(sug.at)}` : ''}.</b>
        <p>{sug.why ? <q>{sug.why}</q> : null} Send the reply now; on that date a follow-up is drafted for you to approve. If {first} writes first, the date is dropped.</p>
        <div className="dm-ban-row">
          <Btn verb="follow-up" disabled={busy} onClick={() => { void stamp(sug.at, sug.why) }}>Follow up {warsawDow(sug.at)} {warsawDm(sug.at)}</Btn>
          <Btn verb="follow-up-date" disabled={busy} onClick={() => { setWhy(sug.why); setOpen(true) }}>Another date</Btn>
        </div>
      </div>
    )
  }
  return (
    <div className="dm-ban">
      {!open ? <div className="dm-ban-row" style={{ marginTop: 0 }}>
        <Btn verb="follow-up-open" onClick={() => setOpen(true)}><DIcon name="time" />Follow up on a date</Btn>
        <span className="dm-meta">A follow-up is drafted that morning for you to approve.</span>
      </div> : <><b><DIcon name="time" />Follow up on a date</b>{form}</>}
    </div>
  )
}

export function NoDraftBanner({ t, now }: { t: Thread; now: number }) {
  const since = owedSince(t)
  if (!since) return null
  const days = Math.max(0, Math.round((now - Date.parse(since)) / 86_400_000))
  return (
    <div className="dm-ban dm-ban-hl">
      <b><DIcon name="alert" />{firstOf(t)} is owed a reply: {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}, no draft.</b>
      <p>{days > 14 ? 'Past two weeks the drafter stops. ' : ''}Write it yourself, ask Claude for a draft, or set a date to follow up.</p>
    </div>
  )
}

export function WaitingBanner({ t }: { t: Thread }) {
  const lo = t.messages.filter(m => m.direction === 'outbound' && m.sent_at).at(-1)
  const dated = seatOf(t.client_id) !== 'ivan'
  return (
    <div className="dm-ban">
      <b><DIcon name="time" />Waiting on {firstOf(t)}{lo ? ` since ${warsawDow(eventTime(lo))} ${warsawDm(eventTime(lo))}` : ''}.</b>
      <p>Nothing is owed. Write again, or {dated ? 'set a date and a follow-up is drafted that morning' : 'leave it; the ladder sends the next step'}.</p>
    </div>
  )
}

export function PushedBanner({ t, verbs }: { t: Thread; verbs: DmVerbs }) {
  if (!t.draftSnoozedUntil) return null
  return (
    <div className="dm-ban">
      <b><DIcon name="time" />Pushed to {formatReturn(t.draftSnoozedUntil)}.</b>
      <p>Out of your queue until then, {returnsIn(t.draftSnoozedUntil)}. It comes back sooner if {firstOf(t)} writes.</p>
      <div className="dm-ban-row"><Btn verb="bring-back-now" onClick={() => { void verbs.bringBackNow(t) }}>Bring back now</Btn></div>
    </div>
  )
}

export function GapBanner({ t, verbs }: { t: Thread; verbs: DmVerbs }) {
  const gap = t.draft?.context_gap
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (!gap) return null
  const owner = clientOwner(t.client_id)
  return (
    <div className="dm-ban dm-ban-warn">
      <b><DIcon name="alert" />This answers something {owner ? `${owner.owner}'s` : 'our own'} notes do not cover.</b>
      {gap.why && <p>{gap.why}</p>}
      {gap.question && <p>{owner ? `For ${owner.owner}: ` : ''}<q>{gap.question}</q></p>}
      <div className="dm-ban-row">
        {owner && <Btn verb="ask-owner" disabled={busy || Boolean(note)} onClick={async () => { setBusy(true); setNote(await verbs.askOwner(t)); setBusy(false) }}>{note ? 'Asked' : busy ? 'Queueing…' : `Ask ${owner.owner}`}</Btn>}
        {gap.chat_url && <a className="d-link" href={gap.chat_url} target="_blank" rel="noreferrer" data-verb="gap-chat">open the conversation</a>}
        <span className="dm-meta">Optional. You can send this draft as it is.</span>
      </div>
      {note && <p className="dm-meta">{note}</p>}
    </div>
  )
}
