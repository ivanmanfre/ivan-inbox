import type { ReactNode } from 'react'
import { cx } from './util'

export interface ShellProps {
  /** 'desktop' lays the plate out as rail · column · peers; 'phone' stacks it. */
  layout?: 'desktop' | 'phone'
  /** The nav rail (desktop) — rendered inside the plate, left edge. */
  rail?: ReactNode
  /** Anything docked to the right of the working column: an Ask pane, a peer. */
  peer?: ReactNode
  /** The phone tab bar, pinned under the working column. */
  tabBar?: ReactNode
  /** Overlays that must sit inside the plate rather than over the ground. */
  overlays?: ReactNode
  className?: string
  children?: ReactNode
}

/**
 * The inset two-surface shell: the pistachio ground is the page, the plate is
 * the app. Inside the plate every surface steps by lightness, never by shadow.
 */
export function Shell({
  layout = 'desktop', rail, peer, tabBar, overlays, className, children,
}: ShellProps) {
  return (
    <div data-ds="Shell" data-layout={layout} className={cx('ds-shell', className)}>
      <div className="ds-plate">
        {rail}
        <div className="ds-col">
          {children}
          {tabBar}
        </div>
        {peer}
        {overlays}
      </div>
    </div>
  )
}

/** The scrolling body of the working column. */
export function ShellBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div data-ds="ShellBody" className={cx('ds-col-body', className)}>{children}</div>
}

/** A docked peer: the Ask pane, a thread, an inspector. */
export function Peer({ side = 'right', className, children }:
  { side?: 'left' | 'right'; className?: string; children?: ReactNode }) {
  return <aside data-ds="Peer" data-side={side} className={cx('ds-peer', className)}>{children}</aside>
}
