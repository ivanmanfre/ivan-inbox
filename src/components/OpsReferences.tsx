import { isOpsReference, type OpsDraft } from '../lib/ops'
import './OpsReferences.css'

/** A quiet, initially closed project record. No approval or task actions. */
export function OpsReferences({ drafts }: { drafts: OpsDraft[] }) {
  return <>{drafts.filter(d => isOpsReference(d) && !d.send_blocked_reason
    && typeof d.context?.reference_title === 'string').map(d => {
    const ctx = d.context!
    const sections = Array.isArray(ctx.reference_sections) ? ctx.reference_sections : []
    return <details className="ops-reference" key={d.id}>
      <summary><strong>{String(ctx.reference_title)}</strong><span>Progress and pending</span></summary>
      <div className="ops-reference-content">
        {sections.map((section: unknown, i: number) => {
          if (!section || typeof section !== 'object') return null
          const s = section as Record<string, unknown>
          if (typeof s.title !== 'string' || typeof s.text !== 'string') return null
          return <section key={i}><h3>{s.title}</h3><p>{s.text}</p></section>
        })}
        {typeof ctx.reference_updated === 'string' && <small>{ctx.reference_updated}</small>}
      </div>
    </details>
  })}</>
}
