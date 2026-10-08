import React, { useState } from 'react'
import type { ReadState, ReplyScope, ReplySource, SourceDetail } from '../../lib/replySources'
import { touchLabel } from '../../lib/replySources'
import { useReplySource } from '../../hooks/useReplySources'
import { ReadNotice, replyTimestamp, replyDisplayZone, SnapshotNotice } from '../lanes/ReplySources'
import '../lanes/replySources.css'

const REASONS: Record<string, string> = {
  no_prior_send: 'No preceding source send', reply_time_tie: 'First reply order is ambiguous',
  outbound_time_tie: 'Source send order is ambiguous', unlocated_later_send: 'A later send has no provider chat',
  unfinished_action: 'The source send was incomplete at reply time', unknown_channel: 'Channel not established',
  receipt_identity_conflict: 'Conflicting person identity for a provider receipt',
  receipt_scope_conflict: 'Conflicting chat or channel for a provider receipt',
  blocked_or_partial: 'The source send was blocked or partial', missing_delivery_evidence: 'Confirmed delivery evidence is missing',
  action_conflict: 'Conflicting send action evidence',
  purpose_conflict: 'Conflicting purpose evidence', unknown_purpose: 'Purpose not established',
  missing_chat: 'Provider chat is missing', channel_conflict: 'Conflicting channel evidence',
  incompatible_channel: 'Channels do not agree', uncertain_send: 'Previous send is uncertain',
  ambiguous_order: 'Message order is ambiguous', no_preceding_outbound: 'No preceding source send',
  missing_source: 'Source not established', identity_conflict: 'Conflicting person identity',
}
const PRODUCTS = { dm: 'LinkedIn DM', inmail: 'InMail', email: 'Email', unknown: 'Unknown product' }
function SourceRow({ label, source, displayZone }: { label: string; source: ReplySource | null; displayZone: string }) {
  return <div className="rs-source-row"><h3>{label}</h3>{source ? <>
    <p>{source.method === 'inferred_same_chat' ? 'Reply after ' : ''}{touchLabel(source.touch)} · {PRODUCTS[source.product]}</p>
    <p className="rs-note">{source.method === 'inferred_same_chat' ? 'Same chat inference' : 'Unknown source'}{source.channel_basis === 'chat_inferred' ? ' · channel inferred from chat' : ''}. {source.reason ? REASONS[source.reason] ?? 'Source not established' : ''}</p>
    <p className="rs-note">Reply: <time dateTime={source.reply_at}>{replyTimestamp(source.reply_at, displayZone)}</time> · {displayZone}{source.sent_at ? ` · Source sent: ${replyTimestamp(source.sent_at, displayZone)}` : ''}</p>
    {source.sequence_step !== null && <p className="rs-note">Sequence position {source.sequence_step}</p>}
    {source.followup_ordinal !== null && <p className="rs-note">Delivered follow-up {source.followup_ordinal}.</p>}
    {source.episode_outcome !== null && <p className="rs-note">Episode: {source.episode_outcome}.</p>}
  </> : <p className="rs-note">No observed text reply.</p>}</div>
}
// History shares that state with the thread summary and ID badges.
export function ReplySourceContent({ state, retry, displayZone = 'Europe/Warsaw' }: { state: ReadState<SourceDetail>; retry?: () => void; displayZone?: string }): React.ReactElement {
  if (state.kind !== 'ready') return <div className="reply-source-summary"><ReadNotice state={state} retry={retry} /></div>
  const zone = replyDisplayZone(displayZone)
  return <section className="reply-source-summary" aria-label="Observed reply sources">
    <h2>Observed reply sources</h2>
    {!state.data.first_reply && !state.data.latest_reply ? <p>No observed text replies. Reactions are separate.</p> : <>
      <SourceRow label="First observed text reply" source={state.data.first_reply} displayZone={zone} />
      <SourceRow label="Latest observed text reply" source={state.data.latest_reply} displayZone={zone} />
    </>}
    <SnapshotNotice asOf={state.data.as_of} displayZone={zone} delayed={state.delayed} />
    <p className="rs-note">A new reply can lack a source badge until the next snapshot.</p>
    <p className="rs-note">Full stored history, which is incomplete. Source labels do not establish cause.</p>
  </section>
}
/** A source the snapshot actually established (not "unknown", not an unknown touch). */
export function knownSource(s: ReplySource | null): s is ReplySource {
  return !!s && s.method === 'inferred_same_chat' && s.touch !== 'unknown'
}
/** Brief 4 thread view: one quiet line when the source is known, full detail behind it. Nothing otherwise. */
export function ReplySourceLine({ state, retry, displayZone = 'Europe/Warsaw' }: { state: ReadState<SourceDetail>; retry?: () => void; displayZone?: string }): React.ReactElement | null {
  if (state.kind !== 'ready') return null
  const s = knownSource(state.data.first_reply) ? state.data.first_reply : knownSource(state.data.latest_reply) ? state.data.latest_reply : null
  if (!s) return null
  return <details className="dx-src"><summary>Replied after {touchLabel(s.touch)} · {PRODUCTS[s.product]}</summary>
    <ReplySourceContent state={state} retry={retry} displayZone={displayZone} /></details>
}
function SummaryRead({ scope, prospectId, enabled, retry, displayZone }: { scope: ReplyScope; prospectId: string; enabled: boolean; retry: () => void; displayZone: string }) {
  const state = useReplySource(scope, prospectId, enabled)
  return enabled ? <ReplySourceContent state={state} retry={retry} displayZone={displayZone} /> : null
}
export function ReplySourceSummary({ scope, prospectId, enabled = true, displayZone = 'Europe/Warsaw' }: { scope: ReplyScope; prospectId: string; enabled?: boolean; displayZone?: string }): React.ReactElement {
  const [retry, setRetry] = useState(0)
  return <SummaryRead key={retry} scope={scope} prospectId={prospectId} enabled={enabled} displayZone={displayZone} retry={() => setRetry(n => n + 1)} />
}
