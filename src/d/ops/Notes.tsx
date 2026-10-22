import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cacheOpsNotes, cachedOpsNotes, deleteOpsNote, fetchOpsNotes, notePreview, noteTitle, saveOpsNote, type OpsNote,
} from '../../lib/opsNotes'
import { Btn } from '../ui/Key'
import { useToast } from '../ui/toast'
import { ago } from './model'

// NOTES (Ivan 2026-10-22): free notes on Ops, as many as he wants. "New note"
// opens an empty one with the cursor in it; typing saves itself (a pause, a
// blur, leaving the tab); the first line is the title in the list. Delete is
// one tap with Undo in the toast, never a confirm. A note closed empty goes
// away by itself. Saved in Supabase (db/297), so phone and desktop share them;
// the last read paints first from localStorage.

const SHOWN = 5
const SAVE_MS = 600
type SaveState = 'saving' | 'saved' | 'failed'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Notes() {
  const toast = useToast()
  const [notes, setNotes] = useState<OpsNote[]>(() => cachedOpsNotes() ?? [])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const notesRef = useRef(notes)
  notesRef.current = notes
  const onServer = useRef(new Set<string>(notes.map(n => n.id)))
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const inflight = useRef(new Map<string, Promise<void>>())
  const dirty = useRef(new Set<string>())

  const setOne = (id: string, s: SaveState | null) => setSaveState(m => {
    const next = { ...m }
    if (s) next[id] = s; else delete next[id]
    return next
  })

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('')
    try {
      const rows = await fetchOpsNotes()
      rows.forEach(r => onServer.current.add(r.id))
      // A note being typed (or not yet saved) keeps the local text.
      setNotes(cur => {
        const local = cur.filter(n => timers.current.has(n.id) || inflight.current.has(n.id) || !onServer.current.has(n.id))
        const ids = new Set(local.map(n => n.id))
        return [...local, ...rows.filter(r => !ids.has(r.id))].sort((a, b) => b.created_at.localeCompare(a.created_at))
      })
    } catch (e) { setLoadErr(errText(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { cacheOpsNotes(notes.filter(n => n.body.trim())) }, [notes])

  const saveNow = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    const note = notesRef.current.find(n => n.id === id)
    if (!note) return
    if (!note.body.trim() && !onServer.current.has(id)) return
    if (inflight.current.has(id)) { dirty.current.add(id); return }
    setOne(id, 'saving')
    const p = saveOpsNote(id, note.body)
      .then(row => {
        onServer.current.add(id)
        setNotes(cur => cur.map(n => n.id === id ? { ...n, created_at: row.created_at, updated_at: row.updated_at } : n))
        if (!dirty.current.has(id)) setOne(id, 'saved')
      })
      .catch(() => setOne(id, 'failed'))
      .finally(() => {
        inflight.current.delete(id)
        if (dirty.current.delete(id)) saveNow(id)
      })
    inflight.current.set(id, p)
  }, [])

  // Leaving the tab or the page never loses a half-typed note.
  useEffect(() => {
    const flush = () => { for (const id of [...timers.current.keys()]) saveNow(id) }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', flush); flush() }
  }, [saveNow])

  function edit(id: string, body: string) {
    setNotes(cur => cur.map(n => n.id === id ? { ...n, body, updated_at: new Date().toISOString() } : n))
    notesRef.current = notesRef.current.map(n => n.id === id ? { ...n, body } : n)
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => saveNow(id), SAVE_MS))
  }

  function create() {
    if (openId) close(openId)
    const now = new Date().toISOString()
    const note: OpsNote = { id: crypto.randomUUID(), body: '', created_at: now, updated_at: now }
    setNotes(cur => [note, ...cur])
    setOpenId(note.id)
  }

  async function drop(id: string) {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    dirty.current.delete(id)
    setNotes(cur => cur.filter(n => n.id !== id))
    setOne(id, null)
    await inflight.current.get(id)
    if (!onServer.current.has(id)) return
    await deleteOpsNote(id)
    onServer.current.delete(id)
  }

  function close(id: string) {
    setOpenId(o => (o === id ? null : o))
    const note = notesRef.current.find(n => n.id === id)
    if (note && !note.body.trim()) { void drop(id).catch(() => {}); return }
    if (timers.current.has(id)) saveNow(id)
  }

  function open(id: string) {
    if (openId && openId !== id) close(openId)
    setOpenId(id)
  }

  function remove(note: OpsNote) {
    if (openId === note.id) setOpenId(null)
    const body = notesRef.current.find(n => n.id === note.id)?.body ?? note.body
    drop(note.id).catch(e => {
      setNotes(cur => cur.some(n => n.id === note.id) ? cur : [{ ...note, body }, ...cur].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      toast.show({ id: `note-${note.id}`, message: 'Could not delete the note.', sub: errText(e), tone: 'failed' })
    })
    if (!body.trim()) return
    toast.show({
      id: `note-${note.id}`, message: 'Note deleted.', sub: noteTitle(body),
      action: { label: 'Undo', verb: 'undo', run: () => {
        setNotes(cur => [{ ...note, body }, ...cur.filter(n => n.id !== note.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)))
        notesRef.current = [{ ...note, body }, ...notesRef.current.filter(n => n.id !== note.id)]
        saveNow(note.id)
      } },
    })
  }

  const shown = all ? notes : notes.slice(0, SHOWN)
  const live = notes.filter(n => n.body.trim()).length

  return (
    <section className="op-notes" aria-label="Notes">
      <div className="op-sec">
        <span>Notes <b className={live ? '' : 'op-dim'}>{live}</b></span>
        <Btn verb="new-note" onClick={create}>New note</Btn>
      </div>
      {loadErr && <div className="op-err op-pad">Could not read your notes. <button type="button" className="op-rm" onClick={() => void load()}>Retry</button></div>}
      {!loading && !loadErr && notes.length === 0 && <div className="op-quiet">No notes yet.</div>}
      {loading && notes.length === 0 && <div className="op-quiet">Reading your notes…</div>}
      {shown.map(n => n.id === openId
        ? <Editor key={n.id} note={n} state={saveState[n.id]} onEdit={b => edit(n.id, b)} onClose={() => close(n.id)} onRemove={() => remove(n)} onRetry={() => saveNow(n.id)} />
        : <button type="button" key={n.id} className="op-nr" data-note={n.id} onClick={() => open(n.id)}>
            <span className="op-nrt"><b>{noteTitle(n.body) || 'Empty note'}</b><time>{ago(n.updated_at)}</time></span>
            {notePreview(n.body) && <small>{notePreview(n.body)}</small>}
            {saveState[n.id] === 'failed' && <small className="op-err">Not saved. Open it to retry.</small>}
          </button>)}
      {notes.length > SHOWN && (
        <button type="button" className="op-fold" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span>{all ? 'Show fewer' : `${notes.length - SHOWN} more notes`}</span>
        </button>
      )}
    </section>
  )
}

function Editor({ note, state, onEdit, onClose, onRemove, onRetry }: {
  note: OpsNote; state?: SaveState; onEdit: (body: string) => void; onClose: () => void; onRemove: () => void; onRetry: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <div className="op-ne" data-note={note.id} data-open="">
      <textarea ref={ref} value={note.body} placeholder="Write a note… the first line is its title" aria-label="Note"
        onChange={e => onEdit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onClose() }
        }} />
      <div className="op-nf">
        <span className={state === 'failed' ? 'op-err' : undefined} aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'failed'
            ? <>Not saved. <button type="button" className="op-rm" data-verb="retry" onClick={onRetry}>Retry</button></>
            : state === 'saved' ? 'Saved' : note.body.trim() ? '' : 'Saves as you type'}
        </span>
        <button type="button" className="op-rm" data-verb="delete-note" onClick={onRemove} aria-label={`Delete note: ${noteTitle(note.body) || 'empty'}`}>delete</button>
        <Btn verb="close-note" onClick={onClose}>Done</Btn>
      </div>
    </div>
  )
}
