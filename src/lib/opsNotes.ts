import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

// OPS NOTES (db/297): Ivan's own free-text notes on the Ops page. Personal,
// nothing reads them and nothing is sent. Delete is soft, so Undo is a save.

export type OpsNote = { id: string; body: string; created_at: string; updated_at: string }
export type OpsNotesSession = { uid: string; token: string }
/** The local copy: the notes as last shown, and what the server held for each id. */
export type OpsNotesCache = { notes: OpsNote[]; server: [string, string][] }

// Per signed-in user: another account on the same browser never paints these.
const cacheKey = (uid: string) => `ops-notes-v2:${uid}`

function isNote(x: unknown): x is OpsNote {
  if (!x || typeof x !== 'object') return false
  const n = x as Record<string, unknown>
  return typeof n.id === 'string' && typeof n.body === 'string' && typeof n.created_at === 'string' && typeof n.updated_at === 'string'
}

export function cachedOpsNotes(uid: string): OpsNotesCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid))
    const v = raw ? JSON.parse(raw) : null
    if (!v || !Array.isArray(v.notes) || !v.notes.every(isNote) || !Array.isArray(v.server)) return null
    const server = v.server.filter((p: unknown): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string')
    return { notes: v.notes, server }
  } catch { return null }
}
export function cacheOpsNotes(uid: string, c: OpsNotesCache) {
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(c))
    localStorage.removeItem('ops-notes-v1') // the first, unscoped key
  } catch { /* private mode / full */ }
}

/** Calls back with the signed-in user now and on every change. Returns the unsubscribe. */
export function watchOpsNotesSession(cb: (s: OpsNotesSession | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, s) => {
    const v = s ? { uid: s.user.id, token: s.access_token } : null
    // Out of the auth callback: supabase-js must not be called from inside it.
    setTimeout(() => cb(v), 0)
  })
  return () => data.subscription.unsubscribe()
}

export async function fetchOpsNotes(): Promise<OpsNote[]> {
  const { data, error } = await supabase.rpc('operator_ops_notes', { p_gate: CLIENT_OPS_GATE })
  if (error) throw new Error(error.message)
  if (data?.ok !== true || !Array.isArray(data.rows) || !data.rows.every(isNote)) throw new Error('Your notes could not be read.')
  return data.rows
}

export async function saveOpsNote(id: string, body: string): Promise<OpsNote> {
  const { data, error } = await supabase.rpc('operator_save_ops_note', { p_gate: CLIENT_OPS_GATE, p_id: id, p_body: body })
  if (error) throw new Error(error.message)
  if (data?.ok !== true || !isNote(data.row) || data.row.id !== id) throw new Error('The note was not saved.')
  return data.row
}

/** The save as the page is hidden or closed: a keepalive request the browser finishes after the page is gone.
 *  Fire and forget; the local copy still marks the note unsaved, so the next read saves it again if this was lost. */
export function flushOpsNote(token: string, id: string, body: string) {
  try {
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/operator_save_ops_note`, {
      method: 'POST', keepalive: true,
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_gate: CLIENT_OPS_GATE, p_id: id, p_body: body }),
    }).catch(() => {})
  } catch { /* body over the keepalive limit: the next read saves it */ }
}

export async function deleteOpsNote(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('operator_delete_ops_note', { p_gate: CLIENT_OPS_GATE, p_id: id })
  if (error) throw new Error(error.message)
  if (data?.ok !== true) throw new Error('The note was not deleted.')
}

/** First non-empty line, the note's title in the list. */
export function noteTitle(body: string): string {
  return body.split('\n').map(l => l.trim()).find(Boolean) ?? ''
}
/** The rest after the title, on one line. */
export function notePreview(body: string): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.slice(1).join(' · ')
}
