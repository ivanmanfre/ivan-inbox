import { useCallback, useEffect, useState } from 'react'
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
  const [sections, setSections] = useState<StrategySection[]>(STARTER_SECTIONS)
  const [saved, setSaved] = useState<StrategySection[]>(STARTER_SECTIONS)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchStrategy(lane)
      .then(s => {
        setSections(s.sections)
        setSaved(s.sections)
        setUpdatedAt(s.updatedAt)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'strategy unavailable')
        setLoading(false)
      })
  }, [lane])

  useEffect(() => { refresh() }, [refresh])

  const dirty = JSON.stringify(sections) !== JSON.stringify(saved)

  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    // Snapshot what is being written. Ivan can keep typing during the round
    // trip; committing `sections` afterwards would mark those later keystrokes
    // as saved when they were never sent.
    const writing = sections
    try {
      const at = await saveStrategy(lane, writing)
      setSaved(writing)
      setUpdatedAt(at)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }, [lane, sections])

  // Unsaved work must not vanish on a tab close or a lane switch that reloads.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    sections, setSections, updatedAt, loading, error,
    saving, saveError, dirty, save, refresh,
  }
}
