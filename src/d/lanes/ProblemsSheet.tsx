/* Recurring problems, in full: today's RecurrenceSection (wb/sends/Control.tsx)
   as a D sheet. Per daily pick: independent and ledger counts, relationship
   (+ "not a majority" and its note), cause confidence, previous attempts by
   state, repair or withheld reason, owner, success measure, and a fold with
   the past fixes, their receipts and the evidence refs. Head: weekly result,
   reason, provisional, as of. Foot: the "split not implemented" caveat and
   the lineage summary. Read-only. */
import type { CcPayload, CcRecurrenceItem } from '../../lib/campaignControl'
import { Sheet } from '../ui/Sheet'
import { dm, hm } from './model'

const n = (v: number | null | undefined) => (v == null ? '?' : v.toLocaleString('en-US'))

function Item({ it, p }: { it: CcRecurrenceItem; p: CcPayload }) {
  const fx = it.past_fixes ?? []
  const c = (s: string) => fx.filter(f => f.state === s).length
  const cc = it.cause_confidence
  const refs = p.evidence.filter(e => (it.evidence_ref_ids ?? []).includes(e.id))
  return (
    <div className="dl-msg" data-recurrence={it.recurrence_id}>
      <div className="dl-mh"><b>{it.title}</b></div>
      <p className="dl-m">Independent <b>{n(it.independent?.distinct_events)}</b> events over <b>{n(it.independent?.distinct_days)}</b> days · ledger {n(it.ledger?.distinct_events)} over {n(it.ledger?.distinct_days)} days</p>
      <p>Relationship: {it.relationship ?? 'unknown'}{it.relationship_is_majority === false && <span className="dl-al"> · not a majority</span>}</p>
      {it.relationship_is_majority === false && it.relationship_note && <p>{it.relationship_note}</p>}
      <p className="dl-m">Cause confidence {cc?.value ?? 'unknown'}{cc?.meaning ? `: ${cc.meaning}` : ''} · {n(cc?.supporting_independent_events)} supporting independent events</p>
      <p className="dl-m">Previous attempts: {fx.length} ({c('proposed')} proposed · {c('applied')} applied · {c('verified')} verified) · {fx.filter(f => f.later_recurrence).length} recurred later</p>
      <p>{it.withheld ? `Repair withheld: ${it.withheld_reason ?? 'no reason recorded'}` : `Recommended repair: ${it.recommended_fix ?? 'none recorded'}`}</p>
      <p className="dl-m">Owner {it.owner ?? 'unassigned'} · success measure: {it.success_measure ?? 'none recorded'}</p>
      <details className="dl-fold2">
        <summary>Past attempts and evidence ({fx.length + refs.length})</summary>
        {fx.length === 0 && <p className="dl-sl">No previous attempt recorded.</p>}
        {fx.map((f, i) => (
          <div className="dl-ev" key={i}>
            <span className="dl-t1">{f.scope}</span>
            <time>{f.state}{f.recorded_at ? ` · ${f.recorded_at.slice(0, 10)}` : ''}{f.later_recurrence ? ' · recurred later' : ''}</time>
            {(f.receipts ?? []).map(r => <span key={r.receipt_id}>{r.receipt_id}: supports {r.supports_scope ?? 'nothing named'} · closes the defect: {r.closes_defect ? 'yes' : 'no'} · {r.reason ?? 'no reason'}</span>)}
          </div>
        ))}
        {refs.map(e => <div className="dl-ev" key={e.id}><code>{e.id}</code><span>{e.source_kind ?? 'unknown kind'} · {e.lineage ?? 'unknown lineage'}{e.derived_from ? ` · derived from ${e.derived_from}` : ''}</span><time>{e.observed_at ?? '—'}</time></div>)}
      </details>
    </div>
  )
}

export function ProblemsSheet({ p, pFailed = null, onClose }: { p: CcPayload | null; pFailed?: string | null; onClose: () => void }) {
  const r = p?.recurrence ?? null
  const picks = (r?.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3)
  const w = r?.weekly
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Recurring problems"
      sub={!p ? (pFailed ? `The send monitor could not be read: ${pFailed}` : 'Reading the send monitor…') : !r ? 'This snapshot carries no recurrence ledger, so nothing recurring is shown. That is an absent section, not an empty one.'
        : `Weekly result: ${(w?.result ?? 'unknown').replace(/_/g, ' ')}${w?.reason ? `: ${w.reason}` : ''}${w?.provisional ? ' (provisional)' : ''}${r.as_of ? ` · as of ${dm(r.as_of)} ${hm(r.as_of)}` : ''}`}>
      {r && !picks.length && <p className="dl-sl">No problem was picked for today.</p>}
      {p && picks.map(i => <Item key={i.recurrence_id} it={i} p={p} />)}
      {r && <p className="dl-sl dl-dimt">Splitting a mixed family into separate defects is not implemented: a family marked "not a majority" is still one row here, and one repair cannot close it.
        {r.lineage_summary ? ` Lineage ${r.lineage_summary.rules_version ?? 'lineage.v1'}: ${r.lineage_summary.independent ?? 0} independent, ${r.lineage_summary.derived ?? 0} derived, ${r.lineage_summary.unknown ?? 0} unknown.` : ''}</p>}
    </Sheet>
  )
}
