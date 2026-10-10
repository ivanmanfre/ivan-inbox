// A seat column (desktop) or the one seat list (phone). Sections in the mock's order.
import { useMemo } from 'react'
import { eventTime, internalHoldSummary, isReplyRetryExhausted, threadBucket, type Thread } from '../../lib/inbox'
import { cameBackRowLine, firstComment, sentLine, type CameBackCard } from '../../wb/dms/cameBackData'
import { agentCardsWithoutWarmCards, type ConversationAgentCard } from '../../wb/dms/conversationAgentData'
import { WARM_GROUPS, dm1Deliverable, evidenceLine, inviteLine, isWaiting, primaryAction, warmGroup, type WarmCard } from '../../wb/dms/warmSignalsData'
import { type Seat } from '../seats'
import { ago, needsCount, seatThreads, type SeatView } from './model'
import { laterItems } from './later'
import { Btn } from '../ui/Key'
import { Quiet, Row, Sec } from './Row'
import { Section, useFolds, type Folds } from './Section'
import { AnyRow, DraftRow, LaterRow, NoDraftRow, SpamRow, ThrownRow, dayMonth, type RowCtx } from './threadRows'
import { AllConvos } from './AllConvos'
import { SendLog } from './SendLog'
import { signalItems } from './signals'
import type { AgentSide, Side } from './useDmsData'
import { noteOf, type WarmVerbs } from './warmVerbs'
import { blockedFollowup, upcomingItems, type FollowupProjection } from './upcoming'
import { warsawHm } from '../ui/time'
import { ComingUp } from './v4/ComingUp'

export type Mode = 'conversations' | 'email' | 'spam' | 'search'

export type ColumnProps = {
  seat: Seat
  view: SeatView
  mode: Mode
  matches: Thread[]
  c: RowCtx
  byId: ReadonlyMap<string, Thread>
  cameBack: Side<CameBackCard>
  dropCameBack: (pid: string) => void
  warm: Side<WarmCard>
  agent: AgentSide
  warmVerbs: WarmVerbs
  openWarm: (pid: string) => void
  dated: { prospect_id: string; at: string }[]
  upcoming?: Side<FollowupProjection>
  scanDays: ReadonlyMap<string, number>
  /** This seat's drafts where he already replied (today's lane-scoped StaleBar). */
  stale: Thread[]
  /** Switch to the Email folder (the pointer line for email-only threads that need a reply). */
  toEmail: () => void
}

const WHO: Record<Seat, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }
const OWNER: Record<Seat, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }

export function ColumnBody(p: ColumnProps) {
  const { seat, view: v, mode, c } = p
  // The send log covers every thread of the seat, outbound-only ones too (All conversations does not).
  const seatSent = useMemo(() => seatThreads([...p.byId.values()], seat), [p.byId, seat])
  const f = useFolds()
  // One remembered fold per seat and section, so folding Mattan's Discarded leaves yours alone.
  const folds: Folds = { isOpen: (id, def) => f.isOpen(`${seat}:${id}`, def), toggle: (id, def) => f.toggle(`${seat}:${id}`, def) }

  if (mode === 'spam') {
    if (seat === 'ivan') return <Quiet>No Likely spam folder on your seat: the vendor filter runs on Rise and Arch only.</Quiet>
    return <Section id="spam" label="Likely spam" n={v.spam.length} folds={folds}
      rows={v.spam.map(t => <SpamRow key={t.prospect_id} t={t} c={c} />)} before={v.spam.length ? null : <Quiet>Nothing filed on this seat.</Quiet>} />
  }
  if (mode === 'email') {
    return <>
      <Section id="email" label="Email waiting on you" n={v.emailWaiting.length} folds={folds}
        rows={v.emailWaiting.map(t => <AnyRow key={t.prospect_id} t={t} c={c} owed />)}
        before={v.emailWaiting.length ? null : <Quiet>No email is waiting on {WHO[seat]}. Old replies and our own sends are under All email.</Quiet>} />
      {v.emailRest.length > 0 && <Section id="email-all" foldable defaultOpen={false} label="All email" n={v.emailRest.length} folds={folds}
        rows={v.emailRest.map(t => <AnyRow key={t.prospect_id} t={t} c={c} owed={false} />)} />}
    </>
  }
  if (mode === 'search') {
    return <>
      <Sec label={`Matches, ${p.matches.length}`} tail="newest first" />
      {p.matches.length ? p.matches.slice(0, 40).map(t => <AnyRow key={t.prospect_id} t={t} c={c} owed={threadBucket(t, c.now) !== 'waiting'} />)
        : <Quiet>No match on this seat.</Quiet>}
      {p.matches.length > 40 && <Quiet>{p.matches.length - 40} more: narrow the search.</Quiet>}
    </>
  }

  const came = p.cameBack.rows.filter(x => (x.tenant as string) === seat)
  const allLater = laterItems(v.later, p.dated, p.byId, seat)
  const coming = upcomingItems(p.upcoming?.failed ? [] : p.upcoming?.rows ?? [], allLater, p.byId, seat, c.now)
  const due = coming.filter(i => Date.parse(i.at) <= c.now)
  const future = coming.filter(i => Date.parse(i.at) > c.now)
  const comingIds = new Set(coming.map(i => i.t.prospect_id))
  const later = allLater.filter(i => !comingIds.has(i.t.prospect_id))
  const blocked = v.all.map(t => ({ t, hold: blockedFollowup(t) })).filter(i => i.hold !== null)
  const datedBy = new Map(p.dated.map(d => [d.prospect_id, d.at] as const))
  const needs = [
    ...v.owner.map(t => (
      <button key={t.prospect_id} type="button" className={`dm-hold${c.selected === t.prospect_id ? ' dm-sel' : ''}`} data-d-row={t.prospect_id} onClick={() => c.open(t)}>
        <span className="dm-pill">{t.ownerConfirmation && isReplyRetryExhausted(t.ownerConfirmation) ? 'Write reply' : t.ownerConfirmation?.send_blocked_reason === 'reply_retry_pending' ? 'Retrying' : `Confirm with ${OWNER[seat]}`}</span>
        <b>{t.prospect_name}</b>
        <p>{t.ownerConfirmation ? internalHoldSummary(t.ownerConfirmation) : ''}</p>
      </button>
    )),
    ...v.drafted.map(t => <DraftRow key={t.prospect_id} t={t} c={c} />),
    ...v.nodraft.map(t => <NoDraftRow key={t.prospect_id} t={t} c={c} />),
  ]
  const emailOwed = v.emailOwed.length
  const staleKey = p.stale.length > 0 ? (
    <Btn danger verb="discard-stale" disabled={c.busy === `stale:${seat}`} onClick={() => { c.setBusy(`stale:${seat}`); void c.verbs.discardStale(p.stale).finally(() => c.setBusy(null)) }}>{c.busy === `stale:${seat}` ? 'Discarding…' : 'Discard stale'}</Btn>
  ) : null
  if (c.v4) {
    // Brief 4 (SPEC-dms §2.3): three groups. Needs you (the stale strip inside it, owner holds through
    // the shared row), Blocked follow-ups, Coming up (Due + next 3 days + Later as one timeline), More.
    // Same rows, same sections, same handlers as below; only the arrangement differs.
    const needsV4 = [
      ...v.owner.map((t, i) => {
        const oc = t.ownerConfirmation
        const hold = oc && isReplyRetryExhausted(oc) ? 'Write reply' : oc?.send_blocked_reason === 'reply_retry_pending' ? 'Retrying' : `Confirm with ${OWNER[seat]}`
        return <Row key={t.prospect_id} v4 index={i} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company} pill={{ text: hold, tone: 'warn' }}
          line={oc ? internalHoldSummary(oc) : ''} right={oc ? ago(eventTime(oc), c.now) : ''} rightKind="needs" unread={t.unread > 0}
          selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />
      }),
      ...v.drafted.map(t => <DraftRow key={t.prospect_id} t={t} c={c} />),
      ...v.nodraft.map(t => <NoDraftRow key={t.prospect_id} t={t} c={c} />),
    ]
    return <>
      <Section id="needs" label="Needs you" n={needsCount(v)} folds={folds} rows={needsV4}
        before={staleKey && (
          <div className="dm-stale dx-strip" role="note">
            <span>{p.stale.length} draft{p.stale.length === 1 ? '' : 's'} where you already replied</span>
            {staleKey}
          </div>
        )}
        after={<>
          {emailOwed > 0 && <button type="button" className="dm-note" data-verb="to-email" onClick={p.toEmail}>
            {emailOwed === 1 ? '1 email thread needs you too, in the Email folder' : `${emailOwed} email threads need you too, in the Email folder`}</button>}
          {needsCount(v) === 0 && <Quiet>{blocked.length ? 'No drafts ready. Check the blocked follow-ups below.' : `Nothing waiting on ${WHO[seat]}.`}</Quiet>}
        </>} />

      {blocked.length > 0 && <Section id="followup-blocked" label="Blocked follow-ups" n={blocked.length} folds={folds}
        rows={blocked.map(({ t, hold }) => <Row key={t.prospect_id} v4 id={t.prospect_id} name={t.prospect_name} company={t.prospect_company}
          pill={{ text: 'Review', tone: 'bad' }} line={hold!.reason} selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />)} />}

      <ComingUp c={c} folds={folds} due={due} future={future} later={later} failed={Boolean(p.upcoming?.failed)} loaded={Boolean(p.upcoming?.loaded)} />

      <div className="dx-grp" aria-hidden="true">More</div>
      <SignalsSection p={p} folds={folds} came={came} />
      {v.thrown.length > 0 && <Section id="thrown" foldable defaultOpen={false} label="Discarded, 3 days" n={v.thrown.length} folds={folds}
        rows={v.thrown.map(t => <ThrownRow key={t.prospect_id} t={t} c={c} />)} />}
      <AllConvos threads={v.all} c={c} folds={folds} dated={datedBy} />
      <SendLog threads={seatSent} c={c} folds={folds} v4 />
    </>
  }
  return <>
    {p.stale.length > 0 && (
      <div className="dm-stale" role="note">
        <span>{p.stale.length} draft{p.stale.length === 1 ? '' : 's'} where you already replied</span>
        <Btn danger verb="discard-stale" disabled={c.busy === `stale:${seat}`} onClick={() => { c.setBusy(`stale:${seat}`); void c.verbs.discardStale(p.stale).finally(() => c.setBusy(null)) }}>{c.busy === `stale:${seat}` ? 'Discarding…' : 'Discard stale'}</Btn>
      </div>
    )}
    <Section id="needs" label="Needs you" n={needsCount(v)} folds={folds} rows={needs}
      after={<>
        {emailOwed > 0 && <button type="button" className="dm-note" data-verb="to-email" onClick={p.toEmail}>
          {emailOwed === 1 ? '1 email thread needs you too, in the Email folder' : `${emailOwed} email threads need you too, in the Email folder`}</button>}
        {needsCount(v) === 0 && <Quiet>{blocked.length ? 'No drafts ready. Check the blocked follow-ups below.' : `Nothing waiting on ${WHO[seat]}.`}</Quiet>}
      </>} />

    {blocked.length > 0 && <Section id="followup-blocked" label="Blocked follow-ups" n={blocked.length} folds={folds}
      rows={blocked.map(({t,hold}) => <Row key={t.prospect_id} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company}
        line={hold!.reason} right="Review" rightKind="needs" selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />)} />}

    {due.length > 0 && <Section id="followup-due" foldable label="Due, awaiting draft" n={due.length} folds={folds}
      before={<Quiet>These dates have arrived. The system still needs to check each conversation.</Quiet>}
      rows={due.map(i => <Row key={i.t.prospect_id} id={i.t.prospect_id} name={i.t.prospect_name} company={i.t.prospect_company}
        line={i.line} right={dayMonth(i.at)} rightKind="fu" selected={c.selected === i.t.prospect_id} onOpen={() => c.open(i.t)} />)} />}

    <Section id="upcoming" foldable label="Upcoming, next 3 days" n={p.upcoming?.failed ? '?' : future.length} folds={folds}
      before={p.upcoming?.failed ? <Quiet>Could not refresh the follow-up schedule. Use Refresh to try again.</Quiet> : !p.upcoming?.loaded ? <Quiet>Reading the follow-up schedule…</Quiet> : future.length === 0 ? <Quiet>No follow-ups scheduled in the next three days.</Quiet> : null}
      rows={future.map(i => <Row key={i.t.prospect_id} id={i.t.prospect_id} name={i.t.prospect_name} company={i.t.prospect_company}
        line={i.line} right={`${dayMonth(i.at)} ${warsawHm(i.at)}`} rightKind="later" selected={c.selected === i.t.prospect_id} onOpen={() => c.open(i.t)} />)}
      after={future.length > 0 ? <Quiet>Estimated dates are checked against the conversation before a draft is created.</Quiet> : null} />

    {later.length > 0 && <Section id="later" foldable label="Later" n={later.length} folds={folds}
      rows={later.map(i => i.kind === 'draft' ? <LaterRow key={i.t.prospect_id} t={i.t} c={c} />
        : <Row key={i.t.prospect_id} id={i.t.prospect_id} name={i.t.prospect_name} company={i.t.prospect_company}
          line="a follow-up drafts that morning" right={dayMonth(i.at)} rightKind="later" selected={c.selected === i.t.prospect_id} onOpen={() => c.open(i.t)} />)} />}

    <SignalsSection p={p} folds={folds} came={came} />

    {v.thrown.length > 0 && <Section id="thrown" foldable defaultOpen={false} label="Discarded, 3 days" n={v.thrown.length} folds={folds}
      rows={v.thrown.map(t => <ThrownRow key={t.prospect_id} t={t} c={c} />)} />}

    <AllConvos threads={v.all} c={c} folds={folds} dated={datedBy} />
    <SendLog threads={seatSent} c={c} folds={folds} />
  </>
}

/** Signals: every pre-reply interest signal on the seat in ONE list (signals.ts): Ivan's warm cards
 *  (their verbs and confirms unchanged), agent-only conversations, and came-back people who have no
 *  conversation yet. Each row says its kind in words. Open while there is anything in it. */
function SignalsSection({ p, folds, came }: { p: ColumnProps; folds: Folds; came: CameBackCard[] }) {
  const { c, seat } = p
  const agentBy = new Map(p.agent.cards.map(a => [a.prospect_id, a] as const))
  let waiting = 0
  const shown: WarmCard[] = []
  if (seat === 'ivan') for (const w of p.warm.rows) { if (isWaiting(w) && !agentBy.has(w.prospect_id)) waiting++; else shown.push(w) }
  const order = WARM_GROUPS.map(g => g.key) as string[]
  shown.sort((a, b) => order.indexOf(warmGroup(a)) - order.indexOf(warmGroup(b)))
  const agentOnly: ConversationAgentCard[] = seat === 'ivan' ? agentCardsWithoutWarmCards(p.agent.cards, new Set(p.warm.rows.map(w => w.prospect_id))) : []
  const items = signalItems(seat, shown, agentOnly, came, p.byId)
  const rows = items.map(it => {
    if (it.kind === 'warm') {
      const w = it.w
      const act = primaryAction(w)
      const ag = agentBy.get(w.prospect_id) ?? null
      const managed = ag !== null && ag.mode !== 'shadow'
      const k = `w:${w.prospect_id}`
      const go = (fn: () => Promise<string | null>, key: string) => () => {
        c.setBusy(key)
        void fn().then(e => { if (e) c.fail(e) }).finally(() => c.setBusy(null))
      }
      return <Row key={`w${w.prospect_id}`} v4={c.v4} id={w.prospect_id} name={w.name} company={w.company} conversation={false}
        tags={[{ kind: 'lane', text: it.label }]}
        line={`${evidenceLine(w)} · ${inviteLine(w).text}${ag ? ` · agent: ${ag.owner === 'agent' ? 'owns it' : 'you own it'}` : ''}`}
        selected={c.selected === w.prospect_id} onOpen={() => p.openWarm(w.prospect_id)}
        verbs={[
          ...(act === 'invite' ? [{ label: 'Approve invite', verb: 'approve-invite', run: go(() => p.warmVerbs.approveInvite(w, noteOf(w)), k), busy: c.busy === k }] : []),
          ...(act === 'dm1' && !managed && dm1Deliverable(w) && w.draft_id ? [{ label: 'Approve DM1', verb: 'approve-dm1', run: go(() => p.warmVerbs.approveDm1(w, w.draft_text ?? '', managed), k), busy: c.busy === k }] : []),
          ...(!managed ? [{ label: 'Skip', verb: 'skip', quiet: true, run: go(() => p.warmVerbs.skip(w), `ws:${w.prospect_id}`), busy: c.busy === `ws:${w.prospect_id}` }] : []),
        ]} />
    }
    if (it.kind === 'agent') {
      const a = it.a
      return <Row key={`a${a.thread_id}`} v4={c.v4} id={a.prospect_id} name={a.prospect_name} conversation={false}
        tags={[{ kind: 'lane', text: it.label }, { kind: 'lane', text: a.owner === 'agent' ? 'Agent' : 'Human' }]}
        line={a.latest_inbound?.text ?? 'Conversation under agent control'}
        selected={c.selected === a.prospect_id} onOpen={() => p.openWarm(a.prospect_id)} />
    }
    const x = it.c, t = it.t
    const comment = firstComment(x)
    return <Row key={`c${x.prospect_id}`} v4={c.v4} id={x.prospect_id} name={x.name} company={x.company} conversation={Boolean(t)}
      tags={[{ kind: 'lane', text: it.label }]}
      line={<span className="dm-sigline">{`${cameBackRowLine(x)}. ${sentLine(x)}${comment ? ` “${comment}”` : ''}${x.icp_score !== null ? ` · ICP ${x.icp_score}` : ''}`}</span>}
      selected={c.selected === x.prospect_id} onOpen={t ? () => c.open(t) : undefined}
      verbs={[{ label: 'Dismiss', verb: 'dismiss', busy: c.busy === `cb:${x.prospect_id}`, run: () => { c.setBusy(`cb:${x.prospect_id}`); void c.verbs.cameBackDismiss(x.prospect_id, x.name, () => p.dropCameBack(x.prospect_id)).finally(() => c.setBusy(null)) } }]} />
  })
  const failed = (seat === 'ivan' && p.warm.failed) || p.cameBack.failed
  const loaded = p.cameBack.loaded && (seat !== 'ivan' || p.warm.loaded)
  const empty = loaded && !failed && items.length === 0
  return <>
    <span id="dm-warm" aria-hidden="true" />
    <Section key={empty ? 'sig-empty' : 'sig'} id={empty ? 'signals-empty' : 'signals'} foldable defaultOpen={!empty} label="Signals" n={failed ? '?' : items.length} folds={folds} rows={rows}
      before={<>
        {seat === 'ivan' && p.agent.failed && <Quiet>Agent status could not be verified. Agent approvals are blocked; warm review still works.</Quiet>}
        {seat === 'ivan' && p.agent.note && !p.agent.failed && <Quiet>{p.agent.note}</Quiet>}
        {seat === 'ivan' && p.warm.failed && <Quiet>Could not read the warm signals.</Quiet>}
        {p.cameBack.failed && <Quiet>Could not read who came back.</Quiet>}
        {empty && <Quiet>No signals now. Profile views, post engagers and people who came back without replying land here.</Quiet>}
      </>}
      after={waiting > 0 ? <Quiet>{waiting === 1 ? '1 invite out, waiting on their accept.' : `${waiting} invites out, waiting on their accept.`}</Quiet> : null} />
  </>
}
