// A list section in a seat column (Ivan 09-27: "collapsing stuff that is not necessarily needed to
// see ... only show the latest, let's say, 4 or 5"). At most CAP rows, then one "Show all N" row.
// A foldable section is one line with its count while folded; the open/folded choice is remembered
// per section (every seat, desktop and phone alike). Needs you is never foldable.
import { useCallback, useState, type ReactNode } from 'react'

export const CAP = 5
const KEY = 'd.dms.folds.v1'

function readFolds(): Record<string, boolean> {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v as Record<string, boolean> : {} } catch { return {} }
}

/** Open/folded per section id. A stored choice wins over the section's default. */
export function useFolds() {
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds)
  const isOpen = useCallback((id: string, def: boolean) => folds[id] ?? def, [folds])
  const toggle = useCallback((id: string, def: boolean) => setFolds(f => {
    const next = { ...f, [id]: !(f[id] ?? def) }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: this session only */ }
    return next
  }), [])
  return { isOpen, toggle }
}

export type Folds = ReturnType<typeof useFolds>

type Props = {
  id: string
  label: ReactNode
  /** The count on the header; '?' when the read failed. */
  n: ReactNode
  rows: ReactNode[]
  folds: Folds
  /** Omit for a section that can never fold (Needs you). */
  foldable?: boolean
  defaultOpen?: boolean
  /** Lines under the header when open (empty reason, failure, notes). */
  before?: ReactNode
  after?: ReactNode
  cap?: number
}

export function Section({ id, label, n, rows, folds, foldable = false, defaultOpen = true, before, after, cap = CAP }: Props) {
  const [all, setAll] = useState(false)
  const open = !foldable || folds.isOpen(id, defaultOpen)
  const shown = all ? rows : rows.slice(0, cap)
  return (
    <div className="dm-secwrap" data-sec={id} data-open={open ? 'true' : 'false'}>
      {foldable ? (
        <button type="button" className="dm-sec dm-sec-fold" aria-expanded={open} data-verb={`fold-${id}`} onClick={() => folds.toggle(id, defaultOpen)}>
          <span><span className="dm-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>{label}</span><span>{n}</span>
        </button>
      ) : (
        <div className="dm-sec"><span>{label}</span><span>{n}</span></div>
      )}
      {open && <>
        {before}
        {shown}
        {rows.length > cap && (
          <button type="button" className="dm-note dm-showall" data-verb="show-all" aria-expanded={all} onClick={() => setAll(a => !a)}>
            {all ? `Show the latest ${cap}` : `Show all ${rows.length}`}
          </button>
        )}
        {after}
      </>}
    </div>
  )
}
