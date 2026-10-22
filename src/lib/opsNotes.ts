import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

// OPS NOTES (db/297): Ivan's own free-text notes on the Ops page. Personal,
// nothing reads them and nothing is sent. Delete is soft, so Undo is a save.

export type OpsNote = { id: string; body: string; created_at: string; updated_at: string }

const CACHE_KEY = 'ops-notes-v1'

function isNote(x: unknown): x is OpsNote {
  if (!x || typeof x !== 'object') return false
  const n = x as Record<string, unknown>
  return typeof n.id === 'string' && typeof n.body === 'string' && typeof n.created_at === 'string' && typeof n.updated_at === 'string'
}

/** The last read, for a first paint before the network answers. */
export function cachedOpsNotes(): OpsNote[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const v = raw ? JSON.parse(raw) : null
    return Array.isArray(v) && v.every(isNote) ? v : null
  } catch { return null }
}
export function cacheOpsNotes(notes: OpsNote[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(notes)) } catch { /* private mode / full */ }
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
