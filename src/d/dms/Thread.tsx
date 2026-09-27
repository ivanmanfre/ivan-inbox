// The open conversation (desktop right pane / phone full page).
// Hooks first, always: no hook sits after an early return (09-09).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDCommands } from '../shell/commands'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { canComposeEmail, markThreadRead, threadBucket, unansweredWaitSince, type Thread as T } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { chatLink } from '../../components/CopyChatLink'
import { seatOf } from '../seats'
import { Btn, Key } from '../ui/Key'
import { laterPath } from './later'
import { useAutosave } from './useAutosave'
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

export function ThreadPane({ t, auto = false, all, phone, verbs, now, onBack, onAsk, onDraftIt, onMenu, staleN, pre, reload, signal }: {
  t: T; auto?: boolean; all: readonly T[]; phone: boolean; verbs: DmVerbs; now: number
  onBack: () => void; onAsk: () => void; onDraftIt: () => void
  onMenu: (a: MenuAct) => void; staleN: number; pre: PreReadHandle; reload: () => void
  /** The came-back tag beside the name, with its Dismiss (cameBack.ts). */
  signal?: ReactNode
}) {
  const [edits, setEdits] = useState<Edits>(() => seed(t))
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<'top' | 'keys' | null>(null)
  const [sheet, setSheet] = useState<'context' | 'agent' | null>(null)
  const [copied, setCopied] = useState(false)
  const [fuTick, setFuTick] = useState(0)
  const seeded = useRef({ id: '', text: '' })
  const scroll = useRef<HTMLDivElement>(null)
  const draftId = t.draft?.id ?? ''
  const draftText = t.draft?.message_text ?? ''

  // Re-seed on a new draft row, or when the same row's text changed under an untouched editor.
  useEffect(() => {
    const was = seeded.current
    if (draftId !== was.id) setEdits(seed(t))
    else setEdits(e => (e.main === was.text ? { ...e, main: draftText } : e))
    seeded.current = { id: draftId, text: draftText }
  }, [draftId, draftText]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReply(''); setMenu(null); setSheet(null) }, [t.prospect_id])
  // Open at the newest message, as a chat does (desktop: the pane scrolls; phone: the page does).
  useEffect(() => { const el = scroll.current; if (el && !phone) el.scrollTop = el.scrollHeight }, [t.prospect_id, phone])
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
  // A verb that writes the draft itself carries the text on screen; a pending autosave is dropped.
  const send = () => run(async () => { saver.cancel(); await verbs.send(t, edits) })
  const later = () => run(async () => { saver.cancel(); await verbs.later(t, edits); setFuTick(x => x + 1) })
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
    primary = <Key primary verb="send" className="dm-send" disabled={busy} onClick={() => void send()}>{t.companionDraft ? 'Send both' : 'Send'}</Key>
  } else {
    small = <>
      {t.ownerConfirmation
        ? <Btn verb="ask-owner-link" className="dm-k" onClick={() => void copy()} title="copies the chat link">{seat === 'ivan' ? 'Copy chat link' : `Ask ${from}`}</Btn>
        : owed && <Btn verb="draft-it" className="dm-k" onClick={onDraftIt} title="Claude writes it">Draft it</Btn>}
      {laterKey}
      {canMarkSolved(t) && solvedKey}
    </>
    if (!composeOff) primary = <Key primary verb="compose-send" className="dm-send" disabled={busy || !reply.trim()} onClick={() => void compose()}>Send</Key>
  }

  return (
    <section className={`dm-pane${phone ? ' dm-pane-phone' : ''}`} aria-label={`Conversation with ${t.prospect_name}`}>
      <ThreadHead t={t} phone={phone} onBack={onBack} onCopy={() => void copy()} copied={copied} onAsk={onAsk} onMore={() => setMenu(m => (m ? null : 'top'))} moreOpen={menu === 'top'}
        onWho={() => setSheet('context')} onDelete={t.chat_provider_id && !t.spam ? () => void run(async () => { if (await verbs.deleteSeat(t)) onBack() }) : undefined} deleting={busy}
        onSpam={!t.spam && seat !== 'ivan' ? () => void run(() => verbs.spam(t)) : undefined} signal={signal} />
      {ps.s !== 'none' && <div className="dm-sum" role="status">{ps.s === 'done' ? ps.line : ps.s === 'running' ? 'Reading it…' : ps.why}</div>}
      <div className="dm-scroll" ref={scroll}>
        <History t={t} cap={phone ? 6 : 12} now={now} />
        <Banners t={t} verbs={verbs} now={now} owed={owed} hasDraft={hasDraft} onNote={() => setSheet('context')} reload={reload} fuTick={fuTick} />
        <Draft t={t} edits={edits} setEdits={setEdits} save={saver.state} onBlur={() => void saver.flush()} onRetrySave={saver.retry} now={now} onRetry={reload} />
        {t.draft && <DraftWhy t={t} draft={t.draft} edited={edits.main} onRetry={reload} />}
        <RestoreStrip t={t} verbs={verbs} />
      </div>
      <div className="dm-dock">
        {!hasDraft && !t.spam && <Composer to={first} from={from} big={false} noSend disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose()} />}
        <div className="dm-keys">
          <div className="dm-keys-s">{small}{more}</div>
          {primary}
        </div>
        {hasDraft && !t.spam && <Composer to={first} from={from} big={false} disabled={composeOff} value={reply} setValue={setReply} busy={busy} onSend={() => void compose()} />}
        {t.spam && <div className="dm-foot">Filed as a vendor pitch.</div>}
      </div>
      {menu && <ThreadMenu t={t} phone={phone} up={menu === 'keys'} withAsk={phone} staleN={staleN} onClose={() => setMenu(null)} run={menuRun} />}
      {sheet === 'context' && <ContextSheet t={t} all={all} onClose={() => setSheet(null)} />}
      {sheet === 'agent' && <AgentSheet t={t} onClose={() => setSheet(null)} onChanged={reload} />}
    </section>
  )
}
