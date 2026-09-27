// A warm signal, opened (`?warm=<prospect>`): today's whole WarmCardView in a D sheet. Who they
// are (headline, ICP, place, LinkedIn), what they did (evidence + their comment), the invite note
// (editable, 200 cap, Save note; profile viewers: blank by rule), the DM after accept (editable,
// Save DM, unlocks on accept), the conversation agent when enrolled (or the Ops pointer for a
// viewer), and the keys: Skip, Approve invite, Approve DM1. Writes: ./warmVerbs (today's).
import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import type { ConversationAgentCard } from '../../wb/dms/conversationAgentData'
import { dayOf, dm1Deliverable, evidenceLine, inviteLine, linkedinProfileHref, primaryAction, type WarmCard } from '../../wb/dms/warmSignalsData'
import { Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { AgentEnrollment, AgentPanel } from './Agent'
import { isViewer, noteOf, type WarmVerbs } from './warmVerbs'

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={n > max ? 'dm-over' : undefined}>{n}/{max}</span>
}

export function WarmSheet({ c, agent, thread, verbs, onClose, onOpenThread, onAgentChanged }: {
  c: WarmCard; agent: ConversationAgentCard | null; thread: Thread | null; verbs: WarmVerbs
  onClose: () => void; onOpenThread: (t: Thread) => void; onAgentChanged: () => void
}) {
  const [busy, setBusy] = useState<null | 'note' | 'invite' | 'dm1' | 'dm1save' | 'skip'>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState(noteOf(c))
  const [dm1, setDm1] = useState(c.draft_text ?? '')
  useEffect(() => { setNote(noteOf(c)) }, [c.signal_note_final, c.signal_note_draft]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDm1(c.draft_text ?? '') }, [c.draft_text])
  const viewer = isViewer(c)
  const invite = inviteLine(c)
  const primary = primaryAction(c)
  const deliverable = dm1Deliverable(c)
  const managed = agent !== null && agent.mode !== 'shadow'
  const noteDirty = note !== noteOf(c)
  const dm1Dirty = dm1 !== (c.draft_text ?? '')
  const first = c.name.split(' ')[0]
  const ev = c.signal_evidence ?? {}
  const windowEnds = c.view_window_ends && invite.kind === 'pending' ? dayOf(c.view_window_ends) : null
  const href = linkedinProfileHref(c.linkedin_url)

  const run = async (k: NonNullable<typeof busy>, fn: () => Promise<string | null>, closeAfter = false) => {
    if (busy) return
    setBusy(k); setError(null)
    try { const e = await fn(); if (e) setError(e); else if (e === null && closeAfter) onClose() } finally { setBusy(null) }
  }

  const foot = (!managed || primary === 'invite') ? <>
    {!managed && <Key verb="skip" disabled={busy !== null} onClick={() => void run('skip', () => verbs.skip(c), true)}>{busy === 'skip' ? 'Skipping…' : 'Skip'}</Key>}
    {thread && <Key verb="open-thread" onClick={() => onOpenThread(thread)}>Conversation</Key>}
    {primary === 'invite' && <Key primary verb="approve-invite" disabled={busy !== null} onClick={() => void run('invite', () => verbs.approveInvite(c, note))}>{busy === 'invite' ? 'Queueing…' : 'Approve invite'}</Key>}
    {primary === 'dm1' && !managed && <Key primary={deliverable} verb="approve-dm1" disabled={busy !== null || !deliverable} title={deliverable ? undefined : `Unlocks once ${first} accepts`}
      onClick={() => void run('dm1', () => verbs.approveDm1(c, dm1, managed))}>{busy === 'dm1' ? 'Approving…' : 'Approve DM1'}</Key>}
  </> : thread ? <Key verb="open-thread" onClick={() => onOpenThread(thread)}>Conversation</Key> : undefined

  return (
    <Sheet open onClose={onClose} title={c.name} sub={[c.headline ?? c.title, c.company].filter(Boolean).join(' · ')} label={`Warm signal: ${c.name}`} foot={foot}>
      <div className="dm-ctx dm-warm" data-warm-card={c.prospect_id} data-stage={c.stage}>
        <div className="dm-warm-top">
          {c.icp_score !== null && <span className="dm-chip">ICP {c.icp_score}</span>}
          {c.country && <span>{c.city ? `${c.city}, ` : ''}{c.country}</span>}
          {href ? <a className="d-link" href={href} target="_blank" rel="noreferrer" data-verb="open-linkedin">Open LinkedIn</a> : <span className="dm-meta">LinkedIn profile unavailable</span>}
        </div>
        <div><small className="dm-lbl">{viewer ? 'Viewed your profile' : 'Engaged'}</small><p>{evidenceLine(c)}</p>
          {ev.comment && <blockquote className="dm-quote">{ev.comment}</blockquote>}</div>

        <div data-block="invite">
          <div className="dm-field">
            <span>Invite note{invite.kind === 'pending' && !viewer && <Counter n={note.length} max={200} />}</span>
            {invite.kind !== 'pending' && <p className="dm-meta">{invite.text}</p>}
            {invite.kind === 'pending' && viewer && <p className="dm-meta">Blank invite, by rule. The question rides the DM once they accept.{windowEnds ? ` The view window closes ${windowEnds}.` : ''}</p>}
            {invite.kind === 'pending' && !viewer && (
              <textarea rows={2} value={note} maxLength={240} onChange={e => setNote(e.target.value)} aria-label={`Invite note to ${c.name}`}
                placeholder={c.signal_note_draft === null ? 'Drafting at 09:45 UTC, or write it here' : ''} />
            )}
          </div>
          {invite.kind === 'pending' && !viewer && noteDirty && (
            <div className="dm-ban-row"><Key size="small" verb="warm-save-note" disabled={busy !== null} onClick={() => void run('note', () => verbs.saveNote(c, note))}>{busy === 'note' ? 'Saving…' : 'Save note'}</Key></div>
          )}
        </div>

        <div data-block="dm1">
          <div className="dm-field">
            <span>DM after accept{c.draft_id && !c.draft_approved_at && <Counter n={dm1.length} max={400} />}</span>
            {c.draft_id ? (
              c.draft_approved_at ? <p className="dm-meta">Approved {dayOf(c.draft_approved_at)}. The sender picks it up within about 2 minutes.</p>
                : managed ? <p className="dm-meta">Managed through the revision-bound conversation agent action below.</p>
                  : <>
                    <textarea rows={4} value={dm1} onChange={e => setDm1(e.target.value)} aria-label={`DM to ${c.name}`} />
                    {!deliverable && <small>Approve unlocks once {first} accepts.</small>}
                  </>
            ) : (
              <p className="dm-meta">{viewer
                ? (invite.kind === 'sent' ? 'Drafted from the ruled opener once they accept.' : 'Drafts once they accept.')
                : (c.dm_sent_count > 0 ? 'A DM already went out. The reply drafter owns the thread now.' : 'Drafting at 09:45 UTC.')}</p>
            )}
          </div>
          {c.draft_id && !c.draft_approved_at && !managed && dm1Dirty && (
            <div className="dm-ban-row"><Key size="small" verb="warm-save-dm" disabled={busy !== null} onClick={() => void run('dm1save', () => verbs.saveDm(c, dm1))}>{busy === 'dm1save' ? 'Saving…' : 'Save DM'}</Key></div>
          )}
        </div>

        {agent && <AgentPanel card={agent} onChanged={onAgentChanged} />}
        {viewer && !agent && <AgentEnrollment />}
        {error && <p className="dm-warn" role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** An agent-controlled conversation with no warm card (today's "Agent conversations" group). */
export function AgentOnlySheet({ card, thread, onClose, onOpenThread, onAgentChanged }: {
  card: ConversationAgentCard; thread: Thread | null; onClose: () => void; onOpenThread: (t: Thread) => void; onAgentChanged: () => void
}) {
  const href = linkedinProfileHref(card.linkedin_url)
  return (
    <Sheet open onClose={onClose} title={card.prospect_name} sub={card.owner === 'agent' ? 'Agent' : 'Human'} label={`Agent conversation: ${card.prospect_name}`}
      foot={thread ? <Key verb="open-thread" onClick={() => onOpenThread(thread)}>Conversation</Key> : undefined}>
      <div className="dm-ctx dm-warm" data-warm-card={card.prospect_id} data-agent-only="">
        <div className="dm-warm-top">{href ? <a className="d-link" href={href} target="_blank" rel="noreferrer">Open LinkedIn</a> : <span className="dm-meta">LinkedIn profile unavailable</span>}</div>
        <AgentPanel card={card} onChanged={onAgentChanged} />
      </div>
    </Sheet>
  )
}
