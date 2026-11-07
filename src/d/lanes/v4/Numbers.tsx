import type { Seat } from '../../seats'
import { Figure, slotRead } from '../../ui/Figure'
import type { Read } from '../../home/model'
import type { BandCtx } from '../bandCells'
import { windowThroughToday } from '../rates'

export function Numbers({ seat, ctx, retry }: { seat: Seat; ctx: BandCtx; retry: () => void }) {
  // The tiles count the window's completed days plus today so far (rates.ts windowThroughToday).
  // No week-over-week pill (Ivan 2026-11-04): rates move when the ICP filter changes, so the
  // previous window is a different population and a ▲/▼ against it reads as a false trend.
  const p = ctx.d.cc.value, r = ctx.range, w = windowThroughToday(p, seat, r)
  const acc = w?.accept ?? null, rep = w?.reply ?? null
  const o = ctx.d.outcomes.value?.find(x => x.client_id === seat)
  const monitor = (v: number | null): Read<number | null> => slotRead(ctx.d.cc, () => v)
  const tiles = [
    { label: `Invites, ${r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}`, read: monitor(w?.inv ?? null), sub: w?.invFailed != null ? `${w.invFailed} refused · incl. today` : 'incl. today' },
    { label: 'Accepted ≤72h', read: monitor(acc?.pct ?? null), unit: '%', sub: acc?.pct != null ? `${acc.hit} of ${acc.base}${acc.young ? `, ${acc.young} still <72h` : ''}` : p ? 'nobody invited' : '' },
    { label: 'Replied ≤72h', read: monitor(rep?.pct ?? null), unit: '%', sub: rep ? `${rep.hit} of ${rep.base} messaged` : '' },
    { label: 'Conversations', read: slotRead(ctx.d.outcomes, () => o && r !== '90d' ? r === '7d' ? o.convos_7d : o.convos_30d : null), sub: o && r !== '90d' ? `${r === '7d' ? o.calls_7d : o.calls_30d} calls` : r === '90d' ? 'not counted for 90 days' : '' },
  ]
  return <div className="dl4-kpis" data-band="kpis" data-seat={seat} data-bx-block>{tiles.map(t => <div className="dl4-kpi" key={t.label}>
    <small>{t.label}</small><Figure r={t.read} retry={retry} unit={t.unit} />
    <div className="dl4-kpi-sub">{t.sub}</div>
  </div>)}<p className="dl-date-note">Account-wide send and conversation history</p></div>
}
