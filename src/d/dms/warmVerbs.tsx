// Warm signals verbs, byte-for-byte today's WarmCardView (src/wb/dms/WarmSignals.tsx): the same
// guards, the same confirms (words included), the same writes in the same order:
//   Save note     rpc warm_signal_decide(save_note, note)
//   Approve invite confirm (shows the exact note; profile viewers: blank by rule) ->
//                 rpc warm_signal_decide(approve_invite, p_text = viewer ? '' : note)
//   Save DM       lib saveDraftText(draft_id, dm1)
//   Approve DM1   confirm -> rpc warm_signal_decide(approve_dm1_stage) THEN lib approveDraft(draft_id, dm1, null)
//                 (db/066: the stage RPC only repairs the stage; approved_at is approveDraft's)
//   Skip          danger confirm -> rpc warm_signal_decide(skip)
// Each returns null on success or the sentence to show.
import { useMemo } from 'react'
import { approveDraft, saveDraftText } from '../../lib/inbox'
import { decideWarm, dm1Deliverable, warmGroup, type WarmCard } from '../../wb/dms/warmSignalsData'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'That did not save')
export const isViewer = (c: WarmCard) => warmGroup(c) === 'profile_view'
export const noteOf = (c: WarmCard) => c.signal_note_final ?? c.signal_note_draft ?? ''
const firstOf = (c: WarmCard) => c.name.split(' ')[0]

export function useWarmVerbs(after: () => void) {
  const confirm = useDConfirm()
  const toast = useToast()
  return useMemo(() => {
    const ok = (message: string) => toast.show({ message })

    async function saveNote(c: WarmCard, note: string): Promise<string | null> {
      try {
        const r = await decideWarm(c.prospect_id, 'save_note', note)
        if (!r.ok) return r.error ?? 'could not save the note'
      } catch (e) { return errText(e) }
      ok('Note saved'); after(); return null
    }

    async function approveInvite(c: WarmCard, note: string): Promise<string | null> {
      const viewer = isViewer(c)
      if (!viewer && note.trim().length === 0) return 'Write the note first, or skip this one.'
      if (note.length > 200) return 'LinkedIn cuts a note at 200 characters. Shorten it.'
      const yes = await confirm({
        title: `Queue the invite to ${firstOf(c)}?`,
        message: viewer
          ? 'A blank connection request, by rule. The sender picks it up on its next hour.'
          : <span className="dm-pre">{`The connection request goes out with this note on the sender’s next hour:\n\n${note}`}</span>,
        confirmText: 'Approve invite', verb: 'confirm-invite',
      })
      if (!yes) return ''
      try {
        const r = await decideWarm(c.prospect_id, 'approve_invite', viewer ? '' : note)
        if (!r.ok) return r.error === 'invite_already_sent' ? 'This invite already went out.' : (r.error ?? 'could not approve')
      } catch (e) { return errText(e) }
      ok('Invite approved'); after(); return null
    }

    async function saveDm(c: WarmCard, dm1: string): Promise<string | null> {
      if (!c.draft_id) return null
      try { await saveDraftText(c.draft_id, dm1) } catch (e) { return errText(e) }
      ok('DM saved'); after(); return null
    }

    async function approveDm1(c: WarmCard, dm1: string, agentManaged: boolean): Promise<string | null> {
      if (!c.draft_id) return null
      if (agentManaged) return 'Review this proposal through the conversation agent action below.'
      if (!dm1Deliverable(c)) return `Approve unlocks once ${firstOf(c)} accepts the invite.`
      if (dm1.trim().length === 0) return 'The DM is empty.'
      const yes = await confirm({ title: `Send this DM to ${firstOf(c)}?`, message: 'The sender picks it up within about 2 minutes.', confirmText: 'Approve & send', verb: 'confirm-dm1' })
      if (!yes) return ''
      try {
        // A held row whose invite already went out goes back to connection_sent first, so the
        // accept can be detected; a no-op for every other row.
        const s = await decideWarm(c.prospect_id, 'approve_dm1_stage')
        if (!s.ok) return s.error ?? 'could not repair the stage'
        await approveDraft(c.draft_id, dm1, null)
      } catch (e) { return errText(e) }
      ok('DM approved'); after(); return null
    }

    async function skip(c: WarmCard): Promise<string | null> {
      const yes = await confirm({ title: `Skip ${c.name}?`, message: 'No invite, no DM. Any pending warm draft is discarded. Nothing is sent.', confirmText: 'Skip', verb: 'confirm-skip', danger: true })
      if (!yes) return ''
      try {
        const r = await decideWarm(c.prospect_id, 'skip')
        if (!r.ok) return r.error ?? 'could not skip'
      } catch (e) { return errText(e) }
      ok(`Skipped ${c.name}`); after(); return null
    }

    return { saveNote, approveInvite, saveDm, approveDm1, skip }
  }, [confirm, toast, after])
}

export type WarmVerbs = ReturnType<typeof useWarmVerbs>
