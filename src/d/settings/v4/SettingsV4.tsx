// Brief 4 Settings (SPEC-dms §2.13): one centred column of grouped inset lists, rows 44. Every row is
// a node built by SettingsHome from its own hooks and closures (the same Pair keys, the same confirm),
// so nothing here reads or writes on its own.
import type { ReactNode } from 'react'

export function Group({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <section className="ds4-group" aria-label={label} data-group={id}>
      <h3 className="ds4-label">{label}</h3>
      <div className="ds4-list">{children}</div>
    </section>
  )
}

export function Row4({ title, sub, children, className }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`ds4-row${className ? ` ${className}` : ''}`}>
      <div className="ds4-t"><b>{title}</b>{sub != null && sub !== '' && <small>{sub}</small>}</div>
      {children != null && <div className="ds4-c">{children}</div>}
    </div>
  )
}

export function SettingsV4({ head, groups, build }: { head: ReactNode; groups: ReactNode; build: ReactNode }) {
  return (
    <div className="ds2-root ds4">
      {head}
      <div className="ds4-col">
        {groups}
        <p className="ds2-build ds4-build">{build}</p>
      </div>
    </div>
  )
}
