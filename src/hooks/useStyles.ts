import { useCallback, useEffect, useState } from 'react'
import { fetchContentDrafts } from '../lib/content'
import {
  fetchResources, fetchStyleRoster, previewsByStyle,
  type Resource, type StylePreview, type StylePrompt,
} from '../lib/styles'

export function useStyles() {
  const [styles, setStyles] = useState<StylePrompt[]>([])
  const [previews, setPreviews] = useState<Map<string, StylePreview>>(() => new Map())
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    Promise.all([fetchStyleRoster(), fetchResources(), fetchContentDrafts('ivan')])
      .then(([roster, res, page]) => {
        setStyles(roster)
        setResources(res)
        setPreviews(previewsByStyle(page.rows))
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'styles unavailable')
        setLoading(false)
      })
  }, [])

  // No realtime channel. The roster is a prompt library Ivan edits by hand a
  // few times a month and the previews come from published posts, so a live
  // subscription would spend a socket to re-render the same 11 cards. Focus
  // refetch is enough — same call the seat-health guard makes for the same
  // reason (useSeatHealth.ts:4-5).
  useEffect(() => {
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [refresh])

  return { styles, previews, resources, loading, error, refresh }
}
