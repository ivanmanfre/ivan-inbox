import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientRpcError, DraftSaveConflict, approveDraft, deleteClientDraft, saveClientDraftBody, saveDraftBody,
  setBoardVisible, skipDraft, type ContentDraftDetail, type SaveConflict,
} from '../../lib/content'
import { scheduleDraft } from '../../lib/studioActions'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDayTime } from '../ui/time'
import { OWNER, POSS, type Lane } from './model'

// The draft window's writes. Every write is today's function with today's
// payload (lib/content, lib/studioActions); every confirm keeps today's words.
// `advance` walks to the next row in the queue (or closes) after a decision.
export function useDraftVerbs(d: ContentDraftDetail, lane: Lane, advance: () => void, refresh: () => void) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.post_body ?? '')
  const [shown, setShown] = useState(d.post_body ?? '')
  const base = useRef(d.post_body ?? '')
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [visible, setVisible] = useState(d.board_visible === true)

  // A refetch (an engine rewrite) re-seats the read view, never mid-edit.
  useEffect(() => {
    if (editing) return
    setShown(d.post_body ?? ''); setText(d.post_body ?? ''); base.current = d.post_body ?? ''
  }, [d.id, d.post_body, editing])
  useEffect(() => { setVisible(d.board_visible === true) }, [d.id, d.board_visible])

  const fail = (e: unknown, what: string) => setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : `Could not ${what}.`)

  const startEdit = useCallback(() => { setText(shown); setEditing(true); setErr(''); setConflict(null) }, [shown])
  const cancelEdit = useCallback(() => { setEditing(false); setText(shown); setConflict(null); setErr('') }, [shown])

  const save = useCallback(async (body: string = text) => {
    setBusy(true); setErr(''); setConflict(null)
    try {
      await (lane === 'ivan'
        ? saveDraftBody(d.id, body, d.taxonomy, base.current, d.updated_at)
        : saveClientDraftBody(d.id, body, d.taxonomy, base.current, d.updated_at))
      base.current = body; setShown(body); setEditing(false)
      toast.show({ message: 'Saved.', sub: 'Marked as edited by you, so a regeneration will not overwrite it.' })
      refresh()
    } catch (e) {
      if (e instanceof DraftSaveConflict) setConflict(e.detail)
      else fail(e, 'save')
    } finally { setBusy(false) }
  }, [d.id, d.taxonomy, d.updated_at, lane, refresh, text, toast])

  const takeTheirs = useCallback(() => {
    const t = conflict?.theirs ?? ''
    base.current = t; setShown(t); setText(t); setEditing(false); setConflict(null); refresh()
  }, [conflict, refresh])
  const keepMine = useCallback(async () => {
    base.current = conflict?.theirs ?? ''
    setConflict(null)
    await save(text)
  }, [conflict, save, text])

  const decide = useCallback(async (kind: 'approve' | 'skip') => {
    if (editing || busy) return
    const overriding = d.status === 'error'
    const ok = (kind === 'approve' && !overriding) || await confirm(kind === 'approve' ? {
      title: 'Approve this draft anyway?',
      message: 'QA refused this one. Approving overrides that verdict. Nothing publishes, scheduling is the separate act below.',
      confirmText: 'Approve', verb: 'confirm',
    } : {
      title: 'Skip this draft?', message: 'Marks it disqualified, it drops out of the queue for good.', confirmText: 'Skip', verb: 'confirm',
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await (kind === 'approve' ? approveDraft(d.id) : skipDraft(d.id))
      toast.show({ message: kind === 'approve' ? 'Approved. Nothing publishes until it is scheduled.' : 'Skipped. It left the queue.' })
      refresh(); advance()
    } catch (e) { fail(e, kind) } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, d.status, editing, refresh, toast])

  const schedule = useCallback(async (at: Date) => {
    if (editing || busy) return
    if (Number.isNaN(at.getTime())) { setErr('That is not a time.'); return }
    const already = d.status === 'scheduled'
    const ok = await confirm({
      title: already ? 'Move this post?' : 'Put this post on LinkedIn?',
      message: `The publisher posts this on ${at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} `
        + `at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This is not an internal mark, it goes out on LinkedIn.`,
      confirmText: already ? 'Reschedule' : 'Schedule it', verb: 'confirm',
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await scheduleDraft(d.id, at.toISOString())
      toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.`, sub: 'The publisher posts it then.' })
      refresh(); if (!already) advance()
    } catch (e) { fail(e, 'schedule it') } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, d.status, editing, refresh, toast])

  const board = useCallback(async (next: boolean) => {
    if (busy) return
    const ok = await confirm(next ? {
      title: `Put this on ${POSS[lane]} board?`,
      message: `${OWNER[lane]} sees it. This is the one action here that reaches a client, it fires his board’s `
        + 'own sync, so it lands on his board within moments, not at some later batch. From there '
        + 'the decisions are his: approve, edit, veto, schedule. '
        + 'Nothing publishes, this writes board visibility and never touches the publisher.',
      confirmText: 'Put it on his board', verb: 'confirm',
    } : {
      title: `Take this off ${POSS[lane]} board?`,
      message: 'It goes back to our side only and disappears from his board on the same sync. Nothing is '
        + 'deleted and no status changes, the draft stays here, and you can put it back.',
      confirmText: 'Take it off', verb: 'confirm',
    })
    if (!ok) return
    setBusy(true); setErr(''); setVisible(next)
    try {
      await setBoardVisible(d.id, next)
      toast.show({ message: next ? `On ${POSS[lane]} board.` : `Off ${POSS[lane]} board.`, sub: next ? 'Undo: open it again and Take off his board.' : 'Nothing was deleted.' })
      refresh(); if (next) advance()
    } catch (e) { setVisible(!next); fail(e, 'change the board') } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, lane, refresh, toast])

  const removeClient = useCallback(async () => {
    if (busy) return
    const ok = await confirm({
      title: 'Delete this draft?', message: `${OWNER[lane]} has never seen it, and this removes it permanently.`,
      confirmText: 'Delete', verb: 'confirm',
    })
    if (!ok) return
    setBusy(true); setErr('')
    try { await deleteClientDraft(d.id, d.taxonomy); toast.show({ message: 'Deleted.' }); refresh(); advance() }
    catch (e) { fail(e, 'delete') } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, d.taxonomy, lane, refresh, toast])

  return { editing, text, setText, shown, conflict, busy, err, visible, startEdit, cancelEdit, save, takeTheirs, keepMine, decide, schedule, board, removeClient }
}
