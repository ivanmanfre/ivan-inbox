import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchStrategy, saveStrategy, STARTER_SECTIONS,
  type StrategySection,
} from '../lib/strategy'
import type { ContentLane } from '../lib/content'

// The Strategy tab's state. Unlike the other content hooks this one OWNS the
// rows it shows — nothing upstream writes them — so it holds a local draft of
// the sections and reconciles on save.
//
// Deliberately no realtime channel and no focus refetch: this surface is a text
// editor. A refetch while Ivan is mid-sentence would replace the textarea he is
// typing into with whatever the server last saw, and the server last saw the
// version BEFORE his sentence. Refresh is manual (pull-to-refresh / the button)
// and blocked while the draft is dirty.
export function useStrategy(lane: ContentLane) {
  const readVersion = useRef(0)
  const currentLane = useRef(lane)
  currentLane.current = lane
  const [loadedLane, setLoadedLane] = useState<ContentLane | null>(null)
  const [sections, setSections] = useState<StrategySection[]>(STARTER_SECTIONS)
  const [saved, setSaved] = useState<StrategySection[]>(STARTER_SECTIONS)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const version = ++readVersion.current
    setLoadedLane(null)
    setLoading(true)
    setError(null)
    setSaveError(null)
    fetchStrategy(lane)
      .then(s => {
        if (version !== readVersion.current || currentLane.current !== lane) return
        setLoadedLane(lane)
        setSections(s.sections)
        setSaved(s.sections)
        setUpdatedAt(s.updatedAt)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (version !== readVersion.current || currentLane.current !== lane) return
        setError(e instanceof Error ? e.message : 'strategy unavailable')
        setLoading(false)
      })
  }, [lane])

  useEffect(() => { refresh(); return () => { readVersion.current += 1 } }, [refresh])

  const dirty = loadedLane === lane && JSON.stringify(sections) !== JSON.stringify(saved)

  const save = useCallback(async () => {
    if (loadedLane !== lane || loading) return
    setSaving(true)
    setSaveError(null)
    // Snapshot what is being written. Ivan can keep typing during the round
    // trip; committing `sections` afterwards would mark those later keystrokes
    // as saved when they were never sent.
    const writing = sections
    try {
      const at = await saveStrategy(lane, writing)
      if (currentLane.current !== lane) return
      setSaved(writing)
      setUpdatedAt(at)
    } catch (e: unknown) {
      if (currentLane.current !== lane) return
      setSaveError(e instanceof Error ? e.message : 'save failed')
    } finally {
      if (currentLane.current === lane) setSaving(false)
    }
  }, [lane, sections, loadedLane, loading])

  // Unsaved work must not vanish on a tab close or a lane switch that reloads.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    sections, setSections, updatedAt: loadedLane === lane ? updatedAt : null, loading: loading || (!error && loadedLane !== lane), error,
    saving, saveError, dirty, save, refresh,
  }
}
