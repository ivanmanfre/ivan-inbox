// The thread's ⋯ menu (mock `.df-menu`; phone: a bottom sheet with the same items).
import { useEffect, useRef, type ReactNode } from 'react'
import type { Thread } from '../../lib/inbox'
import { seatOf, SEAT_NAME } from '../seats'
import { Sheet } from '../ui/Sheet'

export type MenuAct = 'ask' | 'sum' | 'copy-chat' | 'context' | 'agent' | 'spam' | 'not-spam' | 'delete-seat' | 'select' | 'stale-discard' | 'copy-thread'

type Item = { act: MenuAct; label: string; hint?: string; danger?: boolean }

export function menuItems(t: Thread, staleN: number, withAsk = false): { head: string; items: Item[] }[] {
  const seat = seatOf(t.client_id)
  const owner = seat === 'risedtc' ? 'Mattan' : seat === 'arch' ? 'Davorin' : 'Mattan or Davorin'
  const filing: Item[] = []
  if (t.spam) filing.push({ act: 'not-spam', label: 'Not spam', hint: 'back to Needs you' })
  else if (seat !== 'ivan') filing.push({ act: 'spam', label: 'Spam' })
  if (t.chat_provider_id) filing.push({ act: 'delete-seat', label: 'Delete from seat', danger: true })
  return [
    { head: 'This conversation', items: [
      ...(withAsk ? [{ act: 'ask' as const, label: 'Ask Claude', hint: 'with this person attached' }] : []),
      { act: 'sum', label: 'Sum up', hint: 'Claude reads it' },
      { act: 'copy-chat', label: 'Copy chat link', hint: `for ${owner}` },
      { act: 'context', label: 'Context', hint: 'fit, scan, your note' },
      { act: 'agent', label: 'Conversation agent', hint: 'Take over, approve, Stop contact' },
    ] },
    ...(filing.length ? [{ head: 'Filing', items: filing }] : []),
    { head: 'This list', items: [
      { act: 'select', label: 'Select several', hint: 'x' },
      ...(staleN ? [{ act: 'stale-discard' as const, label: 'Discard stale drafts', hint: `${staleN} where you already replied, this seat`, danger: true }] : []),
      { act: 'copy-thread', label: 'Copy link to this thread' },
    ] },
  ]
}

function List({ groups, run }: { groups: ReturnType<typeof menuItems>; run: (a: MenuAct) => void }) {
  return <>
    {groups.map(g => (
      <div key={g.head} role="group" aria-label={g.head}>
        <div className="dm-mhd">{g.head}</div>
        {g.items.map(i => (
          <button key={i.act} type="button" role="menuitem" className={`dm-mi${i.danger ? ' dm-mi-danger' : ''}`} data-verb={i.act} onClick={() => run(i.act)}>
            <span>{i.label}</span>{i.hint && <small>{i.hint}</small>}
          </button>
        ))}
      </div>
    ))}
    <div className="dm-mhd dm-mhd-keys">Keys: j k move · x select · / search · ⌘J Claude</div>
  </>
}

export function ThreadMenu({ t, phone, up = false, withAsk = false, staleN, onClose, run }: { t: Thread; phone: boolean; up?: boolean; withAsk?: boolean; staleN: number; onClose: () => void; run: (a: MenuAct) => void }) {
  const groups = menuItems(t, staleN, withAsk)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (phone) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-verb="more"]')) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [phone, onClose])
  const go = (a: MenuAct) => { onClose(); run(a) }
  const seat = seatOf(t.client_id)
  const sub: ReactNode = [t.prospect_company, seat ? SEAT_NAME[seat] : null].filter(Boolean).join(' · ')
  if (phone) return <Sheet open onClose={onClose} title={t.prospect_name} sub={sub} side="bottom"><div className="dm-menu-sheet" role="menu"><List groups={groups} run={go} /></div></Sheet>
  return <div ref={box} className={`dm-menu${up ? ' dm-menu-up' : ''}`} role="menu" aria-label="More for this conversation"><List groups={groups} run={go} /></div>
}
