import { useEffect, useRef, useState } from 'react'
import { DraftSaveConflict, type ContentDraft } from '../../../lib/content'
import { readCopyVersions, switchDraftCopy, wordCount, type CopySide, type CopyVersions } from '../../../lib/copyVersions'
import { useToast } from '../../ui/toast'
import './copy-switch.css'

// Long / Short on a copied X post (Poland lane, 2026-11-14). The long version is the body the ingestor
// wrote; the short one is the near word-for-word copy. Shown only when the draft holds both. One tap
// saves the other text as the post through the editor's own save; the text it replaces is kept on the
// draft, so the way back is the same tap. Every switch gets an Undo.
const LABEL: Record<CopySide, string> = { long: 'Long', short: 'Short' }

export function CopySwitch({ d, body, onSaved, onChanged, disabled }: {
  d: Pick<ContentDraft, 'id' | 'updated_at'> & { source_kind?: string | null }
  /** The post text the row shows now (a just-saved edit included). */
  body: string
  onSaved: (body: string) => void
  onChanged: () => void
  disabled?: boolean
}) {
  const toast = useToast()
  const [v, setV] = useState<CopyVersions | null>(null)
  const [busy, setBusy] = useState<CopySide | null>(null)
  const inFlight = useRef(false)
  const tracked = d.source_kind === 'x_tracked_outlier'
  // Read on open, and again whenever the row or its text moves (a save, a switch, a refetch).
  useEffect(() => {
    if (!tracked) { setV(null); return }
    let off = false
    readCopyVersions(d.id).then(x => { if (!off) setV(x) }).catch(() => { if (!off) setV(null) })
    return () => { off = true }
  }, [tracked, d.id, d.updated_at, body])
  if (!tracked || !v) return null

  const pick = async (to: CopySide, base = body) => {
    if (to === v.now || inFlight.current) return
    const from = v.now
    inFlight.current = true; setBusy(to)
    try {
      const next = await switchDraftCopy(d.id, to, base)
      setV({ now: to, long: to === 'long' ? next : base, short: to === 'short' ? next : base })
      onSaved(next)
      toast.show({ id: `copy-${d.id}`, message: to === 'short' ? 'The short version is the post now.' : 'The long version is the post now.',
        action: { label: 'Undo', verb: 'copy-undo', run: () => { void undo(from, next) } } })
      onChanged()
    } catch (e) {
      toast.show({ id: `copy-${d.id}`, tone: 'failed', message: e instanceof DraftSaveConflict ? 'This post changed elsewhere. Open it to compare.' : e instanceof Error ? e.message : 'The switch did not go through.', sub: 'The post keeps its text.' })
    } finally { inFlight.current = false; setBusy(null) }
  }
  // Undo is the same switch, back, from the text the switch just wrote.
  const undo = async (to: CopySide, base: string) => {
    if (inFlight.current) return
    inFlight.current = true
    try { onSaved(await switchDraftCopy(d.id, to, base)); onChanged() }
    catch (e) { toast.show({ id: `copy-${d.id}`, tone: 'failed', message: e instanceof Error ? e.message : 'The undo did not go through.' }) }
    finally { inFlight.current = false }
  }

  return (
    <div className="cv2-copy" role="group" aria-label="Which version of the text posts">
      {(['long', 'short'] as const).map(side => {
        const n = wordCount(side === 'long' ? v.long : v.short)
        return (
          <button key={side} type="button" data-verb="copy-version" data-version={side} aria-pressed={v.now === side}
            aria-label={`${LABEL[side]} version, ${n} words`} title={v.now === side ? `The post is the ${side} version (${n} words)` : `Post the ${side} version (${n} words)`}
            disabled={disabled || !!busy} onClick={() => void pick(side)}>
            {busy === side ? 'Saving…' : <>{LABEL[side]}<i>{n}</i></>}
          </button>
        )
      })}
    </div>
  )
}
