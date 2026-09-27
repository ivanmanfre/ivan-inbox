// A seat column (desktop) or the one seat list (phone). Sections in the mock's order.
import { useState } from 'react'
import { internalHoldSummary, threadBucket, type Thread } from '../../lib/inbox'
import { cameBackLine, firstComment, sentLine, type CameBackCard } from '../../wb/dms/cameBackData'
import { agentCardsWithoutWarmCards, type ConversationAgentCard } from '../../wb/dms/conversationAgentData'
import { WARM_GROUPS, dm1Deliverable, evidenceLine, inviteLine, isWaiting, primaryAction, warmGroup, type WarmCard } from '../../wb/dms/warmSignalsData'
import { seatOf, type Seat } from '../seats'
import { needsCount, type SeatView } from './model'
import { Fold, Quiet, Row, Sec } from './Row'
import { AnyRow, DraftRow, LaterRow, NoDraftRow, SentRow, SpamRow, ThrownRow, dayMonth, type RowCtx } from './threadRows'
import type { AgentSide, Side } from './useDmsData'
import { noteOf, type WarmVerbs } from './warmVerbs'

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
  scanDays: ReadonlyMap<string, number>
}

const WHO: Record<Seat, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }
const OWNER: Record<Seat, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }
const REST_CAP = 8

export function ColumnBody(p: ColumnProps) {
  const { seat, view: v, mode, c } = p
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const tog = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }))

  if (mode === 'spam') {
    if (seat === 'ivan') return <Quiet>No Likely spam folder on your seat: the vendor filter runs on Rise and Arch only.</Quiet>
    return <>
      <Sec label="Likely spam" n={v.spam.length} />
      {v.spam.length ? v.spam.map(t => <SpamRow key={t.prospect_id} t={t} c={c} />) : <Quiet>Nothing filed on this seat.</Quiet>}
    </>
  }
  if (mode === 'email') {
    return <>
      <Sec label="Email threads" n={v.email.length} />
      {v.email.length ? v.email.map(t => <AnyRow key={t.prospect_id} t={t} c={c} owed={threadBucket(t, c.now) !== 'waiting'} />) : <Quiet>No email threads.</Quiet>}
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
  const dated = p.dated.map(d => ({ d, t: p.byId.get(d.prospect_id) })).filter(x => x.t != null && seatOf(x.t.client_id) === seat) as { d: { prospect_id: string; at: string }; t: Thread }[]
  const olderNd = v.older.filter(t => !t.draft).length
  const restShown = open.rest ? v.rest : v.rest.slice(0, REST_CAP)
  return <>
    {v.owner.map(t => (
      <button key={t.prospect_id} type="button" className={`dm-hold${c.selected === t.prospect_id ? ' dm-sel' : ''}`} data-d-row={t.prospect_id} onClick={() => c.open(t)}>
        <span className="dm-pill">{t.ownerConfirmation?.send_blocked_reason === 'reply_retry_pending' ? 'Retrying' : `Confirm with ${OWNER[seat]}`}</span>
        <b>{t.prospect_name}</b>
        <p>{t.ownerConfirmation ? internalHoldSummary(t.ownerConfirmation) : ''}</p>
      </button>
    ))}
    <Sec label="Needs you" n={v.drafted.length + v.nodraft.length} />
    {v.drafted.map(t => <DraftRow key={t.prospect_id} t={t} c={c} />)}
    {v.nodraft.map(t => <NoDraftRow key={t.prospect_id} t={t} c={c} />)}
    {needsCount(v) === 0 && <Quiet>Nothing waiting on {WHO[seat]}.</Quiet>}

    {v.later.length > 0 && <><Sec label="Later" n={v.later.length} />{v.later.map(t => <LaterRow key={t.prospect_id} t={t} c={c} />)}</>}

    {seat !== 'ivan' && dated.length > 0 && <>
      <Sec label="Follow up on a date" n={dated.length} />
      {dated.map(({ d, t }) => <Row key={t.prospect_id} id={t.prospect_id} name={t.prospect_name} company={t.prospect_company}
        line="drafts that morning" right={dayMonth(d.at)} rightKind="fu" selected={c.selected === t.prospect_id} onOpen={() => c.open(t)} />)}
    </>}

    <Sec label="Came back, no reply" n={p.cameBack.failed ? '?' : came.length} />
    {p.cameBack.failed ? <Quiet>Could not read who came back.</Quiet> : came.map(x => {
      const t = p.byId.get(x.prospect_id)
      const comment = firstComment(x)
      return <Row key={x.prospect_id} id={x.prospect_id} name={x.name} company={x.company} conversation={Boolean(t)}
        line={`${cameBackLine(x)}. ${sentLine(x)}${comment ? ` “${comment}”` : ''}${x.icp_score !== null ? ` · ICP ${x.icp_score}` : ''}`}
        selected={c.selected === x.prospect_id} onOpen={t ? () => c.open(t) : undefined}
        verbs={[{ label: 'Dismiss', verb: 'dismiss', busy: c.busy === `cb:${x.prospect_id}`, run: () => { c.setBusy(`cb:${x.prospect_id}`); void c.verbs.cameBackDismiss(x.prospect_id, x.name, () => p.dropCameBack(x.prospect_id)).finally(() => c.setBusy(null)) } }]} />
    })}

    {seat === 'ivan' && <WarmSection p={p} />}

    {v.thrown.length > 0 && <>
      <Sec label="Thrown away, 3 days" n={v.thrown.length} />
      {(open.thrown ? v.thrown : v.thrown.slice(0, 2)).map(t => <ThrownRow key={t.prospect_id} t={t} c={c} />)}
      {v.thrown.length > 2 && <button type="button" className="dm-note" onClick={() => tog('thrown')}>
        {open.thrown ? 'Show fewer' : `+${v.thrown.length - 2} more, each with Bring back`}</button>}
    </>}

    <Fold verb="fold-older" open={Boolean(open.older)} count={v.older.length} onToggle={() => tog('older')}
      label={<>Older than 2 weeks{olderNd ? <> · <b>{olderNd} no draft</b></> : null}</>} />
    {open.older && v.older.map(t => t.draft ? <DraftRow key={t.prospect_id} t={t} c={c} /> : <NoDraftRow key={t.prospect_id} t={t} c={c} />)}
    <Fold verb="fold-auto" open={Boolean(open.auto)} count={v.auto.length} onToggle={() => tog('auto')} label="Auto-replies" />
    {open.auto && v.auto.map(t => <SentRow key={t.prospect_id} t={t} c={c} />)}

    <Sec label="Sent, waiting on them" n={v.rest.length} />
    {restShown.map(t => {
      const days = seat === 'ivan' ? p.scanDays.get(t.prospect_id) ?? 0 : 0
      return <SentRow key={t.prospect_id} t={t} c={c} note={days >= 2 ? `opened your scan again on ${days} days` : null} />
    })}
    {v.rest.length > REST_CAP && <button type="button" className="dm-note" onClick={() => tog('rest')}>
      {open.rest ? 'Show fewer' : `Show all ${v.rest.length}`}</button>}
  </>
}

const GROUP_LABEL = Object.fromEntries(WARM_GROUPS.map(g => [g.key, g.label])) as Record<string, string>

/** Ivan's Warm signals: today's three groups (people waiting on an accept with nothing to decide are
 *  one count line), then today's "Agent conversations". A row opens the whole card (`?warm=`). */
function WarmSection({ p }: { p: ColumnProps }) {
  const { c } = p
  const agentBy = new Map(p.agent.cards.map(a => [a.prospect_id, a] as const))
  let waiting = 0
  const shown: WarmCard[] = []
  for (const w of p.warm.rows) { if (isWaiting(w) && !agentBy.has(w.prospect_id)) waiting++; else shown.push(w) }
  const order = WARM_GROUPS.map(g => g.key) as string[]
  shown.sort((a, b) => order.indexOf(warmGroup(a)) - order.indexOf(warmGroup(b)))
  const agentOnly: ConversationAgentCard[] = agentCardsWithoutWarmCards(p.agent.cards, new Set(p.warm.rows.map(w => w.prospect_id)))
  const total = shown.length + agentOnly.length
  return <>
    <span id="dm-warm" aria-hidden="true" />
    <Sec label="Warm signals" n={p.warm.failed ? '?' : total} />
    {p.agent.failed && <Quiet>Agent status could not be verified. Agent approvals are blocked; warm review still works.</Quiet>}
    {p.agent.note && !p.agent.failed && <Quiet>{p.agent.note}</Quiet>}
    {p.warm.failed ? <Quiet>Could not read the warm signals.</Quiet>
      : p.warm.loaded && total === 0 ? <Quiet>No warm signals now. New profile views and post engagers land here before any invite goes out.</Quiet>
        : shown.map(w => {
          const act = primaryAction(w)
          const ag = agentBy.get(w.prospect_id) ?? null
          const managed = ag !== null && ag.mode !== 'shadow'
          const k = `w:${w.prospect_id}`
          const go = (fn: () => Promise<string | null>, key: string) => () => {
            c.setBusy(key)
            void fn().then(e => { if (e) c.fail(e) }).finally(() => c.setBusy(null))
          }
          return <Row key={w.prospect_id} id={w.prospect_id} name={w.name} company={w.company} conversation={false}
            tags={[{ kind: 'lane', text: GROUP_LABEL[warmGroup(w)] ?? 'Warm' }]}
            line={`${evidenceLine(w)} · ${inviteLine(w).text}${ag ? ` · agent: ${ag.owner === 'agent' ? 'owns it' : 'you own it'}` : ''}`}
            selected={c.selected === w.prospect_id} onOpen={() => p.openWarm(w.prospect_id)}
            verbs={[
              ...(act === 'invite' ? [{ label: 'Approve invite', verb: 'approve-invite', run: go(() => p.warmVerbs.approveInvite(w, noteOf(w)), k), busy: c.busy === k }] : []),
              ...(act === 'dm1' && !managed && dm1Deliverable(w) && w.draft_id ? [{ label: 'Approve DM1', verb: 'approve-dm1', run: go(() => p.warmVerbs.approveDm1(w, w.draft_text ?? '', managed), k), busy: c.busy === k }] : []),
              ...(!managed ? [{ label: 'Skip', verb: 'skip', quiet: true, run: go(() => p.warmVerbs.skip(w), `ws:${w.prospect_id}`), busy: c.busy === `ws:${w.prospect_id}` }] : []),
            ]} />
        })}
    {agentOnly.length > 0 && <>
      <Sec label="Agent conversations" n={agentOnly.length} />
      {agentOnly.map(a => <Row key={a.thread_id} id={a.prospect_id} name={a.prospect_name} conversation={false}
        tags={[{ kind: 'lane', text: a.owner === 'agent' ? 'Agent' : 'Human' }]}
        line={a.latest_inbound?.text ?? 'Conversation under agent control'}
        selected={c.selected === a.prospect_id} onOpen={() => p.openWarm(a.prospect_id)} />)}
    </>}
    {waiting > 0 && <Quiet>{waiting === 1 ? '1 invite out, waiting on their accept.' : `${waiting} invites out, waiting on their accept.`}</Quiet>}
  </>
}
