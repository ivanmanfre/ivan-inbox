// The direction seam (Phase 2 of inbox-app-revamp-2026-09-05). A direction
// folder (`./dir-a`, `./dir-b`) exports `overrides`: any of the named screens
// below, each a component with the SAME props as the one it replaces. `pick()`
// hands a mount point either the override (lazily, with its own Suspense so the
// registry's React.lazy never resolves to another lazy, React #306) or the
// component the app ships today. With no `?ds=` flag `pick` returns the
// fallback itself, so the shipped app is byte-for-byte unchanged.
import { lazy, Suspense, type ComponentType, type ComponentProps } from 'react'
import { DIRECTION, type Direction } from './direction'

export type OverrideName =
  | 'Today' | 'Dms' | 'ThreadPeer' | 'ContentList' | 'SendsScreen' | 'OpsBoard' | 'Settings'
  | 'Mobile' | 'AskPane'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Overrides = Partial<Record<OverrideName, ComponentType<any>>>

const LOADERS: Record<Direction, () => Promise<{ overrides: Overrides }>> = {
  a: () => import('./dir-a'),
  b: () => import('./dir-b'),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pick<C extends ComponentType<any>>(name: OverrideName, Fallback: C): C {
  if (!DIRECTION) return Fallback
  const load = LOADERS[DIRECTION]
  const Lazy = lazy(() => load().then(m => ({ default: (m.overrides[name] ?? Fallback) as C })))
  const Picked = (p: ComponentProps<C>) => <Suspense fallback={null}><Lazy {...p} /></Suspense>
  Picked.displayName = `pick(${name})`
  return Picked as unknown as C
}

export { DIRECTION }
