import { useEffect, useState } from 'react'
import { mediaChoiceOf, mediaOptionsOf, setDraftMediaChoice, type ContentDraft, type MediaChoice } from '../../../lib/content'
import { useToast } from '../../ui/toast'

// Video / Photos / Text only on a copied X post (report #29, 2026-11-06). The ingestor
// copies the tweet's video and photos; LinkedIn posts one kind, the video by default.
// Shown only when the draft carries a stored video and something else to switch to.
// Every switch gets an Undo (switches back).
const LABEL: Record<MediaChoice, string> = { video: 'Video', photos: 'Photos', text: 'Text only' }
const DONE: Record<MediaChoice, string> = { video: 'Posts the video.', photos: 'Posts the photos.', text: 'Posts text only.' }

export function MediaSwitch({ d, onDone, disabled }: {
  d: Pick<ContentDraft, 'id' | 'type' | 'image_urls' | 'taxonomy'>
  onDone: () => void
  disabled?: boolean
}) {
  const toast = useToast()
  const [busy, setBusy] = useState<MediaChoice | null>(null)
  const [shown, setShown] = useState<MediaChoice | null>(null)
  // A refetch re-seats the switch on what the row holds.
  useEffect(() => { setShown(null) }, [d.type, d.image_urls])
  const opts = mediaOptionsOf(d)
  if (!opts) return null
  const now = shown ?? mediaChoiceOf(d)

  const pick = async (to: MediaChoice, from = now) => {
    if (to === from || busy) return
    setBusy(to); setShown(to)
    try {
      await setDraftMediaChoice(d.id, to)
      toast.show({ message: DONE[to], action: { label: 'Undo', verb: 'media-undo', run: () => { void pick(from, to) } } })
      onDone()
    } catch (e) {
      setShown(null)
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'The switch did not go through.', sub: 'The post keeps its media.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="cv2-media" role="group" aria-label="What this post shows">
      {opts.map(c => (
        <button key={c} type="button" data-verb="media-choice" data-choice={c} aria-pressed={now === c}
          disabled={disabled || !!busy} onClick={() => void pick(c)}>{busy === c ? 'Saving…' : LABEL[c]}</button>
      ))}
    </div>
  )
}
