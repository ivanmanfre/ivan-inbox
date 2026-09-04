import { TABS, TAB_LABEL, type Place } from '../../place'
import { Glyph, type GlyphName } from './icons'

// Six slots, six DRAWN marks. The unicode glyphs plain B uses (✳ ☼ ◉ ▤ ⇅ ◈)
// come from four different type designs and read at four different optical
// weights in a row; these are one stroke weight at one size. The active slot is
// one of the accent's two jobs in this skin.
const ICON: Record<Place, GlyphName> = {
  ask: 'ask', today: 'today', dms: 'dms', content: 'content', sends: 'sends', ops: 'ops',
}

export function TabBar({ active, counts, sev, onTab }: {
  active: Place
  counts: Partial<Record<Place, number>>
  sev: Partial<Record<Place, 'attention' | 'urgent'>>
  onTab: (p: Place) => void
}) {
  return (
    <nav className="bb-tabs bb-a-tabs">
      {TABS.map(t => {
        const n = counts[t] ?? 0
        return (
          <button
            key={t} type="button" className={`bb-tab bb-a-tab${t === active ? ' on' : ''}`}
            aria-current={t === active ? 'page' : undefined}
            onClick={() => onTab(t)}
          >
            <span className="bb-tab-ic bb-a-tab-ic">
              <Glyph name={ICON[t]} />
              {n > 0 && <span className={`bb-tab-n bb-a-tab-n${sev[t] ? ` ${sev[t]}` : ''}`}>{n > 99 ? '99+' : n}</span>}
            </span>
            <span className="bb-tab-l bb-a-tab-l">{TAB_LABEL[t]}</span>
          </button>
        )
      })}
    </nav>
  )
}
