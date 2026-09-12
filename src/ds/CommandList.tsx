import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Kbd } from './Kbd'
import { cx } from './util'

export interface CommandItem {
  id: string
  label: ReactNode
  icon?: IconName
  /** Key caps drawn on the trailing edge. */
  keys?: string[]
  /** false keeps the row listed and dimmed: the vocabulary never shrinks. */
  ready?: boolean
  /** Why it is not available right now. */
  reason?: ReactNode
  /**
   * The CONTEXT line, drawn under the label whether or not the row is ready.
   * kokonutd/action-search-bar's row is `glyph · action · context · ⌘-hint ·
   * category`, and until E4 this component had nowhere to put the third of
   * those: `reason` renders only on a row that CANNOT run, so a palette whose
   * every row was ready printed no context at all. One line, truncated, because
   * a row that wraps turns a scannable list into a paragraph.
   */
  sub?: ReactNode
  /** A surface label on a cross-object find result. */
  badge?: ReactNode
  onRun?: () => void
}

export interface CommandGroup {
  id: string
  label: string
  items: CommandItem[]
}

export interface CommandListProps {
  /** The search field, rendered by the caller so it can own focus. */
  head?: ReactNode
  groups: CommandGroup[]
  /** Index of the highlighted row within the flattened list. */
  activeId?: string
  /** Shown when the query matches nothing. The palette stays open. */
  empty?: ReactNode
  foot?: ReactNode
  className?: string
}

/** The command palette body: grouped rows, key hints, dimmed-but-listed commands. */
export function CommandList({ head, groups, activeId, empty, foot, className }: CommandListProps) {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <div data-ds="CommandList" className={cx('ds-cmd', className)} role="dialog" aria-label="Commands">
      {head ? <div className="ds-cmd-head">{head}</div> : null}
      <div className="ds-cmd-body" role="listbox" aria-label="Commands">
        {total === 0 ? <div className="ds-cmd-group-label ds-t-meta">{empty}</div> : null}
        {groups.map((g) => (
          <div key={g.id} className="ds-cmd-group">
            <div className="ds-cmd-group-label ds-t-eyebrow">{g.label}</div>
            {g.items.map((c) => {
              const ready = c.ready !== false
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === activeId}
                  aria-disabled={!ready}
                  data-active={c.id === activeId}
                  data-ready={ready}
                  className="ds-cmd-item"
                  onClick={ready ? c.onRun : undefined}
                >
                  {c.icon ? <Icon name={c.icon} size={16} /> : null}
                  <span className="ds-cmd-item-main">
                    <span className="ds-truncate">{c.label}</span>
                    {ready && c.sub ? <span className="ds-t-meta ds-truncate">{c.sub}</span> : null}
                    {!ready && c.reason ? <span className="ds-t-meta">{c.reason}</span> : null}
                  </span>
                  {c.badge}
                  {c.keys && c.keys.length > 0 ? (
                    <span className="ds-cmd-item-keys">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {foot ? <div className="ds-cmd-foot ds-t-meta">{foot}</div> : null}
    </div>
  )
}
