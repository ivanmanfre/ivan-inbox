// The open conversation (desktop right pane / phone full page).
// Hooks first, always: no hook sits after an early return (09-09).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDCommands } from '../shell/commands'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { canComposeEmail, markThreadRead, threadBucket, unansweredWaitSince, type Thread as T } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { chatLink } from '../../components/CopyChatLink'
import { seatOf } from '../seats'
import { Key } from '../ui/Key'
import { Banners } from './ThreadBanners'
import { Draft } from './Draft'
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
  return { main: t.draft?.message_text ?? '', email: t.draft?.email_mirror_text ?? null, companion: t.companionDraft?.message_text ?? null }
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

export function ThreadPane({ t, auto = false, all, phone, verbs, now, onBack, onAsk, onDraftIt, onMenu, staleN, pre, reload }: {
  t: T; auto?: boolean; all: readonly T[]; phone: boolean; verbs: DmVerbs; now: number
  onBack: () => void; onAsk: () => void; onDraftIt: () => void
  onMenu: (a: MenuAct) => void; staleN: number; pre: PreReadHandle; reload: () => void
}) {
  const [edits, setEdits] = useState<Edits>(() => seed(t))
  const [editing, setEditing] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [sheet, setSheet] = useState<'context' | 'agent' | null>(null)
  const [copied, setCopied] = useState(false)
  const [fuOpen, setFuOpen] = useState(false)
  const seeded = useRef({ id: '', text: '' })
  const draftId = t.draft?.id ?? ''
  const draftText = t.draft?.message_text ?? ''

  // Re-seed on a new draft row, or when the same row's text changed under an untouched editor.
  useEffect(() => {
    const was = seeded.current
    if (draftId !== was.id) { setEdits(seed(t)); setEditing(false) }
    else setEdits(e => (e.main === was.text ? { ...e, main: draftText } : e))
    seeded.current = { id: draftId, text: draftText }
  }, [draftId, draftText]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReply(''); setMenu(false); setSheet(null); setFuOpen(false) }, [t.prospect_id])
  // Sanctioned read stamp on real inbound rows, as today. Once per thread and unread set: a remount
  // (the phone page, React's dev double effect) must not PATCH read_at a second time.
  const lastIn = t.messages.filter(m => m.direction === 'inbound').at(-1)?.id ?? ''
  useEffect(() => { if (!auto && t.unread > 0) stampReadOnce(t.prospect_id, lastIn) }, [auto, t.prospect_id, t.unread, lastIn])

  const seat = seatOf(t.client_id) ?? 'ivan'
  const from = FROM[seat]
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  const owed = threadBucket(t, now) !== 'waiting' || unansweredWaitSince(t) !== null
  const hasDraft = t.draft !== null
  const dated = seat !== 'ivan'
  const composeOff = t.ownerConfirmation ? 'Reply paused while an internal fact is confirmed. Add the answer as a note, or discard the question.'
    : t.channel === 'email' && !canComposeEmail(t) ? 'Email compose is on for Arch threads only. Approving email drafts works here.'
      : t.stage === 'engaged' ? 'Not connected yet. A reply here would go out as a connection invite, so compose is off for this thread.' : null

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
  const send = () => run(async () => { await verbs.send(t, edits); setEditing(false) })
  const compose = () => run(async () => { if (await verbs.compose(t, reply)) setReply('') })
  const menuRun = (a: MenuAct) => {
    if (a === 'context') setSheet('context')
    else if (a === 'agent') setSheet('agent')
    else if (a === 'copy-chat') void copy()
    else if (a === 'sum') pre.run(t)
    else if (a === 'ask') onAsk()
    else onMenu(a)
  }
  const ps = pre.get(t.prospect_id)

  const solvedKey = <Key verb="solved" className="dm-key-solved" disabled={busy} onClick={() => run(() => verbs.solved(t))}>{phone ? 'Solved' : 'Mark as solved'}</Key>
  let keys
  if (t.spam) keys = <>
    <Key verb="not-spam" disabled={busy} onClick={() => run(() => verbs.notSpam(t))}>Not spam</Key>
    {t.chat_provider_id && <Key verb="delete-seat" disabled={busy} className="dm-key-warn" onClick={() => run(async () => { if (await verbs.deleteSeat(t)) onBack() })}>Delete from seat</Key>}
  </>
  else if (hasDraft && !t.ownerConfirmation) keys = <>
    {solvedKey}
    <Key verb="discard" disabled={busy} onClick={() => run(() => verbs.discard(t))}>Discard</Key>
    {t.draftSnoozedUntil === null && <Key verb="later" disabled={busy} onClick={() => run(() => verbs.later(t, edits))}>Later</Key>}
    {editing ? <Key verb="save-edit" disabled={busy} onClick={() => run(async () => { if (!(await verbs.saveEdit(t, edits))) setEditing(false) })}>Save</Key>
      : <Key verb="edit" disabled={busy} onClick={() => setEditing(true)}>Edit</Key>}
    <Key primary verb="send" disabled={busy} onClick={() => void send()}>{t.companionDraft ? 'Send both' : 'Send'}</Key>
  </>
  else keys = <>
    {canMarkSolved(t) && solvedKey}
    {t.ownerConfirmation
      ? <Key verb="ask-owner-link" onClick={() => void copy()} sub="copies the chat link">{seat === 'ivan' ? 'Copy chat link' : `Ask ${from}`}</Key>
      : owed && <Key verb="draft-it" onClick={onDraftIt} sub="Claude writes">Draft it</Key>}
    {dated && !t.ownerConfirmation && <Key verb="follow-up-date" disabled={busy} sub="on a date" onClick={() => setFuOpen(true)}>Follow up</Key>}
    {!composeOff && <Key primary verb="compose-send" disabled={busy || !reply.trim()} onClick={() => void compose()}>Send</Key>}
  </>

  // The keys speak for themselves (Send and Discard both ask first); only a thread's spam state is said.
  const foot = t.spam ? 'Filed as a vendor pitch.' : null

  return (
    <section className={`dm-pane${phone ? ' dm-pane-phone' : ''}`} aria-label={`Conversation with ${t.prospect_name}`}>
      <ThreadHead t={t} phone={phone} onBack={onBack} onCopy={() => void copy()} copied={copied} onAsk={onAsk} onMore={() => setMenu(m => !m)} moreOpen={menu}
        onWho={() => setSheet('context')} onDelete={t.chat_provider_id && !t.spam ? () => void run(async () => { if (await verbs.deleteSeat(t)) onBack() }) : undefined} deleting={busy}
        onSpam={!t.spam && seat !== 'ivan' ? () => void run(() => verbs.spam(t)) : undefined} />
      {ps.s !== 'none' && <div className="dm-sum" role="status">{ps.s === 'done' ? ps.line : ps.s === 'running' ? 'Reading it…' : ps.why}</div>}
      <History t={t} cap={phone ? 4 : 6} />
      <div className="dm-scroll">
        <Banners t={t} verbs={verbs} now={now} owed={owed} hasDraft={hasDraft} onNote={() => setSheet('context')} reload={reload} fuOpen={fuOpen} setFuOpen={setFuOpen} />
        <Draft t={t} edits={edits} setEdits={setEdits} editing={editing} now={now} onRetry={reload} />
        {t.draft && <DraftWhy t={t} draft={t.draft} edited={edits.main} onRetry={reload} />}
        <RestoreStrip t={t} verbs={verbs} />
        {!hasDraft && !t.spam && <Composer to={first} from={from} big disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose()} />}
      </div>
      <div className="dm-keys">
        {keys}
      </div>
      {hasDraft && !t.spam && <Composer to={first} from={from} big={false} disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose()} />}
      {foot && <div className="dm-foot">{foot}</div>}
      {menu && <ThreadMenu t={t} phone={phone} withAsk={phone} staleN={staleN} onClose={() => setMenu(false)} run={menuRun} />}
      {sheet === 'context' && <ContextSheet t={t} all={all} onClose={() => setSheet(null)} />}
      {sheet === 'agent' && <AgentSheet t={t} onClose={() => setSheet(null)} onChanged={reload} />}
    </section>
  )
}
