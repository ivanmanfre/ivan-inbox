import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClientRpcError, DraftSaveConflict, deleteClientDraft, saveClientDraftBody, saveDraftBody,
  setBoardVisible, type ContentDraftDetail, type SaveConflict,
} from '../../lib/content'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDayTime } from '../ui/time'
import { OWNER, POSS, canSchedule, type Lane } from './model'
import { scheduleGuarded } from './writes'
import { HOLD_MS, holdDecision, undoDecision } from './decisions'

// The draft window's writes. Every write is today's function with today's
// payload (lib/content, lib/studioActions); every confirm keeps today's words.
// `advance` walks to the next row in the queue (or closes) after a decision.
export function useDraftVerbs(d: ContentDraftDetail, lane: Lane, advance: () => void, refreshOwn: () => void) {
  // Today's contract: after a write, whatever list is mounted refetches (wb-rows-changed).
  const refresh = useCallback(() => { refreshOwn(); window.dispatchEvent(new Event('wb-rows-changed')) }, [refreshOwn])
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

  // Approve and Skip are one tap: the decision is held for the life of its Undo
  // toast and written when it ends (decisions.ts), and the window walks on at
  // once. The one confirm left is the QA override: approving a draft QA refused.
  const decide = useCallback(async (kind: 'approve' | 'skip') => {
    if (editing || busy) return
    if (kind === 'approve' && d.status === 'error') {
      const ok = await confirm({
        title: 'Approve this draft anyway?',
        message: 'QA refused this one. Approving overrides that verdict. Nothing publishes, scheduling is the separate act below.',
        confirmText: 'Approve', verb: 'confirm',
      })
      if (!ok) return
    }
    setErr('')
    const id = d.id
    holdDecision(id, kind, {
      onCommitted: refresh,
      onFailed: e => toast.show({ tone: 'failed', message: e instanceof Error ? e.message : `The ${kind} did not go through.`, sub: 'It is back in review.' }),
    })
    toast.show({
      id: `decide-${id}`, ms: HOLD_MS,
      message: kind === 'approve' ? 'Approved.' : 'Skipped.',
      sub: kind === 'approve' ? 'Nothing publishes until it is scheduled.' : 'It leaves the queue for good.',
      action: { label: 'Undo', verb: 'undo-decision', run: () => { if (!undoDecision(id)) toast.show({ message: 'Too late to undo: it was already written.' }) } },
    })
    advance()
  }, [advance, busy, confirm, d.id, d.status, editing, refresh, toast])

  const schedule = useCallback(async (at: Date) => {
    if (editing || busy) return
    if (Number.isNaN(at.getTime())) { setErr('That is not a time.'); return }
    if (!canSchedule(d)) { setErr(`Not offered: this draft is ${d.published_at ? 'published' : d.status}. Only a draft in review, approved or already scheduled can be put on LinkedIn.`); return }
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
      await scheduleGuarded(d.id, at.toISOString())
      toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.`, sub: 'The publisher posts it then.' })
      refresh(); if (!already) advance()
    } catch (e) { fail(e, 'schedule it') } finally { setBusy(false) }
  }, [advance, busy, confirm, d, editing, refresh, toast])

  // Put on board asks first (it reaches the client). Taking it off is one tap:
  // the receipt carries Undo, which puts it straight back.
  const board = useCallback(async (next: boolean) => {
    if (busy) return
    if (next) {
      const ok = await confirm({
        title: `Put this on ${POSS[lane]} board?`,
        message: `${OWNER[lane]} sees it. This is the one action here that reaches a client, it fires his board’s `
          + 'own sync, so it lands on his board within moments, not at some later batch. From there '
          + 'the decisions are his: approve, edit, veto, schedule. '
          + 'Nothing publishes, this writes board visibility and never touches the publisher.',
        confirmText: 'Put it on his board', verb: 'confirm',
      })
      if (!ok) return
    }
    setBusy(true); setErr(''); setVisible(next)
    const id = d.id
    const flip = (to: boolean) => setBoardVisible(id, to)
      .then(() => { toast.show({ message: to ? `Back on ${POSS[lane]} board.` : `Off ${POSS[lane]} board again.` }); refresh() })
      .catch(e => toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Could not change the board.' }))
    try {
      await setBoardVisible(id, next)
      toast.show({
        message: next ? `On ${POSS[lane]} board.` : `Off ${POSS[lane]} board.`, sub: next ? `${OWNER[lane]} decides from there.` : 'Nothing was deleted.',
        action: { label: 'Undo', verb: 'undo-board', run: () => { void flip(!next) } },
      })
      refresh(); if (next) advance()
    } catch (e) { setVisible(!next); fail(e, 'change the board') } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, lane, refresh, toast])

  const removeClient = useCallback(async () => {
    if (busy) return
    const ok = await confirm({
      title: 'Delete this draft?', message: `${OWNER[lane]} has never seen it, and this removes it permanently.`,
      confirmText: 'Delete', verb: 'confirm', danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    try { await deleteClientDraft(d.id, d.taxonomy); toast.show({ message: 'Deleted.' }); refresh(); advance() }
    catch (e) { fail(e, 'delete') } finally { setBusy(false) }
  }, [advance, busy, confirm, d.id, d.taxonomy, lane, refresh, toast])

  const dismissConflict = useCallback(() => setConflict(null), [])
  return { editing, text, setText, shown, conflict, busy, err, visible, startEdit, cancelEdit, save, takeTheirs, keepMine, dismissConflict, decide, schedule, board, removeClient }
}
