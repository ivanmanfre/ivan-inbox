import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cacheOpsNotes, cachedOpsNotes, deleteOpsNote, fetchOpsNotes, flushOpsNote, notePreview, noteTitle, saveOpsNote,
  watchOpsNotesSession, type OpsNote, type OpsNotesSession,
} from '../../lib/opsNotes'
import { Btn } from '../ui/Key'
import { useToast } from '../ui/toast'
import { ago } from './model'

// NOTES (Ivan 2026-10-22): free notes on Ops, as many as he wants. "New note"
// opens an empty one with the cursor in it; typing saves itself (a pause, a
// blur, Done, leaving the tab); the first line is the title in the list.
// Delete is one tap with Undo in the toast, never a confirm; emptying a saved
// note and closing it is a delete with the same Undo. Saved in Supabase
// (db/297), so phone and desktop share them.
//
// What keeps a note from being lost:
//  - `server` is what the server holds per id. A note whose text differs from
//    it is unsaved, is cached as such, and is saved again on the next read.
//  - Every write for one note runs in order on that note's chain, so an Undo
//    tapped while its delete is in flight saves after the delete.
//  - A read never overwrites a note changed here after the read started.

const SHOWN = 5
const SAVE_MS = 600
const CACHE_MS = 500
type SaveState = 'saving' | 'saved' | 'failed'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const byNewest = (a: OpsNote, b: OpsNote) => b.created_at.localeCompare(a.created_at)

export function Notes() {
  const toast = useToast()
  const [notes, setNotes] = useState<OpsNote[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  // The refs are the truth the async writes read; state only draws them.
  const notesRef = useRef<OpsNote[]>([])
  const openRef = useRef<string | null>(null)
  const server = useRef(new Map<string, string>())
  const touched = useRef(new Map<string, number>())
  const lastText = useRef(new Map<string, string>())
  const chain = useRef(new Map<string, Promise<unknown>>())
  const queued = useRef(new Set<string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const session = useRef<OpsNotesSession | null>(null)

  const writeCache = useCallback(() => {
    if (cacheTimer.current) { clearTimeout(cacheTimer.current); cacheTimer.current = null }
    const s = session.current
    if (s) cacheOpsNotes(s.uid, { notes: notesRef.current.filter(n => n.body.trim()), server: [...server.current] })
  }, [])
  const commit = useCallback((next: OpsNote[]) => {
    notesRef.current = next
    setNotes(next)
    if (cacheTimer.current) clearTimeout(cacheTimer.current)
    cacheTimer.current = setTimeout(writeCache, CACHE_MS)
  }, [writeCache])
  const setOne = useCallback((id: string, s: SaveState | null) => setSaveState(m => {
    if ((m[id] ?? null) === s) return m
    const next = { ...m }
    if (s) next[id] = s; else delete next[id]
    return next
  }), [])
  const setOpen = (id: string | null) => { openRef.current = id; setOpenId(id) }
  const touch = (id: string) => touched.current.set(id, Date.now())

  /** Runs `op` after every earlier write for this note settled. */
  const run = useCallback(<T,>(id: string, op: () => Promise<T>): Promise<T> => {
    const p = (chain.current.get(id) ?? Promise.resolve()).catch(() => {}).then(op)
    chain.current.set(id, p)
    void p.catch(() => {}).then(() => { if (chain.current.get(id) === p) chain.current.delete(id) })
    return p
  }, [])

  const saveNow = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    const note = notesRef.current.find(n => n.id === id)
    // An empty note is never written: closing it empty is the delete (with Undo).
    if (!note || !note.body.trim() || queued.current.has(id)) return
    if (server.current.get(id) === note.body && !chain.current.has(id)) { setOne(id, 'saved'); return }
    queued.current.add(id)
    setOne(id, 'saving')
    void run(id, async () => {
      queued.current.delete(id)
      const n = notesRef.current.find(x => x.id === id)
      if (!n || !n.body.trim()) { setOne(id, null); return }
      if (server.current.get(id) === n.body) { setOne(id, 'saved'); return }
      const body = n.body
      try {
        const row = await saveOpsNote(id, body)
        server.current.set(id, row.body)
        touch(id)
        const cur = notesRef.current.find(x => x.id === id)
        if (cur) commit(notesRef.current.map(x => x.id === id ? { ...x, created_at: row.created_at, updated_at: row.updated_at } : x))
        setOne(id, cur && cur.body !== body ? 'saving' : 'saved')
      } catch { setOne(id, 'failed') }
    })
  }, [commit, run, setOne])

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('')
    const t0 = Date.now()
    try {
      const rows = await fetchOpsNotes()
      const before = new Map(server.current)
      const fresh = (id: string) => (touched.current.get(id) ?? 0) <= t0
      const live = new Set(rows.map(r => r.id))
      for (const r of rows) if (fresh(r.id)) server.current.set(r.id, r.body)
      for (const id of [...server.current.keys()]) if (!live.has(id) && fresh(id)) server.current.delete(id)
      const out = new Map<string, OpsNote>()
      for (const r of rows) if (fresh(r.id) && r.body.trim()) out.set(r.id, r)
      // Kept as typed here: changed since the read began, never confirmed by the
      // server, or open. An unchanged note the server no longer lists was deleted elsewhere.
      for (const n of notesRef.current) {
        if (!fresh(n.id) || n.body !== before.get(n.id) || n.id === openRef.current) out.set(n.id, n)
      }
      commit([...out.values()].sort(byNewest))
      for (const n of out.values()) {
        if (n.body.trim() && server.current.get(n.id) !== n.body && !timers.current.has(n.id)) saveNow(n.id)
      }
    } catch (e) { setLoadErr(errText(e)) }
    finally { setLoading(false) }
  }, [commit, saveNow])

  // The signed-in user: their cached notes paint first, then the read. A new account starts clean.
  useEffect(() => {
    let uid: string | undefined
    return watchOpsNotesSession(s => {
      session.current = s
      if (uid === s?.uid) return
      const first = uid === undefined
      uid = s?.uid ?? ''
      const c = s ? cachedOpsNotes(s.uid) : null
      if (!first || c) {
        server.current = new Map(c?.server ?? [])
        commit(c?.notes ?? [])
      }
      void load()
    })
  }, [commit, load])

  // Leaving the tab or the page never loses a half-typed note: a keepalive save
  // plus the local copy (which marks it unsaved until the server confirms).
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      for (const n of notesRef.current) {
        const t = timers.current.get(n.id)
        if (t) { clearTimeout(t); timers.current.delete(n.id) }
        if (!n.body.trim() || server.current.get(n.id) === n.body) continue
        if (keepalive && session.current) flushOpsNote(session.current.token, n.id, n.body)
        else saveNow(n.id)
      }
      writeCache()
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush(true); else void load() }
    const onHide = () => flush(true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      flush(false)
    }
  }, [load, saveNow, writeCache])

  function edit(id: string, body: string) {
    commit(notesRef.current.map(n => n.id === id ? { ...n, body, updated_at: new Date().toISOString() } : n))
    touch(id)
    if (body.trim()) lastText.current.set(id, body)
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => saveNow(id), SAVE_MS))
  }

  function remove(id: string, restoreBody: string) {
    const note = notesRef.current.find(n => n.id === id)
    if (!note) return
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    if (openRef.current === id) setOpen(null)
    commit(notesRef.current.filter(n => n.id !== id))
    touch(id)
    setOne(id, null)
    if (server.current.has(id) || chain.current.has(id)) {
      run(id, async () => {
        if (!server.current.has(id)) return
        await deleteOpsNote(id)
        server.current.delete(id)
        touch(id)
        writeCache()
      }).catch(e => {
        if (!notesRef.current.some(n => n.id === id)) commit([...notesRef.current, { ...note, body: server.current.get(id) ?? restoreBody }].sort(byNewest))
        toast.show({ id: `note-${id}`, message: 'Could not delete the note.', sub: errText(e), tone: 'failed' })
      })
    }
    if (!restoreBody.trim()) return
    toast.show({
      id: `note-${id}`, message: 'Note deleted.', sub: noteTitle(restoreBody),
      action: { label: 'Undo', verb: 'undo', run: () => {
        if (notesRef.current.some(n => n.id === id)) return
        commit([{ ...note, body: restoreBody }, ...notesRef.current].sort(byNewest))
        touch(id)
        lastText.current.set(id, restoreBody)
        saveNow(id)
      } },
    })
  }
  const restoreText = (n: OpsNote) => n.body.trim() ? n.body : lastText.current.get(n.id) ?? server.current.get(n.id) ?? ''

  function close(id: string) {
    if (openRef.current === id) setOpen(null)
    const note = notesRef.current.find(n => n.id === id)
    if (!note) return
    if (note.body.trim()) { saveNow(id); return }
    if (server.current.has(id) || chain.current.has(id)) remove(id, restoreText(note))
    else commit(notesRef.current.filter(n => n.id !== id))
  }
  function open(id: string) {
    if (openRef.current && openRef.current !== id) close(openRef.current)
    setOpen(id)
  }
  function create() {
    if (openRef.current) close(openRef.current)
    const now = new Date().toISOString()
    const note: OpsNote = { id: crypto.randomUUID(), body: '', created_at: now, updated_at: now }
    commit([note, ...notesRef.current])
    touch(note.id)
    setOpen(note.id)
  }

  const list = notes.filter(n => n.body.trim() || n.id === openId)
  const shown = all ? list : list.slice(0, SHOWN)
  const live = list.filter(n => n.body.trim()).length

  return (
    <section className="op-notes" aria-label="Notes">
      <div className="op-sec">
        <span>Notes <b className={live ? '' : 'op-dim'}>{live}</b></span>
        <Btn verb="new-note" onClick={create}>New note</Btn>
      </div>
      {loadErr && <div className="op-err op-pad">Could not read your notes. <button type="button" className="op-rm" onClick={() => void load()}>Retry</button></div>}
      {!loading && !loadErr && list.length === 0 && <div className="op-quiet">No notes yet.</div>}
      {loading && list.length === 0 && <div className="op-quiet">Reading your notes…</div>}
      {shown.map(n => n.id === openId
        ? <Editor key={n.id} note={n} state={saveState[n.id]} onEdit={b => edit(n.id, b)} onSave={() => saveNow(n.id)} onClose={() => close(n.id)}
            onRemove={() => remove(n.id, restoreText(n))} />
        : <button type="button" key={n.id} className="op-nr" data-note={n.id} onClick={() => open(n.id)}>
            <span className="op-nrt"><b>{noteTitle(n.body)}</b><time>{ago(n.updated_at)}</time></span>
            {notePreview(n.body) && <small>{notePreview(n.body)}</small>}
            {saveState[n.id] === 'failed' && <small className="op-err">Not saved. Open it to retry.</small>}
          </button>)}
      {list.length > SHOWN && (
        <button type="button" className="op-fold" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span>{all ? 'Show fewer' : `${list.length - SHOWN} more notes`}</span>
        </button>
      )}
    </section>
  )
}

function Editor({ note, state, onEdit, onSave, onClose, onRemove }: {
  note: OpsNote; state?: SaveState; onEdit: (body: string) => void; onSave: () => void; onClose: () => void; onRemove: () => void
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
        onChange={e => onEdit(e.target.value)} onBlur={onSave}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onClose() }
        }} />
      <div className="op-nf">
        <span className={state === 'failed' ? 'op-err' : undefined} aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'failed'
            ? <>Not saved. <button type="button" className="op-rm" data-verb="retry" onClick={onSave}>Retry</button></>
            : state === 'saved' ? 'Saved' : note.body.trim() ? '' : 'Saves as you type'}
        </span>
        <button type="button" className="op-rm" data-verb="delete-note" onClick={onRemove} aria-label={`Delete note: ${noteTitle(note.body) || 'empty'}`}>delete</button>
        <Btn verb="close-note" onClick={onClose}>Done</Btn>
      </div>
    </div>
  )
}
