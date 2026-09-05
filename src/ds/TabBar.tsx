import { motion } from 'motion/react'
import { Icon, type IconName } from './icons'
import { Badge } from './Badge'
import { cx } from './util'

export interface TabItem {
  id: string
  icon: IconName
  label: string
  count?: number
  sev?: 'attention' | 'urgent'
}

export interface TabBarProps {
  items: TabItem[]
  active: string
  onSelect: (id: string) => void
  /** Unique per mounted tab bar: the sliding highlight is a shared layout id,
      and two bars sharing one id fight over the same marker. */
  markerId?: string
  className?: string
}

/**
 * The phone tab bar. The active place expands to icon + label inside a
 * highlight that slides between places; every other place stays icon-only and
 * keeps a 44px hit area.
 */
export function TabBar({ items, active, onSelect, markerId = 'ds-tab-active', className }: TabBarProps) {
  return (
    <nav data-ds="TabBar" className={cx('ds-tabbar', className)} aria-label="Places">
      {items.map((t) => {
        const on = t.id === active
        return (
          <button
            data-ds="Tab"
            key={t.id}
            type="button"
            data-active={on}
            className="ds-tab"
            aria-current={on ? 'page' : undefined}
            aria-label={t.label}
            onClick={() => onSelect(t.id)}
          >
            {on ? <motion.span layoutId={markerId} className="ds-tab-marker" /> : null}
            <Icon name={t.icon} size={20} />
            {on ? <span className="ds-tab-label">{t.label}</span> : null}
            {!on && t.count ? (
              <span className="ds-tab-count">
                <Badge tone={t.sev ?? 'neutral'} label={`${t.count} in ${t.label}`}>
                  {t.count}
                </Badge>
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
