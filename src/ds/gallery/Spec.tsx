import type { ReactNode } from 'react'

/** One primitive's section. `name` is the data-ds name the gates count. */
export function Section({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <section className="gal-sec" data-gal-section={name}>
      <div className="gal-sec-head">
        <span className="gal-name ds-t-title">{name}</span>
        {note ? <span className="ds-t-meta">{note}</span> : null}
      </div>
      <div className="gal-grid">{children}</div>
    </section>
  )
}

/** One state of one primitive, labelled with the state name. */
export function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="gal-item" data-wide={wide} data-gal-state={label}>
      <span className="gal-label">{label}</span>
      <div className="gal-body">{children}</div>
    </div>
  )
}
