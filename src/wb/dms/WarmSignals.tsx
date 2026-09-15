/* ==========================================================================
   src/wb/dms/WarmSignals.tsx — the people who engaged Ivan FIRST.

   Ivan, 2026-09-12, on the first own-post commenter the promotion lane picked
   up: "sending her something spammy is going to look bad. Just be soft or more
   interesting. Just mention that she commented." Then: "i want to see these
   cases on DM section before directly outreaching as draft all above.. with a
   special category - profile viewers and warm engagers etc."

   Three groups, one card per person, three decisions per card:
     · Approve invite  → stamps enrichment_data.signal_note_final +
                          signal_approved_at; the Connection Request Sender
                          reads the stamp on its own hourly clock.
     · Approve DM1     → approved_at on the pending draft row (the existing
                          approveDraft helper); Poll + Send dispatches on it.
                          Enabled only once they have accepted (a DM to a
                          non-connection 422s at the sender).
     · Skip            → stage 'skipped', skip_state 'manual_skip', pending
                          warm drafts discarded.
   NOTHING ON THIS SURFACE SENDS. Every write is a stamp the senders read later.
   Ivan's tenant only: the RPC is scoped to campaigns with client_id null, and
   the section hides itself on the Rise / Arch / Email lanes.
   The data and the pure helpers live in ./warmSignalsData.ts.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banner, Button, Chip, Icon } from '../../ds'
import { Group, Row, Rows } from '../kit'
import { Face } from './parts'
import { useConfirm } from '../chrome/ConfirmSheet'
import { approveDraft, saveDraftText, type Filter } from '../../lib/inbox'
import {
  WARM_GROUPS, dayOf, decideWarm, dm1Deliverable, evidenceLine, fetchWarmCards, inviteLine,
  isWaiting, linkedinProfileHref, primaryAction, warmGroup, type WarmCard, type WarmGroupKey,
} from './warmSignalsData'
import { ConversationAgentControls, ConversationAgentEnrollment } from './ConversationAgentControls'
import {
  agentCardsWithoutWarmCards, fetchConversationAgentCards,
  type ConversationAgentCard, type ConversationAgentFeed,
} from './conversationAgentData'
import './dms.css'

export function LinkedInProfileAccess({ url }: { url: string | null }) {
  const href = linkedinProfileHref(url)
  return href
    ? <a className="a-link" href={href} target="_blank" rel="noreferrer">Open LinkedIn</a>
    : <span className="a-meta">LinkedIn profile unavailable</span>
}

export function WarmSignals({ filter, refresh, inboxLoadedAt, focus, onOpenThread }: {
  filter: Filter
  refresh: () => void
  // Re-read when the inbox itself re-read: the cards share its rows.
  inboxLoadedAt: string | null
  // `?warm=1` → the section; `?warm=<uuid>` → that card.
  focus: string | null
  onOpenThread: (id: string) => void
}) {
  const [cards, setCards] = useState<WarmCard[] | null>(null)
  const [agentFeed, setAgentFeed] = useState<ConversationAgentFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const host = useRef<HTMLElement | null>(null)
  const focused = useRef(false)

  const load = useCallback(async () => {
    const [warm, agent] = await Promise.allSettled([fetchWarmCards(), fetchConversationAgentCards()])
    if (warm.status === 'fulfilled') {
      setCards(warm.value)
      setError(null)
    } else {
      setError(warm.reason instanceof Error ? warm.reason.message : 'Could not read the warm signals')
    }
    if (agent.status === 'fulfilled') {
      setAgentFeed(agent.value)
    } else {
      setAgentFeed({ kind: 'error', reason: agent.reason instanceof Error ? agent.reason.message : 'Agent status could not be verified.' })
    }
  }, [])

  useEffect(() => { void load() }, [load, inboxLoadedAt])

  // The deep link lands once, after the first read that has rows.
  useEffect(() => {
    if (!focus || focused.current || !cards) return
    const el = focus === '1'
      ? host.current
      : document.querySelector<HTMLElement>(`[data-warm-card="${focus}"]`)
    if (!el) return
    focused.current = true
    setOpen(true)
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focus, cards, agentFeed])

  const visible = filter === 'all' || filter === 'ivan'
  const agentByProspect = useMemo(() => new Map(
    agentFeed?.kind === 'ready' ? agentFeed.cards.map(card => [card.prospect_id, card] as const) : [],
  ), [agentFeed])
  const warmProspectIds = useMemo(() => new Set((cards ?? []).map(card => card.prospect_id)), [cards])
  const agentOnlyCards = useMemo(() => agentFeed?.kind === 'ready'
    ? agentCardsWithoutWarmCards(agentFeed.cards, warmProspectIds)
    : [], [agentFeed, warmProspectIds])
  // People waiting on an accept with nothing to decide are not rows: one count
  // line under the list says how many, and they come back once a draft exists.
  // An agent card is itself a decision/hold, so it always keeps the person visible.
  const { groups, waiting } = useMemo(() => {
    const by = new Map<WarmGroupKey, WarmCard[]>()
    let waiting = 0
    for (const c of cards ?? []) {
      if (isWaiting(c) && !agentByProspect.has(c.prospect_id)) { waiting++; continue }
      const g = warmGroup(c)
      by.set(g, [...(by.get(g) ?? []), c])
    }
    const groups = WARM_GROUPS.map(g => ({ ...g, cards: by.get(g.key) ?? [] })).filter(g => g.cards.length > 0)
    return { groups, waiting }
  }, [cards, agentByProspect])

  if (!visible) return null
  if (cards === null && !error) return null
  const total = groups.reduce((n, g) => n + g.cards.length, 0) + agentOnlyCards.length
  if (total === 0 && !error) return null

  return (
    <section
      className="a-warm"
      ref={host}
      data-open={open ? '' : undefined}
      aria-label="Warm signals"
    >
      <Group
        label={<button type="button" className="a-warm-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Icon name={open ? 'collapse' : 'expand'} size={16} />Warm signals
        </button>}
        tail={<span className="a-mono">{total}</span>}
        quiet
      >
        {error && <Banner tone="urgent" icon="error">{error}</Banner>}
        {open && agentFeed?.kind === 'unavailable' && (
          <Banner tone="neutral" icon="lock">{agentFeed.reason}</Banner>
        )}
        {open && agentFeed?.kind === 'error' && (
          <Banner tone="attention" icon="guard">Agent status could not be verified. Agent approvals are blocked; existing warm review remains available.</Banner>
        )}
        {open && groups.map(g => (
          <div className="a-warm-group" key={g.key} data-group={g.key}>
            <div className="a-warm-sub">{g.label} <span className="a-mono">{g.cards.length}</span></div>
            {g.cards.map(c => (
              <WarmCardView
                key={c.prospect_id} card={c} agentCard={agentByProspect.get(c.prospect_id) ?? null}
                reload={load} refresh={refresh} onOpenThread={onOpenThread}
              />
            ))}
          </div>
        ))}
        {open && agentOnlyCards.length > 0 && (
          <div className="a-warm-group" data-group="agent_conversations">
            <div className="a-warm-sub">Agent conversations <span className="a-mono">{agentOnlyCards.length}</span></div>
            {agentOnlyCards.map(card => (
              <AgentConversationCard key={card.thread_id} card={card} reload={load} onOpenThread={onOpenThread} />
            ))}
          </div>
        )}
        {open && waiting > 0 && (
          <div className="a-warm-waiting a-meta" data-waiting={waiting}>
            {waiting === 1 ? '1 invite out, waiting on their accept.' : `${waiting} invites out, waiting on their accept.`}
          </div>
        )}
      </Group>
    </section>
  )
}

function AgentConversationCard({ card, reload, onOpenThread }: {
  card: ConversationAgentCard
  reload: () => Promise<void>
  onOpenThread: (id: string) => void
}) {
  return (
    <div className="a-warm-card" data-warm-card={card.prospect_id} data-agent-only="">
      <Rows>
        <Row
          lead={<Face name={card.prospect_name} />}
          title={card.prospect_name}
          sub={card.latest_inbound?.text ?? 'Conversation under agent control'}
          subWrap
          tail={<Chip tone={card.owner === 'agent' ? 'accent' : 'quiet'}>{card.owner === 'agent' ? 'Agent' : 'Human'}</Chip>}
          onClick={() => onOpenThread(card.prospect_id)}
        />
      </Rows>
      <div className="a-warm-body">
        <LinkedInProfileAccess url={card.linkedin_url} />
        <ConversationAgentControls card={card} now={Date.now()} onChanged={reload} />
      </div>
    </div>
  )
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className="a-warm-cnt" data-over={n > max ? '' : undefined}>{n}/{max}</span>
}

function WarmCardView({ card: c, agentCard, reload, refresh, onOpenThread }: {
  card: WarmCard
  agentCard: ConversationAgentCard | null
  reload: () => Promise<void>
  refresh: () => void
  onOpenThread: (id: string) => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState<null | 'note' | 'invite' | 'dm1' | 'dm1save' | 'skip'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const isViewer = warmGroup(c) === 'profile_view'
  const invite = inviteLine(c)
  const [note, setNote] = useState(c.signal_note_final ?? c.signal_note_draft ?? '')
  const [dm1, setDm1] = useState(c.draft_text ?? '')
  useEffect(() => { setNote(c.signal_note_final ?? c.signal_note_draft ?? '') }, [c.signal_note_final, c.signal_note_draft])
  useEffect(() => { setDm1(c.draft_text ?? '') }, [c.draft_text])
  const noteDirty = note !== (c.signal_note_final ?? c.signal_note_draft ?? '')
  const dm1Dirty = dm1 !== (c.draft_text ?? '')
  const deliverable = dm1Deliverable(c)
  const ev = c.signal_evidence ?? {}
  const first = c.name.split(' ')[0]
  const windowEnds = c.view_window_ends && invite.kind === 'pending' ? dayOf(c.view_window_ends) : null
  const primary = primaryAction(c)
  const agentThreadManaged = agentCard !== null && agentCard.mode !== 'shadow'

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    if (busy) return
    setBusy(kind); setError(null); setDone(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'That did not save') } finally { setBusy(null) }
  }

  async function onSaveNote() {
    await run('note', async () => {
      const r = await decideWarm(c.prospect_id, 'save_note', note)
      if (!r.ok) throw new Error(r.error ?? 'could not save the note')
      setDone('Note saved')
      await reload()
    })
  }

  async function onApproveInvite() {
    if (busy) return
    if (!isViewer && note.trim().length === 0) { setError('Write the note first, or skip this one.'); return }
    if (note.length > 200) { setError('LinkedIn cuts a note at 200 characters. Shorten it.'); return }
    const ok = await confirm({
      title: `Queue the invite to ${first}?`,
      message: isViewer
        ? 'A blank connection request, by rule. The sender picks it up on its next hour.'
        : `The connection request goes out with this note on the sender’s next hour:\n\n${note}`,
      confirmText: 'Approve invite',
    })
    if (!ok) return
    await run('invite', async () => {
      const r = await decideWarm(c.prospect_id, 'approve_invite', isViewer ? '' : note)
      if (!r.ok) throw new Error(r.error === 'invite_already_sent' ? 'This invite already went out.' : (r.error ?? 'could not approve'))
      setDone('Invite approved')
      await reload(); refresh()
    })
  }

  async function onSaveDm1() {
    if (!c.draft_id) return
    await run('dm1save', async () => {
      await saveDraftText(c.draft_id!, dm1)
      setDone('DM saved')
      await reload()
    })
  }

  async function onApproveDm1() {
    if (busy || !c.draft_id) return
    if (agentThreadManaged) { setError('Review this proposal through the conversation agent action below.'); return }
    if (!deliverable) { setError(`Approve unlocks once ${first} accepts the invite.`); return }
    if (dm1.trim().length === 0) { setError('The DM is empty.'); return }
    const ok = await confirm({
      title: `Send this DM to ${first}?`,
      message: 'The sender picks it up within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) return
    await run('dm1', async () => {
      // A held row whose invite already went out goes back to connection_sent
      // first, so the accept can be detected; a no-op for every other row.
      const s = await decideWarm(c.prospect_id, 'approve_dm1_stage')
      if (!s.ok) throw new Error(s.error ?? 'could not repair the stage')
      await approveDraft(c.draft_id!, dm1, null)
      setDone('DM approved')
      await reload(); refresh()
    })
  }

  async function onSkip() {
    if (busy) return
    const ok = await confirm({
      title: `Skip ${c.name}?`,
      message: 'No invite, no DM. Any pending warm draft is discarded. Nothing is sent.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    await run('skip', async () => {
      const r = await decideWarm(c.prospect_id, 'skip')
      if (!r.ok) throw new Error(r.error ?? 'could not skip')
      await reload(); refresh()
    })
  }

  return (
    <div className="a-warm-card" data-warm-card={c.prospect_id} data-stage={c.stage}>
      <Rows>
        <Row
          lead={<Face name={c.name} />}
          title={c.name}
          sub={c.headline ?? c.title ?? ''}
          subWrap
          tail={<span className="a-warm-tail">
            {c.icp_score !== null && <Chip tone="quiet">ICP {c.icp_score}</Chip>}
            {c.country && <span className="a-meta">{c.city ? `${c.city}, ` : ''}{c.country}</span>}
          </span>}
          onClick={c.dm_sent_count > 0 || c.connection_sent_at ? () => onOpenThread(c.prospect_id) : undefined}
        />
      </Rows>
      <div className="a-warm-body">
        <LinkedInProfileAccess url={c.linkedin_url} />
        <div className="a-warm-ev">
          <Icon name={isViewer ? 'eye' : 'quote'} size={16} />
          <span>{evidenceLine(c)}</span>
        </div>
        {ev.comment && <blockquote className="a-warm-quote">{ev.comment}</blockquote>}

        {/* ---- the invite ---- */}
        <div className="a-warm-block" data-block="invite">
          <div className="a-warm-lbl">Invite note{invite.kind === 'pending' && !isViewer && <Counter n={note.length} max={200} />}</div>
          {invite.kind !== 'pending' && <div className="a-meta">{invite.text}</div>}
          {invite.kind === 'pending' && isViewer && (
            <div className="a-meta">Blank invite, by rule. The question rides the DM once they accept.{windowEnds ? ` The view window closes ${windowEnds}.` : ''}</div>
          )}
          {invite.kind === 'pending' && !isViewer && (
            <textarea
              className="a-warm-ta"
              rows={2}
              value={note}
              maxLength={240}
              onChange={e => setNote(e.target.value)}
              placeholder={c.signal_note_draft === null ? 'Drafting at 09:45 UTC, or write it here' : ''}
              aria-label={`Invite note to ${c.name}`}
            />
          )}
          {invite.kind === 'pending' && !isViewer && noteDirty && (
            <div className="a-warm-acts">
              <Button variant="quiet" size="sm" busy={busy === 'note'} onClick={onSaveNote}>Save note</Button>
            </div>
          )}
        </div>

        {/* ---- the DM after accept ---- */}
        <div className="a-warm-block" data-block="dm1">
          <div className="a-warm-lbl">DM after accept{c.draft_id && !c.draft_approved_at && <Counter n={dm1.length} max={400} />}</div>
          {c.draft_id ? (
            c.draft_approved_at ? (
              <div className="a-meta">Approved {dayOf(c.draft_approved_at)}. The sender picks it up within about 2 minutes.</div>
            ) : agentThreadManaged ? (
              <div className="a-meta">Managed through the revision-bound conversation agent action below.</div>
            ) : (
              <>
                <textarea
                  className="a-warm-ta"
                  rows={4}
                  value={dm1}
                  onChange={e => setDm1(e.target.value)}
                  aria-label={`DM to ${c.name}`}
                />
                {dm1Dirty && (
                  <div className="a-warm-acts">
                    <Button variant="quiet" size="sm" busy={busy === 'dm1save'} onClick={onSaveDm1}>Save DM</Button>
                  </div>
                )}
                {!deliverable && <div className="a-meta">Approve unlocks once {first} accepts.</div>}
              </>
            )
          ) : (
            <div className="a-meta">
              {isViewer
                ? (invite.kind === 'sent' ? 'Drafted from the ruled opener once they accept.' : 'Drafts once they accept.')
                : (c.dm_sent_count > 0 ? 'A DM already went out. The reply drafter owns the thread now.' : 'Drafting at 09:45 UTC.')}
            </div>
          )}
        </div>

        {agentCard && <ConversationAgentControls card={agentCard} now={Date.now()} onChanged={reload} />}
        {isViewer && !agentCard && <ConversationAgentEnrollment />}

        {error && <Banner tone="urgent" icon="error">{error}</Banner>}
        {done && !error && <div className="a-meta a-warm-done"><Icon name="check" size={16} />{done}</div>}
      </div>
      {(!agentThreadManaged || primary === 'invite') && (
        <div className="a-warm-foot">
          {!agentThreadManaged && <Button variant="quiet" size="sm" icon="remove" busy={busy === 'skip'} onClick={onSkip}>Skip</Button>}
          <span className="a-grow" />
          {primary === 'invite' && (
            <Button variant="primary" size="sm" icon="send" busy={busy === 'invite'} onClick={onApproveInvite}>Approve invite</Button>
          )}
          {primary === 'dm1' && !agentThreadManaged && (
            <Button variant={deliverable ? 'primary' : 'outline'} size="sm" icon="send" busy={busy === 'dm1'} disabled={!deliverable} title={deliverable ? undefined : `Unlocks once ${first} accepts`} onClick={onApproveDm1}>Approve DM1</Button>
          )}
        </div>
      )}
    </div>
  )
}
