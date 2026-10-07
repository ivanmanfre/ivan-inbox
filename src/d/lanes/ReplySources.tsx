import React, { useState } from 'react'
import type { Days, ReadState, ReplyMetrics, ReplyScope } from '../../lib/replySources'
import { formatReplyPct, touchLabel } from '../../lib/replySources'
import { useReplySources } from '../../hooks/useReplySources'
import './replySources.css'

export function ReadNotice({ state, retry }: { state: ReadState<unknown>; retry?: () => void }): React.ReactElement {
  const labels = {
    loading: 'Read reply sources…', preview: 'Preview board. Live reply sources are not shown.',
    not_configured: 'Reply sources are not configured for this client.', empty: 'No reply source data.',
    unavailable: 'Reply sources are unavailable. Existing reports and messages remain available.',
    denied: 'Reply source access is denied. Use an approved session.', error: 'Could not read reply sources. Try again.', ready: '',
  }
  return <div className="rs-notice" role="status"><p>{labels[state.kind]}</p>{state.kind === 'error' && retry && <button type="button" onClick={retry}>Retry reply sources</button>}</div>
}
function Percent({ value }: { value: number | null }) {
  return <>{formatReplyPct(value)}{value === null && <small className="rs-sample">No mature sample</small>}</>
}
export function replyDisplayZone(displayZone: string): string {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: displayZone }); return displayZone }
  catch { return 'UTC' }
}
export function replyTimestamp(at: string, displayZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: replyDisplayZone(displayZone) }).format(new Date(at))
}
export function SnapshotNotice({ asOf, displayZone, delayed }: { asOf: string; displayZone: string; delayed?: true }) {
  return <>
    <p className="rs-note">Source data refreshes about every 5 minutes. As of <time dateTime={asOf}>{replyTimestamp(asOf, displayZone)}</time> · {replyDisplayZone(displayZone)}.</p>
    {delayed && <p className="rs-note" role="status">Source data refresh is delayed. Data above 15 minutes is unavailable.</p>}
  </>
}
function ReplyTables({ data: d, displayZone, delayed }: { data: ReplyMetrics; displayZone: string; delayed?: true }) {
  const c = d.coverage
  const empty = !d.totals.first_responders && !d.totals.reactions && d.touches.every(r => r.sends === 0) && d.followups.length === 0
  return <>
    <p className="rs-note">Last {d.period.days} days · rolling UTC</p>
    <SnapshotNotice asOf={d.as_of} displayZone={displayZone} delayed={delayed} />
    <p className="rs-note">All recorded channels.</p>
    <p className="rs-note">UTC interval: ({d.period.from}, {d.period.to}]. Seven-day observation interval.</p>
    {empty && <p role="status">No qualifying events in this period.</p>}
    <div className="rs-scroll" tabIndex={0} role="region" aria-label="Reply source shares table">
      <table><caption>First observed text replies</caption><thead><tr><th scope="col">Source purpose</th><th scope="col">Responders</th><th scope="col">Positive</th><th scope="col">Unclassified</th><th scope="col">Source share</th></tr></thead>
        <tbody>{d.sources.map(r => <tr key={r.touch}><th scope="row">{touchLabel(r.touch)}</th><td>{r.responders}</td><td>{r.positive}</td><td>{r.unclassified}</td><td>{formatReplyPct(r.share_pct)}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="rs-note">{d.totals.first_responders} distinct first responders. Unknown sources stay in the share denominator. {d.totals.reactions} people with reactions, separate from text replies.</p>
    <div className="rs-scroll" tabIndex={0} role="region" aria-label="Confirmed sends and rates table">
      <table><caption>Confirmed sends and seven-day reply rates</caption><thead><tr>{['Purpose', 'Sends', 'Recipients', 'Eligible', 'Mature sample', 'Pending', 'Replies in 7d', 'Rate', 'Late', 'Repeated'].map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead>
        <tbody>{d.touches.map(r => <tr key={r.touch}><th scope="row">{touchLabel(r.touch)}</th>{[r.sends, r.recipients, r.eligible, r.mature, r.pending, r.replies_7d].map((v, i) => <td key={i}>{v}</td>)}<td><Percent value={r.rate_pct} /></td><td>{r.late}</td><td>{r.repeated}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="rs-note">{d.totals.recipients} distinct recipients across purposes. Rates use mature person-and-purpose samples, not send retries. Later stages contain people who did not reply earlier. These observed rates do not establish cause.</p>
    <div className="rs-scroll" tabIndex={0} role="region" aria-label="Conversation follow-up results table">
      <table><caption>Conversation follow-ups</caption><thead><tr>{['Delivered ordinal', 'Episodes', 'Responders', 'Mature sample', 'Pending', 'Replies in 7d', 'Rate', 'Late'].map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead>
        <tbody>{d.followups.length ? d.followups.map(r => <tr key={r.ordinal}><th scope="row">Follow-up {r.ordinal}</th>{[r.episodes, r.responders, r.mature, r.pending, r.replies_7d].map((v, i) => <td key={i}>{v}</td>)}<td><Percent value={r.rate_pct} /></td><td>{r.late}</td></tr>) : <tr><td colSpan={8}>No follow-up episodes in this period.</td></tr>}</tbody>
      </table>
    </div>
    <p className="rs-note">{d.totals.followup_responders} distinct follow-up responders. {c.unknown_episodes} unknown episodes. {c.interrupted_episodes} interrupted episodes. Follow-ups do not add to acquisition first replies.</p>
    <p className="rs-note">Message-history population excludes staff, client teams and the operator. It also excludes vendor pitches, unless a booked call overrides that vendor-pitch exclusion. {c.excluded_people} excluded people. Legacy report populations differ.</p>
    <details className="rs-coverage"><summary>History limits and unknown counts</summary>
      <p>History is incomplete. First recorded event: {c.first_event_at ? replyTimestamp(c.first_event_at, displayZone) : 'none'} · {displayZone}. Feature start: {c.feature_started_on}. Classifier: {c.classifier_version}.</p>
      <p>The seat is a registered client lane. Message account history is unavailable. Campaigns use current prospect membership, not membership at send time. Unknown-source campaign filters use the inbound prospect membership.</p>
      <p>Imported provider aliases can limit person deduplication. {c.record_identities} record-based identities. {c.identity_conflicts} identity conflicts. {c.duplicate_rows} duplicate rows.</p>
      <p>{c.unknown_sources} unknown sources. {c.unknown_purpose} unknown purposes. {c.missing_chats} missing chats. {c.channel_conflicts} channel conflicts.</p>
      <p>{c.missing_receipts} missing receipts. {c.uncertain_sends} uncertain sends. These do not enter confirmed send denominators.</p>
      <p>{c.current_template_purpose} sends use recorded template keys with current metadata. Historical template revision is unknown.</p>
    </details>
  </>
}
function ReadBlock({ scope, days, displayZone, retry }: { scope: ReplyScope; days: Days; displayZone: string; retry: () => void }) {
  const state = useReplySources(scope, days)
  return state.kind === 'ready' ? <ReplyTables data={state.data} displayZone={replyDisplayZone(displayZone)} delayed={state.delayed} /> : <ReadNotice state={state} retry={retry} />
}
export function ReplySources({ scope, displayZone = 'Europe/Warsaw' }: { scope: ReplyScope; displayZone?: string }): React.ReactElement {
  const [days, setDays] = useState<Days>(30)
  const [retry, setRetry] = useState(0)
  return <section className="reply-sources" aria-label="Reply sources" data-reply-sources>
    <h2>Reply sources</h2>
    <fieldset className="rs-period"><legend>Reply source period</legend>{([7, 30, 90] as const).map(n => <button type="button" key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}</fieldset>
    <ReadBlock key={retry} scope={scope} days={days} displayZone={displayZone} retry={() => setRetry(n => n + 1)} />
  </section>
}
