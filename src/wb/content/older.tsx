import { useState, type ReactNode } from 'react'
import type { ContentDraft } from '../../lib/content'

// ---------------------------------------------------------------------------
// "OLDER THAN TWO WEEKS", a closed fold under the decision list (rebuild,
// blueprint mock, NEW).
//
// The Content number on the bar counts decisions made in the last 14 days
// (decision 4, aged by created_at because edits move updated_at). The list
// under it used to hold every review row ever, so the number and the list
// never agreed. Now the list shows the same 14 days, and everything older
// waits one tap down, closed, with its count. Nothing is hidden or dropped:
// the tab count still counts every row.
// ---------------------------------------------------------------------------

export const DECISION_DAYS = 14

export function splitByAge<T extends Pick<ContentDraft, 'created_at'>>(
  rows: T[], now: number = Date.now(),
): { recent: T[]; older: T[] } {
  const cut = now - DECISION_DAYS * 86_400_000
  const recent: T[] = []
  const older: T[] = []
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    ;(Number.isFinite(t) && t < cut ? older : recent).push(r)
  }
  return { recent, older }
}

export function OlderFold({ n, children }: { n: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (n === 0) return null
  return (
    <div className="wb-ct-older" data-open={open ? '' : undefined}>
      <button type="button" className="wb-ct-older-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>Older than two weeks</span>
        <span className="wb-ct-older-n">{n} · {open ? 'Hide' : 'Show'}</span>
      </button>
      {open && children}
    </div>
  )
}
