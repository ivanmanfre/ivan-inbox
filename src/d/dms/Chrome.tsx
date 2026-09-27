// The page's answer row, folder bar (Conversations / Email / Likely spam, tokens, health line)
// and the bulk bar for selected rows.
import type { Thread } from '../../lib/inbox'
import { dmNumbers, type FrameCounts } from '../counts/useFrameCounts'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { AnswerRow, N } from '../ui/AnswerRow'
import { Btn } from '../ui/Key'
import { warsawHm } from '../ui/time'
import type { Mode } from './Column'
import type { SeatView } from './model'
import { TokenBar } from './Search'
import type { DmsData } from './useDmsData'
import type { FilterToken } from '../../lib/filterTokens'

export function Headline({ mode, views, counts, tools }: { mode: Mode; views: Record<Seat, SeatView>; counts: FrameCounts; tools?: React.ReactNode }) {
  const needs = dmNumbers(counts, 'needs')
  if (mode === 'spam') {
    return <AnswerRow title={<>Likely spam: <N v={views.risedtc.spam.length} /> Mattan's, <N v={views.arch.spam.length} /> Davorin's.</>} tools={tools} />
  }
  if (mode === 'email') {
    return <AnswerRow title={<>Email waiting on you: <N v={views.ivan.emailWaiting.length} /> yours, <N v={views.risedtc.emailWaiting.length} /> Mattan's, <N v={views.arch.emailWaiting.length} /> Davorin's.</>} tools={tools} />
  }
  const nd = SEATS.map(s => views[s].nodraft.length)
  // One headline; the sub line only when a thread still has no draft (work Ivan must start).
  const sub = nd.some(Boolean) ? `No draft yet: ${SEATS.flatMap((s, i) => (nd[i] ? [`${SEAT_NAME[s]} ${nd[i]}`] : [])).join(', ')}.` : undefined
  return <AnswerRow title={<>Needs you: <N v={needs.ivan} /> yours, <N v={needs.risedtc} /> Mattan's, <N v={needs.arch} /> Davorin's.</>} sub={sub} tools={tools} />
}

export function Health({ data }: { data: DmsData }) {
  if (data.error && data.loadedAt == null && !data.threads.length) return null
  if (data.error) return <span className="dm-live dm-live-bad">Could not refresh{data.loadedAt ? ` · last read ${warsawHm(data.loadedAt)}` : data.cachedAt ? ` · saved copy ${warsawHm(data.cachedAt)}` : ''} <Btn verb="retry" onClick={data.refreshAll}>Retry</Btn></span>
  // Live and fresh says nothing (the time stays in the tooltip); only a saved copy, a read or a failure speaks.
  if (data.loadedAt) return <span className="dm-live" title={`Live · read ${warsawHm(data.loadedAt)}`} />
  if (data.fromCache) return <span className="dm-live">Saved copy{data.cachedAt ? ` from ${warsawHm(data.cachedAt)}` : ''} · reading…</span>
  return <span className="dm-live">Reading…</span>
}

/** Any thread in the list carries an unread inbound (the same signal as a row's dot). */
export function anyUnread(ts: readonly Thread[]): boolean {
  return ts.some(t => t.unread > 0)
}

const Dot = ({ on }: { on: boolean }) => on ? <span className="dm-fdot" role="img" aria-label="unread" /> : null

export function Folders({ folder, setFolder, views, phone }: { folder: string | null; setFolder: (f: string | null) => void; views: Record<Seat, SeatView>; phone?: boolean }) {
  // Waiting only (emailFolder.ts): an old archived reply nobody stamped read never lights it.
  const emailDot = SEATS.some(s => anyUnread(views[s].emailWaiting))
  const spamDot = anyUnread(views.risedtc.spam) || anyUnread(views.arch.spam)
  return (
    <span className={`dm-folders${phone ? ' dm-folders-phone' : ''}`} role="tablist" aria-label="Folders">
      <button type="button" role="tab" aria-selected={!folder} className={`dm-fd${!folder ? ' dm-on' : ''}`} onClick={() => setFolder(null)}>Conversations</button>
      <button type="button" role="tab" aria-selected={folder === 'email'} className={`dm-fd${folder === 'email' ? ' dm-on' : ''}`} onClick={() => setFolder('email')} data-unread={emailDot ? 'true' : undefined}>
        <Dot on={emailDot} />Email <small>{SEATS.map(s => <span key={s}>{SEAT_NAME[s]} <b>{views[s].emailWaiting.length}</b> </span>)}</small>
      </button>
      <button type="button" role="tab" aria-selected={folder === 'spam'} className={`dm-fd${folder === 'spam' ? ' dm-on' : ''}`} onClick={() => setFolder('spam')} data-unread={spamDot ? 'true' : undefined}>
        <Dot on={spamDot} />Likely spam <small>Rise <b>{views.risedtc.spam.length}</b> Arch <b>{views.arch.spam.length}</b></small>
      </button>
    </span>
  )
}

export function Bar({ folder, setFolder, views, tokens, setTokens, data }: {
  folder: string | null; setFolder: (f: string | null) => void; views: Record<Seat, SeatView>
  tokens: FilterToken[]; setTokens: (t: FilterToken[]) => void; data: DmsData
}) {
  return (
    <div className="dm-bar">
      <Folders folder={folder} setFolder={setFolder} views={views} />
      <span className="dm-sep" />
      <TokenBar tokens={tokens} setTokens={setTokens} />
      <span className="dm-grow" />
      <Health data={data} />
    </div>
  )
}

export function BulkBar({ checked, byId, clear, onDiscard }: { checked: Set<string>; byId: ReadonlyMap<string, Thread>; clear: () => void; onDiscard: (ts: Thread[]) => void }) {
  if (!checked.size) return null
  const ts = [...checked].map(id => byId.get(id)).filter((t): t is Thread => Boolean(t))
  const withDraft = ts.filter(t => t.draft)
  return (
    <div className="dm-bulk" role="region" aria-label="Selected conversations">
      <span><b>{checked.size}</b> selected{withDraft.length !== ts.length ? ` · ${withDraft.length} with a draft` : ''}</span>
      <Btn verb="bulk-discard" disabled={!withDraft.length} onClick={() => onDiscard(withDraft)}>Discard {withDraft.length} draft{withDraft.length === 1 ? '' : 's'}</Btn>
      <Btn verb="bulk-clear" onClick={clear}>Clear</Btn>
    </div>
  )
}
