// A list row's ⋯ (today's per-row affordances: Sum up, copy chat link, Discard with its confirm;
// plus Ask Claude, as the rebuild's phone long-press sheet had). A sheet on both layouts, so the
// row keeps one visible key and nothing hides behind a hover.
import { useState } from 'react'
import { preReadWorthwhile, waitingDays } from '../../exp/v2c/chat/preread'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { chatLink } from '../../components/CopyChatLink'
import type { Thread } from '../../lib/inbox'
import { seatOf, SEAT_NAME } from '../seats'
import { Sheet } from '../ui/Sheet'
import { copyText } from './Thread'
import type { DmVerbs } from './verbs'
import { canMarkSolved } from './solved'
import { editsOf, laterPath } from './later'
import type { CameTag } from './signals'

export function RowMenu({ t, pre, verbs, onClose, onOpen, onAsk, came = null, onDismissCame }: {
  t: Thread; pre: PreReadHandle; verbs: DmVerbs; onClose: () => void; onOpen: () => void; onAsk: () => void
  /** The came-back tag on this person, if any: its Dismiss lives here too. */
  came?: CameTag | null; onDismissCame?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const link = chatLink(t.chat_provider_id, t.linkedin_url)
  const st = pre.get(t.prospect_id)
  const days = waitingDays(t)
  const seat = seatOf(t.client_id)
  const item = (verb: string, label: string, hint: string | null, run: () => void, danger = false) => (
    <button type="button" role="menuitem" className={`dm-mi${danger ? ' dm-mi-danger' : ''}`} data-verb={verb} onClick={run}><span>{label}</span>{hint && <small>{hint}</small>}</button>
  )
  return (
    <Sheet open onClose={onClose} title={t.prospect_name} sub={[t.prospect_company, seat ? SEAT_NAME[seat] : null].filter(Boolean).join(' · ')} label={`More for ${t.prospect_name}`}>
      <div className="dm-menu-sheet" role="menu">
        {item('row-open', 'Open the conversation', null, () => { onClose(); onOpen() })}
        {preReadWorthwhile(t) && st.s !== 'running' && item('row-sum', st.s === 'error' ? 'Sum up again' : st.s === 'done' ? 'Sum up again' : 'Sum up',
          days === null ? 'what this one is about, without opening it' : `waiting ${days} days · without opening it`, () => { pre.run(t); onClose() })}
        {st.s === 'done' && <p className="dm-qnote" style={{ padding: '4px 14px 8px' }}>{st.line}</p>}
        {link && item('row-copy-chat', copied ? 'Copied' : link.isChat ? 'Copy chat link' : 'Copy profile link', 'for Mattan or Davorin', () => { void copyText(link.href).then(ok => { if (ok) { setCopied(true); window.setTimeout(onClose, 700) } }) })}
        {item('row-ask', 'Ask Claude', 'with this person attached', () => { onClose(); onAsk() })}
        {laterPath(t) && item('row-later', 'Later', laterPath(t) === 'followup' ? 'a follow-up drafts on the day you pick' : 'out of your queue until the day you pick', () => { onClose(); void verbs.later(t, editsOf(t)) })}
        {came && onDismissCame && item('row-came-dismiss', 'Dismiss came back', came.text, () => { onClose(); onDismissCame() })}
        {canMarkSolved(t) && item('row-solved', 'Mark as solved', 'no reply needed · Undo on the receipt', () => { onClose(); void verbs.solved(t) })}
        {t.draft && item('row-discard', t.companionDraft ? 'Discard both drafts' : 'Discard the draft', 'asks first', () => { onClose(); void verbs.rowDiscard(t) }, true)}
      </div>
    </Sheet>
  )
}
