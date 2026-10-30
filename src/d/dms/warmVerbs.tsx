// Warm signals verbs, byte-for-byte today's WarmCardView (src/wb/dms/WarmSignals.tsx): the same
// guards, the same confirms (words included), the same writes in the same order:
//   Save note     rpc warm_signal_decide(save_note, note)
//   Approve invite confirm (shows the exact note; profile viewers: blank by rule) ->
//                 rpc warm_signal_decide(approve_invite, p_text = viewer ? '' : note)
//   Save DM       lib saveDraftText(draft_id, dm1)
//   Approve DM1   confirm -> rpc warm_signal_decide(approve_dm1_stage) THEN lib approveDraft(draft_id, dm1, null)
//                 (db/066: the stage RPC only repairs the stage; approved_at is approveDraft's)
//   Skip          danger confirm -> rpc warm_signal_decide(skip)
// 2026-10-30 (db/298) every seat: the invite confirm names whose seat sends it; a 1st-degree ARCH / SwishDM viewer's
// "invite" approval only unlocks the DM1 draft; a SwishDM viewer DM1 approves through warm_signal_decide(approve_dm_swishdm)
// (it clears the client-review hold and queues it for the SwishDM DM Sender); every other draft keeps approveDraft.
// Each returns null on success or the sentence to show.
import { useMemo } from 'react'
import { approveDraft, saveDraftText } from '../../lib/inbox'
import { decideWarm, dm1Deliverable, inCampaign, warmGroup, type WarmCard } from '../../wb/dms/warmSignalsData'
import { SEAT_OWNER, seatOf } from '../seats'
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
      const seat = seatOf(c.tenant ?? null) ?? 'ivan'
      const firstDegree = c.signal_invite_state === 'first_degree_pending'
      const from = seat === 'ivan' ? '' : ` from ${SEAT_OWNER[seat]}`
      const yes = await confirm({
        title: firstDegree ? `Approve ${firstOf(c)}?` : `Queue the invite to ${firstOf(c)}?`,
        message: firstDegree
          ? `Already connected${from}. Approving lets the first DM draft; it waits for your approval too.`
          : viewer
            ? (seat === 'arch' && c.qualification !== 'eligible'
              ? `A blank connection request${from}, by rule. It goes out once research clears.`
              : `A blank connection request${from}, by rule. The sender picks it up on its next run.`)
            : <span className="dm-pre">{`The connection request goes out with this note on the sender’s next hour:\n\n${note}`}</span>,
        confirmText: firstDegree ? 'Approve' : 'Approve invite', verb: 'confirm-invite',
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
        if (c.draft_model === 'swishdm_pv_dm1_v1') {
          const r = await decideWarm(c.prospect_id, 'approve_dm_swishdm', dm1)
          if (!r.ok) return r.error === 'not_connected_yet' ? `Approve unlocks once ${firstOf(c)} accepts the invite.` : (r.error ?? 'could not approve')
        } else {
          const s = await decideWarm(c.prospect_id, 'approve_dm1_stage')
          if (!s.ok) return s.error ?? 'could not repair the stage'
          await approveDraft(c.draft_id, dm1, null)
        }
      } catch (e) { return errText(e) }
      ok('DM approved'); after(); return null
    }

    async function skip(c: WarmCard): Promise<string | null> {
      const yes = await confirm({ title: `Skip ${c.name}?`, message: inCampaign(c) ? 'The view draft is discarded. Their sequence carries on as before. Nothing is sent.' : 'No invite, no DM. Any pending warm draft is discarded. Nothing is sent.', confirmText: 'Skip', verb: 'confirm-skip', danger: true })
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
