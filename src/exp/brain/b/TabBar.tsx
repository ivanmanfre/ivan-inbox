import { TABS, TAB_ICON, TAB_LABEL, type Place } from './place'

export function TabBar({ active, counts, sev, onTab }: {
  active: Place
  counts: Partial<Record<Place, number>>
  sev: Partial<Record<Place, 'attention' | 'urgent'>>
  onTab: (p: Place) => void
}) {
  return (
    <nav className="bb-tabs">
      {TABS.map(t => {
        const n = counts[t] ?? 0
        return (
          <button
            key={t} type="button" className={`bb-tab${t === active ? ' on' : ''}`}
            aria-current={t === active ? 'page' : undefined}
            onClick={() => onTab(t)}
          >
            <span className="bb-tab-ic" aria-hidden>
              {TAB_ICON[t]}
              {n > 0 && <span className={`bb-tab-n${sev[t] ? ` ${sev[t]}` : ''}`}>{n > 99 ? '99+' : n}</span>}
            </span>
            <span className="bb-tab-l">{TAB_LABEL[t]}</span>
          </button>
        )
      })}
    </nav>
  )
}
