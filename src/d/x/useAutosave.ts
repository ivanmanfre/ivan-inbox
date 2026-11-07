import { useCallback, useEffect, useRef, useState } from 'react'

// AUTOSAVE THAT NEVER LOSES TYPING. The text lives in React state and in a device backup
// (localStorage) until the server has it; a failed save keeps both and says so, and the next
// keystroke or Retry tries again. Saves are serial: one in flight, the latest text after it.

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

const DEBOUNCE_MS = 1200

function readBackup<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as { v: T }).v : null } catch { return null }
}
function writeBackup<T>(key: string, v: T | null) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify({ v, at: Date.now() })) } catch { /* full or private */ }
}

/**
 * `server` is what the database holds when the screen opens. Returns the value to edit
 * (the device backup wins when it differs, `restored` says so), its setter and the save state.
 */
export function useAutosave<T>({ backupKey, server, equal, save, enabled }: {
  backupKey: string; server: T; equal: (a: T, b: T) => boolean; save: (v: T) => Promise<void>; enabled: boolean
}) {
  const [init] = useState(() => {
    const b = enabled ? readBackup<T>(backupKey) : null
    if (!enabled) writeBackup(backupKey, null)
    return b !== null && !equal(b, server) ? { v: b, restored: true } : { v: server, restored: false }
  })
  const [value, setValue] = useState<T>(init.v)
  const [status, setStatus] = useState<SaveStatus>(init.restored ? 'dirty' : 'saved')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const saved = useRef<T>(server)
  const latest = useRef<T>(value)
  latest.current = value
  const running = useRef<Promise<boolean> | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save
  const eq = useRef(equal)
  eq.current = equal
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    while (running.current) await running.current
    const v = latest.current
    if (eq.current(v, saved.current)) { if (alive.current) setStatus('saved'); return true }
    if (alive.current) setStatus('saving')
    const p = saveRef.current(v).then(() => {
      saved.current = v
      if (eq.current(latest.current, v)) writeBackup(backupKey, null)
      if (alive.current) { setSavedAt(Date.now()); setError(null); setStatus(eq.current(latest.current, v) ? 'saved' : 'dirty') }
      return true
    }, (e: unknown) => {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setStatus('error') }
      return false
    })
    running.current = p
    const ok = await p
    running.current = null
    return ok
  }, [backupKey])

  // Every change: back it up on the device at once, save it after a pause.
  useEffect(() => {
    if (!enabled) return
    if (eq.current(value, saved.current)) return
    writeBackup(backupKey, value)
    setStatus(s => (s === 'error' ? s : 'dirty'))
    const t = window.setTimeout(() => { void flush() }, DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [value, enabled, backupKey, flush])

  // Leaving the screen with unsaved text: one last try (the backup stays if it fails).
  useEffect(() => () => {
    if (enabled && !eq.current(latest.current, saved.current)) void saveRef.current(latest.current).then(() => writeBackup(backupKey, null), () => {})
  }, [enabled, backupKey])

  return { value, setValue, status, error, savedAt, flush, restored: init.restored }
}
