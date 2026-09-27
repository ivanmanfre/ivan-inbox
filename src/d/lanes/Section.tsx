/* One collapsible section of the chosen seat. The head is one button (title,
   a short summary that stays readable when folded, a chevron); the body mounts
   only when open, so a folded section never reads its data. */
import type { ReactNode } from 'react'
import type { SectionId } from './prefs'

export function Section({ id, title, summary, open, onToggle, tools, children }: {
  id: SectionId; title: string; summary?: ReactNode; open: boolean; onToggle: (id: SectionId) => void; tools?: ReactNode; children: ReactNode
}) {
  return (
    <section className={`dl-sec${open ? ' dl-open' : ''}`} data-section={id}>
      <div className="dl-sech">
        <button type="button" className="dl-sect" aria-expanded={open} aria-controls={`dl-sec-${id}`} data-toggle={id} onClick={() => onToggle(id)}>
          <i className="dl-chev" aria-hidden="true" />
          <b>{title}</b>
          {summary != null && <span className="dl-secs">{summary}</span>}
        </button>
        {open && tools}
      </div>
      {open && <div className="dl-secb" id={`dl-sec-${id}`}>{children}</div>}
    </section>
  )
}
