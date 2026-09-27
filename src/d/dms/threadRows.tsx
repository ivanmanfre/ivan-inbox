// A thread as a row, one renderer per list kind (the mock's row(t, kind)).
import type { ReactNode } from 'react'
import { canRestore, eventTime, type Thread } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'
import { warsawDay, warsawDm, warsawDow, warsawHm } from '../ui/time'
import { ago, firstLine, flat, lastDiscard, owedSince, rowTags } from './model'
import { Row } from './Row'
import type { DmVerbs } from './verbs'
import type { CameTag } from './signals'

export const dayMonth = (iso: string) => `${warsawDow(iso)} ${warsawDm(iso)}`

/** Today -> 10:12; this week -> Sat 10:12; older -> Sat 14 Sep. */
export function when(iso: string, now: number = Date.now()): string {
  if (warsawDay(iso) === warsawDay(now)) return warsawHm(iso)
  if (now - Date.parse(iso) < 6 * 86_400_000) return `${warsawDow(iso)} ${warsawHm(iso)}`
  return dayMonth(iso)
}

export type RowCtx = { selected: string | null; checked: ReadonlySet<string>; open: (t: Thread) => void; now: number; verbs: DmVerbs; busy: string | null; setBusy: (id: string | null) => void; fail: (m: string) => void
  pre: PreReadHandle; more: (t: Thread) => void
  /** Came-back tags by person (signals.ts): shown beside the name on every row of theirs. */
  came?: ReadonlyMap<string, CameTag> }

/** The row extras every conversation row carries: unread dot, ⋯ key, the Sum up line, the came-back tag. */
export function extras(t: Thread, c: RowCtx): { unread: boolean; onMore: () => void; note: ReactNode; signal: CameTag | null } {
  const st = c.pre.get(t.prospect_id)
  const note = st.s === 'done' ? st.line : st.s === 'running' ? 'Reading it…' : st.s === 'error' ? st.why : null
  return { unread: t.unread > 0, onMore: () => c.more(t), note, signal: c.came?.get(t.prospect_id) ?? null }
}

export function DraftRow({ t, c }: { t: Thread; c: RowCtx }) {
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} tags={rowTags(t)}
    line={firstLine(t.draft?.message_text)} right={ago(eventTime(t.draft ?? t.last), c.now)} rightKind="needs"
    selected={c.selected === t.prospect_id} checked={c.checked.has(t.prospect_id)} onOpen={() => c.open(t)} />
}

export function NoDraftRow({ t, c }: { t: Thread; c: RowCtx }) {
  const lastIn = t.messages.filter(m => m.direction === 'inbound').at(-1)
  const since = t.ownerConfirmation ? eventTime(t.ownerConfirmation) : owedSince(t)
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} tags={rowTags(t, { nodraft: !t.ownerConfirmation })}
    line={flat(lastIn?.message_text)} right={since ? ago(since, c.now) : ''} rightKind="needs"
    selected={c.selected === t.prospect_id} checked={c.checked.has(t.prospect_id)} onOpen={() => c.open(t)} />
}

export function LaterRow({ t, c }: { t: Thread; c: RowCtx }) {
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} tags={rowTags(t)}
    line={firstLine(t.draft?.message_text)} right={t.draftSnoozedUntil ? dayMonth(t.draftSnoozedUntil) : ''} rightKind="later"
    selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />
}

export function SentRow({ t, c, note }: { t: Thread; c: RowCtx; note?: string | null }) {
  const out = t.messages.filter(m => m.direction === 'outbound' && m.sent_at).at(-1)
  const text = out ? `You: ${flat(out.message_text)}` : flat(t.last.message_text)
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} dim
    line={note ? <><span className="dm-scan">{note}</span> {text}</> : text} right={when(eventTime(t.last), c.now)}
    selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />
}

export function ThrownRow({ t, c }: { t: Thread; c: RowCtx }) {
  const d = lastDiscard(t)
  if (!d?.send_blocked_at) return null
  const ok = canRestore(t, d)
  const line = `discarded ${warsawDow(d.send_blocked_at)} ${warsawHm(d.send_blocked_at)}${d.discard_mode === 'reply_myself' ? ", you'll reply yourself" : ''}`
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} line={line}
    verbs={ok ? [{ label: 'Bring back', verb: 'bring-back', busy: c.busy === d.id, run: () => { c.setBusy(d.id); void c.verbs.bringBack(t, d).finally(() => c.setBusy(null)) } }] : undefined}
    right={ok ? undefined : 'written since'}
    selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />
}

export function SpamRow({ t, c }: { t: Thread; c: RowCtx }) {
  const lastIn = t.messages.filter(m => m.direction === 'inbound').at(-1)
  return <Row {...extras(t, c)} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} tags={rowTags(t)} line={flat(lastIn?.message_text)}
    verbs={[{ label: 'Not spam', verb: 'not-spam', busy: c.busy === t.prospect_id, run: () => { c.setBusy(t.prospect_id); void c.verbs.notSpam(t).finally(() => c.setBusy(null)) } }]}
    selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />
}

/** A search match or an email thread: owed ones read like Needs you, the rest like Sent. */
export function AnyRow({ t, c, owed }: { t: Thread; c: RowCtx; owed: boolean }) {
  if (!owed) return <SentRow t={t} c={c} />
  return t.draft ? <DraftRow t={t} c={c} /> : <NoDraftRow t={t} c={c} />
}
