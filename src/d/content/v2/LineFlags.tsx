import { useEffect, useState } from 'react'
import { useToast } from '../../ui/toast'
import { saveDraftBody, DraftSaveConflict, type ContentDraft } from '../../../lib/content'
import { bodySha, cutLine, keepLineFlags, lineFlagsOf, needsKeep, type LineFlags } from '../../../lib/lineFlags'
import './line-flags.css'

const KIND_WORD = { personal: 'Their line', dated: 'Dated' } as const

function dayWord(iso: string | null): string {
  if (!iso) return 'an earlier'
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short' }).format(new Date(iso)) } catch { return iso.slice(0, 10) }
}

/** The flags for an Ivan row plus the sha of the body they were checked against (async, so a hook). */
export function useLineFlags(r: ContentDraft, body: string): { flags: LineFlags | null; sha: string | null; ask: boolean } {
  const flags = lineFlagsOf(r.line_flags, body)
  const [sha, setSha] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSha(null)
    if (flags) void bodySha(body).then(s => { if (live) setSha(s) })
    return () => { live = false }
  }, [body, !!flags]) // eslint-disable-line react-hooks/exhaustive-deps
  return { flags, sha, ask: needsKeep(flags, sha) }
}

/** The flagged lines under a Review row: each line, its ask, "Swap for mine" and "Cut". Approve asks once (asking). */
export function LineFlagsBlock({ r, flags, sha, body, edit, setEdit, onStartEdit, onSaved, onChanged, asking, onKeep, onBack }: {
  r: ContentDraft; flags: LineFlags; sha: string | null; body: string
  /** The row's in-place edit text (null = not editing). */
  edit: string | null; setEdit: (v: string | null) => void
  /** Opens the editor; returns true when it is the in-place box on this row (so a line can be selected in it). */
  onStartEdit: () => boolean
  onSaved: (body: string) => void; onChanged: () => void
  asking: boolean; onKeep: () => void; onBack: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const select = (line: string) => {
    let tries = 0
    const tick = () => {
      const ta = document.querySelector<HTMLTextAreaElement>(`[data-card-id="${r.id}"] textarea`)
      const i = ta ? ta.value.indexOf(line) : -1
      if (ta && i >= 0) { ta.focus(); ta.setSelectionRange(i, i + line.length); return }
      if (++tries < 12) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  const swap = (line: string) => {
    if (edit !== null) { select(line); return }
    if (onStartEdit()) select(line)
  }
  const cut = async (line: string) => {
    if (edit !== null) { setEdit(cutLine(edit, line)); return }
    const next = cutLine(body, line)
    if (next === body || busy) return
    setBusy(true)
    try {
      await saveDraftBody(r.id, next, r.taxonomy, body, r.updated_at ?? null)
      onSaved(next)
      onChanged()
      toast.show({ id: `cut-${r.id}`, message: 'Line cut.', action: { label: 'Undo', verb: 'cut-undo', run: () => {
        void saveDraftBody(r.id, body, r.taxonomy, next, null).then(() => { onSaved(body); onChanged() })
          .catch(e => toast.show({ id: `cut-${r.id}`, message: `Not undone: ${e instanceof Error ? e.message : String(e)}`, tone: 'failed' }))
      } } })
    } catch (e) {
      toast.show({ id: `cut-${r.id}`, message: e instanceof DraftSaveConflict ? 'This post changed elsewhere. Open it to compare.' : `Not cut: ${e instanceof Error ? e.message : String(e)}`, tone: 'failed' })
    } finally { setBusy(false) }
  }
  const keep = async () => {
    if (!sha || busy) return
    setBusy(true)
    try { await keepLineFlags(r.id, sha); onKeep() }
    catch (e) { toast.show({ id: `keep-${r.id}`, message: `Not approved: ${e instanceof Error ? e.message : String(e)}`, tone: 'failed' }) }
    finally { setBusy(false) }
  }

  const kept = !!sha && flags.keptSha === sha
  const n = flags.lines.length
  const rr = flags.rerun
  return (
    <div className="cv2-lf" data-line-flags data-kept={kept || undefined}>
      {rr && (
        <p className="cv2-lf-rerun">
          {rr.heldFrom ? `Taken off ${dayWord(rr.heldFrom)}. ` : ''}It repeats your {dayWord(rr.postedAt)} post
          {rr.url ? <> (<a href={rr.url} target="_blank" rel="noreferrer">{rr.impressions.toLocaleString('en-GB')} impressions</a>)</> : ` (${rr.impressions.toLocaleString('en-GB')} impressions)`}.
          {rr.boosted ? ' That post was boosted, so it does not count.' : rr.bar ? ` A re-run needs ${rr.bar.toLocaleString('en-GB')} or more.` : ''}
        </p>
      )}
      {n > 0 && (
        <ul className="cv2-lf-list" aria-label="Lines to check">
          {flags.lines.map(l => (
            <li key={l.text} className="cv2-lf-line">
              <mark className="cv2-lf-mark">{l.text}</mark>
              <span className="cv2-lf-ask"><span className="cv2-lf-kind">{l.kinds.map(k => KIND_WORD[k]).join(' · ')}</span>{l.ask ? ` ${l.ask}` : ''}</span>
              <span className="cv2-lf-keys">
                <button type="button" className="cv2-k" data-verb="flag-swap" disabled={busy} onClick={() => swap(l.text)}>Swap for mine</button>
                <button type="button" className="cv2-k cv2-k-q" data-verb="flag-cut" disabled={busy} onClick={() => void cut(l.text)}>Cut</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {kept && <p className="cv2-lf-note">You kept these as written.</p>}
      {asking && !kept && (
        <div className="cv2-lf-confirm" role="group" aria-label="Approve with flagged lines">
          <span>{n ? `${n} flagged line${n === 1 ? '' : 's'} will post as written.` : 'This re-run is under the bar.'} Approve anyway?</span>
          <button type="button" className="cv2-k cv2-k-p" data-verb="flag-keep-approve" disabled={busy || !sha} onClick={() => void keep()}>Approve as written</button>
          <button type="button" className="cv2-k cv2-k-q" data-verb="flag-keep-back" disabled={busy} onClick={onBack}>Back</button>
        </div>
      )}
    </div>
  )
}
