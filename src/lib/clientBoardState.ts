import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'

// WHAT THE CLIENT SAID ON THEIR PANEL, per post (db/243 operator_client_board_state). Ivan
// 2026-10-08: the inbox and the client panels must agree. The panel writes approvals, removals and
// change requests only to client_board_actions; the ARCH publisher sends a dated post only when
// Davorin's approve is the latest approve/undo event, and a removal stops either publisher. Read
// once per client, again on focus and every 2 minutes; nothing here writes.

export type BoardState = {
  id: string
  approval: 'approve' | 'undo_approve' | null
  approval_at: string | null
  veto: 'post_removed' | 'post_restored' | 'angle_swap' | 'angle_swap_undone' | null
  veto_at: string | null
  note: string | null
  note_by: string | null
  note_at: string | null
}

export const BOARD_CLIENTS = ['arch', 'risedtc'] as const
const GATE = 'clientops'
const EVERY_MS = 120_000

const byClient = new Map<string, Map<string, BoardState>>()
let version = 0
const subs = new Set<() => void>()
const emit = () => { version += 1; subs.forEach(f => f()) }

export function boardStateOf(id: string): BoardState | undefined {
  for (const m of byClient.values()) { const s = m.get(id); if (s) return s }
  return undefined
}
/** True once the client's panel state has been read, so "no approval" means none, not "not read yet". */
export function boardStateLoaded(client: string | null | undefined): boolean { return !!client && byClient.has(client) }

/** Test seam and the loader's one write path. */
export function setBoardState(client: string, rows: BoardState[]): void {
  byClient.set(client, new Map(rows.map(r => [r.id, r])))
  emit()
}
/** Test seam: forget a client's state, as if never read. */
export function clearBoardState(client: string): void { byClient.delete(client); emit() }

export async function refreshClientBoardState(clients: readonly string[] = BOARD_CLIENTS): Promise<void> {
  await Promise.all(clients.map(async client => {
    const { data, error } = await supabase.rpc('operator_client_board_state', { p_gate: GATE, p_client: client })
    const res = data as { ok?: boolean; rows?: BoardState[] } | null
    if (error || !res?.ok) return // keep what we had: an unread state never turns into "not approved"
    setBoardState(client, res.rows ?? [])
  }))
}

/** Mount once where Content renders; returns a version so callers re-render when it changes. */
export function useClientBoardState(): number {
  const v = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => version, () => version)
  useEffect(() => {
    void refreshClientBoardState()
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshClientBoardState() }
    const t = setInterval(() => void refreshClientBoardState(), EVERY_MS)
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [])
  return v
}

const after = (a: string | null, b: string | null) => !!a && (!b || Date.parse(a) > Date.parse(b))

export type ClientHold = { kind: 'removed' | 'awaiting' | 'unarmed' | 'changes'; text: string; detail?: string }

/** Why a client post that looks scheduled will not go out, or what the client asked for. Null = nothing to say.
 *  `owner` is the client's first name (Davorin, Mattan). */
export function clientHoldOf(r: {
  id: string; client_id?: string | null; status: string; scheduled_at?: string | null; published_at?: string | null
  board_visible?: boolean | null; updated_at?: string | null
}, owner: string): ClientHold | null {
  if (!r.client_id || r.client_id === 'ivan' || r.published_at) return null
  const s = boardStateOf(r.id)
  if (s && (s.veto === 'post_removed' || s.veto === 'angle_swap')) return { kind: 'removed', text: `Removed by ${owner}`, detail: `${owner} took this post off the board, so it will not publish.` }
  const dated = !!r.scheduled_at && r.board_visible === true && (r.status === 'review' || r.status === 'scheduled')
  if (dated && r.client_id === 'risedtc' && r.status !== 'scheduled') return { kind: 'unarmed', text: 'Dated, not scheduled', detail: 'Only a scheduled post publishes. Set its day again to schedule it.' }
  if (dated && r.client_id === 'arch' && boardStateLoaded('arch') && s?.approval !== 'approve') {
    return { kind: 'awaiting', text: `Waiting for ${owner}’s OK`, detail: `The Arch publisher sends it only after ${owner} approves it on his panel.` }
  }
  if (s?.note && after(s.note_at, s.approval === 'approve' ? s.approval_at : null) && after(s.note_at, r.updated_at ?? null)) {
    return { kind: 'changes', text: `${owner} asked for changes`, detail: s.note }
  }
  return null
}

/** The publisher's own rule for a client post: on the board, dated, not removed, and (RISE) scheduled
 *  or (ARCH) approved. Before the ARCH state is read, ARCH falls back to today's reading. */
export function clientWillPublish(r: Parameters<typeof clientHoldOf>[0]): boolean {
  const h = clientHoldOf(r, '')
  return !h || h.kind === 'changes'
}
