// The open conversation (desktop right pane / phone full page).
// Hooks first, always: no hook sits after an early return (09-09).
import { useEffect, useRef, useState } from 'react'
import { canComposeEmail, markThreadRead, threadBucket, unansweredWaitSince, type Thread as T } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { chatLink } from '../../components/CopyChatLink'
import { seatOf } from '../seats'
import { Key } from '../ui/Key'
import { Banners } from './ThreadBanners'
import { Draft } from './Draft'
import { DraftWhy } from './DraftWhy'
import { History } from './History'
import { Composer, HoldKey } from './Keys'
import { ThreadMenu, type MenuAct } from './Menu'
import { AgentSheet, ContextSheet } from './Sheets'
import { ThreadHead } from './ThreadHead'
import type { DmVerbs, Edits } from './verbs'

const FROM: Record<string, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }

function seed(t: T): Edits {
  return { main: t.draft?.message_text ?? '', email: t.draft?.email_mirror_text ?? null, companion: t.companionDraft?.message_text ?? null }
}

export async function copyText(s: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(s); return true } catch { window.prompt('Copy this link', s); return false }
}

export function ThreadPane({ t, all, phone, verbs, now, onBack, onAsk, onDraftIt, onMenu, staleN, pre, reload }: {
  t: T; all: readonly T[]; phone: boolean; verbs: DmVerbs; now: number
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
  useEffect(() => { setReply(''); setMenu(false); setSheet(null) }, [t.prospect_id])
  // Sanctioned read stamp on real inbound rows, as today.
  useEffect(() => { if (t.unread > 0) markThreadRead(t.prospect_id).catch(() => {}) }, [t.prospect_id, t.unread])

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
  const copy = async () => { const l = chatLink(t.chat_provider_id, t.linkedin_url); if (l && await copyText(l.href)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) } }
  const send = (held: boolean) => run(async () => { await verbs.send(t, edits, held); setEditing(false) })
  const compose = (held: boolean) => run(async () => { if (await verbs.compose(t, reply, held)) setReply('') })
  const menuRun = (a: MenuAct) => {
    if (a === 'context') setSheet('context')
    else if (a === 'agent') setSheet('agent')
    else if (a === 'copy-chat') void copy()
    else if (a === 'sum') pre.run(t)
    else onMenu(a)
  }
  const ps = pre.get(t.prospect_id)

  let keys
  if (t.spam) keys = <>
    <Key verb="not-spam" disabled={busy} onClick={() => run(() => verbs.notSpam(t))}>Not spam</Key>
    {t.chat_provider_id && <Key verb="delete-seat" disabled={busy} className="dm-key-warn" onClick={() => run(async () => { if (await verbs.deleteSeat(t)) onBack() })}>Delete from seat</Key>}
  </>
  else if (hasDraft && !t.ownerConfirmation) keys = <>
    <Key verb="discard" disabled={busy} onClick={() => run(() => verbs.discard(t))}>Discard</Key>
    {t.draftSnoozedUntil === null && <Key verb="later" disabled={busy} onClick={() => run(() => verbs.later(t, edits))}>Later</Key>}
    {editing ? <Key verb="save-edit" disabled={busy} onClick={() => run(async () => { if (!(await verbs.saveEdit(t, edits))) setEditing(false) })}>Save</Key>
      : <Key verb="edit" disabled={busy} onClick={() => setEditing(true)}>Edit</Key>}
    <HoldKey verb="send" disabled={busy} onPress={() => void send(false)} onHold={() => void send(true)}>{t.companionDraft ? 'Send both' : 'Send'}</HoldKey>
  </>
  else keys = <>
    {t.ownerConfirmation
      ? <Key verb="ask-owner-link" onClick={() => void copy()} sub="copies the chat link">{seat === 'ivan' ? 'Copy chat link' : `Ask ${from}`}</Key>
      : owed && <Key verb="draft-it" onClick={onDraftIt} sub="Claude writes">Draft it</Key>}
    {dated && !t.ownerConfirmation && <Key verb="follow-up-date" disabled={busy} sub="on a date" onClick={() => run(async () => { await verbs.followUp(t, null, ''); reload() })}>Follow up</Key>}
    {!composeOff && <HoldKey verb="compose-send" disabled={busy || !reply.trim()} onPress={() => void compose(false)} onHold={() => void compose(true)}>Send</HoldKey>}
  </>

  const foot = t.spam ? 'Filed as a vendor pitch. Not spam puts it back in Needs you; Delete from seat removes the LinkedIn chat.'
    : hasDraft ? (phone ? 'Hold Send to send. Discard asks first.' : "Discard offers two keys: Discard, or Discard and I'll reply myself.")
      : 'Spam, Not spam and Delete from seat are under ⋯.'

  return (
    <section className={`dm-pane${phone ? ' dm-pane-phone' : ''}`} aria-label={`Conversation with ${t.prospect_name}`}>
      <ThreadHead t={t} phone={phone} onBack={onBack} onCopy={() => void copy()} copied={copied} onAsk={onAsk} onMore={() => setMenu(m => !m)} moreOpen={menu} />
      {ps.s !== 'none' && <div className="dm-sum" role="status">{ps.s === 'done' ? ps.line : ps.s === 'running' ? 'Reading it…' : ps.why}</div>}
      <History t={t} cap={phone ? 4 : 6} />
      <div className="dm-scroll">
        <Banners t={t} verbs={verbs} now={now} owed={owed} hasDraft={hasDraft} onNote={() => setSheet('context')} reload={reload} />
        <Draft t={t} edits={edits} setEdits={setEdits} editing={editing} now={now} />
        {t.draft && !editing && <DraftWhy t={t} draft={t.draft} />}
        {!hasDraft && !t.spam && <Composer to={first} from={from} big disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose(false)} onHoldSend={() => void compose(true)} />}
      </div>
      <div className="dm-keys">
        {phone && <button type="button" className="dm-claudekey" aria-label={`Ask Claude about ${first}`} data-verb="ask-claude" onClick={onAsk}><svg viewBox="0 0 24 24" className="d-ico" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" /></svg></button>}
        {keys}
      </div>
      {hasDraft && !t.spam && <Composer to={first} from={from} big={false} disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose(false)} onHoldSend={() => void compose(true)} />}
      <div className="dm-foot">{foot}</div>
      {menu && <ThreadMenu t={t} phone={phone} staleN={staleN} onClose={() => setMenu(false)} run={menuRun} />}
      {sheet === 'context' && <ContextSheet t={t} all={all} onClose={() => setSheet(null)} />}
      {sheet === 'agent' && <AgentSheet t={t} onClose={() => setSheet(null)} />}
    </section>
  )
}
