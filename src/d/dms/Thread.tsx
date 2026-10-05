// The open conversation (desktop right pane / phone full page).
// Hooks first, always: no hook sits after an early return (09-09).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { requestDmDraft } from '../../lib/dmDraft'
import { useDCommands } from '../shell/commands'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { canComposeEmail, emailReplyTarget, emailRowSender, isReplyRetryExhausted, markThreadRead, messageChannel, threadBucket, unansweredWaitSince, type InboxMessage, type Thread as T } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { chatLink } from '../../components/CopyChatLink'
import { seatOf } from '../seats'
import { Btn, Key } from '../ui/Key'
import { laterPath } from './later'
import { useAutosave } from './useAutosave'
import { Banners } from './ThreadBanners'
import { Draft } from './Draft'
import { ScheduleSheet, ScheduledSends, type ScheduleTarget } from './Schedule'
import { ForwardEmailSheet } from './ForwardEmail'
import { scheduleHeld } from '../../lib/dmSchedule'

import { canMarkSolved } from './solved'
import { DraftWhy } from './DraftWhy'
import { History } from './History'
import { Composer } from './Keys'
import { ThreadMenu, type MenuAct } from './Menu'
import { AgentSheet, ContextSheet } from './Sheets'
import { RestoreStrip } from './Restore'
import { ThreadHead } from './ThreadHead'
import type { DmVerbs, Edits } from './verbs'

const FROM: Record<string, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }

function seed(t: T): Edits {
  return { main: t.draft?.message_text ?? '', email: t.draft?.email_mirror_text ?? null, companion: t.companionDraft?.message_text ?? null, cc: t.draft?.recipient_email ? (t.draft.email_cc ?? t.draft.draft_evidence?.email_cc ?? []).join(', ') : undefined, companionCc: t.companionDraft?.recipient_email ? (t.companionDraft.email_cc ?? t.companionDraft.draft_evidence?.email_cc ?? []).join(', ') : undefined }
}

const hasDraftNow = (t: T) => t.draft !== null
const stamped = new Set<string>()
/** markThreadRead once per (thread, newest inbound): the same PATCH today sends, never twice. */
export function stampReadOnce(pid: string, lastInbound: string) {
  const k = `${pid}:${lastInbound}`
  if (stamped.has(k)) return
  stamped.add(k)
  markThreadRead(pid).catch(() => { stamped.delete(k) })
}

export async function copyText(s: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(s); return true } catch { window.prompt('Copy this link', s); return false }
}

export function ThreadPane({ t, auto = false, all, phone, verbs, now, onBack, onAsk, onDraftStart, onMenu, staleN, pre, reload, signal }: {
  t: T; auto?: boolean; all: readonly T[]; phone: boolean; verbs: DmVerbs; now: number
  onBack: () => void; onAsk: () => void
  onDraftStart?: () => void
  onMenu: (a: MenuAct) => void; staleN: number; pre: PreReadHandle; reload: () => void
  /** The came-back tag beside the name, with its Dismiss (cameBack.ts). */
  signal?: ReactNode
}) {
  const [edits, setEdits] = useState<Edits>(() => seed(t))
  const [reply, setReply] = useState('')
  const [schedule, setSchedule] = useState<ScheduleTarget | null>(null)
  const [forwardEmail, setForwardEmail] = useState<InboxMessage | null>(null)
  const [scheduleFailure, setScheduleFailure] = useState('')
  const [emailReplyFor, setEmailReplyFor] = useState<string | null>(null)
  const [emailTarget, setEmailTarget] = useState<{ key: string; address?: string; error?: string } | null>(null)
  const [emailRetry, setEmailRetry] = useState(0)
  const dock = useRef<HTMLDivElement>(null)
  const [draftJob, setDraftJob] = useState<{ pid: string; running: boolean; error: string | null } | null>(null)
  const drafting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<'top' | 'keys' | null>(null)
  const [sheet, setSheet] = useState<'context' | 'agent' | null>(null)
  const [copied, setCopied] = useState(false)
  const [fuTick, setFuTick] = useState(0)
  const seeded = useRef({ id: '', text: '', cc: undefined as string | undefined, companionCc: undefined as string | undefined })
  const scroll = useRef<HTMLDivElement>(null)
  const draftId = t.draft?.id ?? ''
  const draftText = t.draft?.message_text ?? ''
  const recipients = seed(t)

  // Re-seed on a new draft row, or when the same row's text changed under an untouched editor.
  useEffect(() => {
    const was = seeded.current
    if (draftId !== was.id) setEdits(seed(t))
    else setEdits(e => ({ ...e, main: e.main === was.text ? draftText : e.main, cc: e.cc === was.cc ? recipients.cc : e.cc, companionCc: e.companionCc === was.companionCc ? recipients.companionCc : e.companionCc }))
    seeded.current = { id: draftId, text: draftText, cc: recipients.cc, companionCc: recipients.companionCc }
  }, [draftId, draftText, recipients.cc, recipients.companionCc]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReply(''); setEmailReplyFor(null); setMenu(null); setSheet(null); setSchedule(null); setForwardEmail(null); setScheduleFailure('') }, [t.prospect_id])
  useLayoutEffect(() => {
    if (emailReplyFor === t.prospect_id) dock.current?.querySelector('textarea')?.focus()
  }, [emailReplyFor, t.prospect_id])
  // Open at the newest message on both layouts; the conversation owns its scroll.
  useEffect(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight }, [t.prospect_id, phone])
  // Sanctioned read stamp on real inbound rows, as today. Once per thread and unread set: a remount
  // (the phone page, React's dev double effect) must not PATCH read_at a second time.
  const lastIn = t.messages.filter(m => m.direction === 'inbound').at(-1)?.id ?? ''
  useEffect(() => { if (!auto && t.unread > 0) stampReadOnce(t.prospect_id, lastIn) }, [auto, t.prospect_id, t.unread, lastIn])
  const saver = useAutosave(t, edits, seed(t), verbs.autosave)

  const seat = seatOf(t.client_id) ?? 'ivan'
  const from = FROM[seat]
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  const owed = threadBucket(t, now) !== 'waiting' || unansweredWaitSince(t) !== null
  const hasDraft = t.draft !== null
  const lp = laterPath(t)
  const manualReply = Boolean(t.ownerConfirmation && isReplyRetryExhausted(t.ownerConfirmation))
  const replyThread = emailReplyFor === t.prospect_id ? { ...t, channel: 'email' as const } : t
  const replyingByEmail = replyThread.channel === 'email'
  const lastEmail = t.messages.filter(m => m.direction === 'inbound' && messageChannel(m) === 'email').at(-1)
  const emailKey = `${t.prospect_id}:${lastEmail?.id ?? ''}`
  const resolvedEmail = emailTarget?.key === emailKey ? emailTarget : null
  const emailBlocked = replyingByEmail && !resolvedEmail?.address
  const composeNote = replyingByEmail ? `From ${emailRowSender(t.client_id)} · ${resolvedEmail?.address ? `To ${resolvedEmail.address}` : resolvedEmail?.error ? 'Email address unavailable' : 'Loading email recipient…'}` : undefined
  const composeLabel = replyingByEmail ? 'Send email' : 'Send'
  useEffect(() => {
    if (!replyingByEmail || !canComposeEmail(t)) return
    let current = true
    setEmailTarget(null)
    void emailReplyTarget(t.prospect_id).then(target => {
      if (current) setEmailTarget({ key: emailKey, address: target.recipient_email })
    }).catch(e => {
      if (current) setEmailTarget({ key: emailKey, error: e instanceof Error ? e.message : 'Could not load the email recipient.' })
    })
    return () => { current = false }
  }, [replyingByEmail, t.prospect_id, t.client_id, emailKey, emailRetry]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheduledPending = t.messages.some(m => scheduleHeld(m.send_blocked_reason) && !m.sent_at && !m.approved_at)
  const composeOff = scheduledPending ? 'A DM is scheduled. Cancel the scheduled send to write another reply.' : t.ownerConfirmation && !manualReply ? 'Reply paused while an internal fact is confirmed. Add the answer as a note, or discard the question.'
    : replyingByEmail && !canComposeEmail(t) ? 'Email compose is on for Arch threads only. Approving email drafts works here.'
      : !replyingByEmail && t.stage === 'engaged' ? 'Not connected yet. A reply here would go out as a connection invite, so compose is off for this thread.' : null
  const openEmailReply = () => {
    setEmailReplyFor(t.prospect_id)
    dock.current?.querySelector('textarea')?.focus()
  }

  const draftIt = async () => {
    if (drafting.current) return
    drafting.current = true
    const pid = t.prospect_id
    onDraftStart?.()
    setDraftJob({ pid, running: true, error: null })
    try {
      await requestDmDraft(t)
      setDraftJob({ pid, running: false, error: null })
      reload()
    } catch (e) {
      setDraftJob({ pid, running: false, error: e instanceof Error ? e.message : 'Drafting failed. Try again.' })
    } finally { drafting.current = false }
  }
  const draftRunning = draftJob?.pid === t.prospect_id && draftJob.running
  const draftError = draftJob?.pid === t.prospect_id ? draftJob.error : null

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  // ⌘K "Push this conversation to later" (today's CommandLayer), while a pushable draft is open.
  const canPush = hasDraftNow(t) && !t.spam && !t.ownerConfirmation && t.draftSnoozedUntil === null
  const editsRef = useRef(edits); editsRef.current = edits
  useDCommands(useMemo<WbCommand[]>(() => canPush ? [{
    id: 'dms.later', title: 'Push this conversation to later', group: 'Thread', icon: 'time', key: null,
    hint: `${t.prospect_name}: nothing is sent, it comes back on the day you pick.`, ready: true,
    run: () => { void verbs.later(t, editsRef.current) },
  }] : [], [canPush, t, verbs]))
  const copy = async () => { const l = chatLink(t.chat_provider_id, t.linkedin_url); if (l && await copyText(l.href)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) } }
  // A verb that writes the draft itself carries the text on screen; a pending autosave is dropped.
  const send = () => run(async () => { if (scheduledPending) return; saver.cancel(); await verbs.send(t, edits) })
  const openSchedule = () => run(async () => {
    saver.cancel(); setScheduleFailure('')
    if (reply.trim()) { setSchedule({ ids: [], texts: [reply.trim()], manual: true }); return }
    if (!t.draft) return
    if (t.draft.email_stamp_unavailable || t.companionDraft?.email_stamp_unavailable) { setScheduleFailure('Refresh to check the email recipients before scheduling.'); return }
    const failure = await verbs.autosave(t, edits)
    if (failure) { setScheduleFailure(failure); return }
    const legs = t.companionDraft ? [t.draft, t.companionDraft] : [t.draft]
    setSchedule({ ids: legs.map(m => m.id), texts: legs.map((m, i) => i === 0 ? edits.main : edits.companion ?? m.message_text) })
  })
  const later = () => run(async () => { saver.cancel(); await verbs.later(t, edits); setFuTick(x => x + 1) })
  const compose = () => run(async () => { if (!composeOff && !emailBlocked && await verbs.compose(replyThread, reply)) setReply('') })
  const menuRun = (a: MenuAct) => {
    if (a === 'context') setSheet('context')
    else if (a === 'agent') setSheet('agent')
    else if (a === 'copy-chat') void copy()
    else if (a === 'sum') pre.run(t)
    else if (a === 'ask') onAsk()
    else onMenu(a)
  }
  const ps = pre.get(t.prospect_id)

  // One compact row under the draft (Ivan 09-27: "The buttons are super big"): small secondary keys,
  // Send the one full-size lime key. Nothing was removed; Follow up on a date is Later now.
  const more = <Btn verb="more" className="dm-k dm-k-more" aria-label="More for this conversation" aria-expanded={menu === 'keys'} onClick={() => setMenu(m => (m ? null : 'keys'))}>⋯</Btn>
  const solvedKey = <Btn verb="solved" className="dm-k" disabled={busy} onClick={() => run(async () => { saver.cancel(); await verbs.solved(t) })}>{phone ? 'Solved' : 'Mark as solved'}</Btn>
  const laterKey = lp && <Btn verb="later" className="dm-k" disabled={busy} title={lp === 'followup' ? 'A follow-up is drafted on the day you pick' : 'Out of your queue until the day you pick'} onClick={() => void later()}>Later</Btn>
  let small, primary
  if (t.spam) {
    small = <>
      <Btn verb="not-spam" className="dm-k" disabled={busy} onClick={() => run(() => verbs.notSpam(t))}>Not spam</Btn>
      {t.chat_provider_id && <Btn verb="delete-seat" disabled={busy} className="dm-k dm-k-warn" onClick={() => run(async () => { if (await verbs.deleteSeat(t)) onBack() })}>Delete from seat</Btn>}
    </>
  } else if (hasDraft && !t.ownerConfirmation) {
    small = <>
      <Btn verb="discard" className="dm-k" disabled={busy} onClick={() => run(async () => { saver.cancel(); await verbs.discard(t) })}>Discard</Btn>
      {laterKey}
      {solvedKey}
    </>
    primary = <Key primary verb="send" className="dm-send" disabled={busy || scheduledPending} onClick={() => void send()}>{t.companionDraft ? 'Send both' : 'Send'}</Key>
  } else {
    small = <>
      {t.ownerConfirmation && !manualReply
        ? <Btn verb="ask-owner-link" className="dm-k" onClick={() => void copy()} title="copies the chat link">{seat === 'ivan' ? 'Copy chat link' : `Ask ${from}`}</Btn>
        : owed && <Btn verb="draft-it" className="dm-k" disabled={Boolean(draftJob?.running)} onClick={() => void draftIt()} title="Create a reply draft">{draftRunning ? 'Drafting…' : 'Draft it'}</Btn>}
      {laterKey}
      {canMarkSolved(t) && solvedKey}
    </>
    if (!composeOff) primary = <Key primary verb="compose-send" className="dm-send" disabled={busy || emailBlocked || !reply.trim()} onClick={() => void compose()}>{composeLabel}</Key>
  }

  return (
    <section className={`dm-pane${phone ? ' dm-pane-phone' : ''}`} aria-label={`Conversation with ${t.prospect_name}`}>
      <ThreadHead t={t} phone={phone} onBack={onBack} onCopy={() => void copy()} copied={copied} onAsk={onAsk} onMore={() => setMenu(m => (m ? null : 'top'))} moreOpen={menu === 'top'}
        onWho={() => setSheet('context')} onDelete={t.chat_provider_id && !t.spam ? () => void run(async () => { if (await verbs.deleteSeat(t)) onBack() }) : undefined} deleting={busy}
        onSpam={!t.spam && seat !== 'ivan' ? () => void run(() => verbs.spam(t)) : undefined} signal={signal} />
      {ps.s !== 'none' && <div className="dm-sum" role="status">{ps.s === 'done' ? ps.line : ps.s === 'running' ? 'Reading it…' : ps.why}</div>}
      <div className="dm-scroll" ref={scroll}>
        <History t={t} cap={phone ? 6 : 12} now={now} onReplyEmail={canComposeEmail(t) && !t.spam && (!t.ownerConfirmation || manualReply) && !busy ? openEmailReply : undefined}
          onForwardEmail={['arch', 'risedtc'].includes(t.client_id) && !busy ? setForwardEmail : undefined} />
        <Banners t={t} verbs={verbs} now={now} owed={owed} hasDraft={hasDraft} onNote={() => setSheet('context')} reload={reload} fuTick={fuTick} />
        <Draft t={t} edits={edits} setEdits={setEdits} save={saver.state} onBlur={() => void saver.flush()} onRetrySave={saver.retry} now={now} onRetry={reload} />
        {t.draft && <DraftWhy t={t} draft={t.draft} edited={edits.main} onRetry={reload} />}
        <RestoreStrip t={t} verbs={verbs} />
        {scheduledPending && <ScheduledSends t={t} reload={reload} onEdit={setSchedule} />}
      </div>
      <div className="dm-dock" ref={dock}>
        {draftRunning && <p className="dm-meta" role="status">Reading the conversation and writing a draft. It will appear here for review.</p>}
        {scheduleFailure && <p className="dm-meta" role="alert">{scheduleFailure}</p>}
        {draftError && <p className="dm-meta" role="alert">{draftError}</p>}
        {replyingByEmail && resolvedEmail?.error && <div className="dm-meta" role="alert"><span>{resolvedEmail.error}</span> <Btn className="dm-k" onClick={() => setEmailRetry(n => n + 1)}>Retry email details</Btn></div>}
        {!hasDraft && !t.spam && <Composer to={first} from={from} big={emailReplyFor === t.prospect_id} noSend note={composeNote} sendLabel={composeLabel} disabled={composeOff} value={reply} setValue={setReply} busy={busy || emailBlocked} onSend={() => void compose()} />}
        <div className="dm-keys">
          <div className="dm-keys-s">{!t.spam && !scheduledPending && !composeOff && !replyingByEmail && (hasDraft || reply.trim()) && <Btn verb="schedule-send" className="dm-k dm-schedule-key" disabled={busy} onClick={() => void openSchedule()}>{reply.trim() ? 'Schedule reply' : 'Schedule send'}</Btn>}{small}{more}</div>
          {primary}
        </div>
        {hasDraft && !t.spam && <Composer to={first} from={from} big={emailReplyFor === t.prospect_id} note={composeNote} sendLabel={composeLabel} disabled={composeOff} value={reply} setValue={setReply} busy={busy || emailBlocked} onSend={() => void compose()} />}
        {t.spam && <div className="dm-foot">Filed as a vendor pitch.</div>}
      </div>
      {menu && <ThreadMenu t={t} phone={phone} up={menu === 'keys'} withAsk={phone} staleN={staleN} onClose={() => setMenu(null)} run={menuRun} />}
      {schedule && <ScheduleSheet t={t} target={schedule} onClose={() => setSchedule(null)} onSaved={() => { if (schedule.manual) setReply(''); reload() }} />}
      {forwardEmail && <ForwardEmailSheet key={forwardEmail.id} message={forwardEmail} onClose={() => setForwardEmail(null)} />}
      {sheet === 'context' && <ContextSheet t={t} all={all} onClose={() => setSheet(null)} />}
      {sheet === 'agent' && <AgentSheet t={t} onClose={() => setSheet(null)} onChanged={reload} />}
    </section>
  )
}
