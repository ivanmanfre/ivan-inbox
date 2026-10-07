import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Layout } from '../places'
import { isNarrowing, targetFor, type DrawerMode, type Geometry, type Tier } from './tier'

// SPEC-shell-spacing §2.2-2.3 and §4.2. Measures the canvas (the app minus the
// web rail) and the main column, and writes `data-tier` + `--main-w` onto
// .d-main. The drawer mode (dock | over) only switches under the `shell` skin
// section; without it the drawer always docks, as today.
//
// The native frame handshake: Daily Brief dispatches `brief:frame` with the
// canvas width the window WILL have, before its sidebar animation. A narrowing
// target applies at once; a widening one waits for the animation to end. While
// a target is held, ResizeObserver callbacks are ignored; at ms + 50 the frame
// is measured once more and the truth wins.
//
// Hooks rule: called unconditionally at the top of DShell (09-09).

export type FrameDetail = { width: number; ms: number }
export const BRIEF_FRAME_EVENT = 'brief:frame'

type Opts = { layout: Layout; claudeOpen: boolean; shell: boolean }

function writeTier(main: HTMLElement | null, g: Geometry) {
  if (!main) return
  if (main.dataset.tier !== g.tier) main.dataset.tier = g.tier
  main.style.setProperty('--main-w', `${Math.round(g.main)}px`)
}

export function useShellGeometry(appRef: RefObject<HTMLElement | null>, { layout, claudeOpen, shell }: Opts): { mode: DrawerMode; tier: Tier | null } {
  const [mode, setMode] = useState<DrawerMode>('dock')
  const [tier, setTier] = useState<Tier | null>(null)
  const cur = useRef<Geometry>({ mode: 'dock', main: 0, tier: 't1' })
  const holdUntil = useRef(0)

  useEffect(() => {
    if (layout !== 'desktop') return
    const app = appRef.current
    if (!app) return
    const q = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)
    const canvas = () => {
      const side = q('.d-side')
      const sw = side ? side.getBoundingClientRect().width : 0
      return app.getBoundingClientRect().width - sw
    }
    const drawerWidth = () => q('aside.d-claude')?.getBoundingClientRect().width ?? 0

    const apply = (next: Geometry) => {
      cur.current = next
      writeTier(q('.d-main'), next)
      setMode(m => (m === next.mode ? m : next.mode))
      setTier(t => (t === next.tier ? t : next.tier))
    }

    const measure = () => {
      const c = canvas()
      const g = targetFor(c, { drawerOpen: claudeOpen, shell, prevMode: cur.current.mode, prevTier: cur.current.tier, drawerWidth: drawerWidth() })
      // The real main width wins when it is known (banners, rails); the target is the fallback.
      const main = q('.d-main')
      const mw = main ? main.getBoundingClientRect().width : 0
      if (mw > 0 && g.mode === cur.current.mode) {
        const t = targetFor(mw, { drawerOpen: false, shell, prevTier: cur.current.tier })
        apply({ mode: g.mode, main: mw, tier: t.tier })
      } else apply(g)
    }

    let raf = 0
    let settle = 0
    const onResize = () => {
      if (Date.now() < holdUntil.current) return
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; measure() })
    }
    const onFrame = (e: Event) => {
      const d = (e as CustomEvent<FrameDetail>).detail
      if (!d || typeof d.width !== 'number' || !(d.width > 0)) return
      const ms = Math.max(0, Math.min(2000, Number(d.ms) || 0))
      const target = targetFor(d.width, { drawerOpen: claudeOpen, shell, prevMode: cur.current.mode, prevTier: cur.current.tier, drawerWidth: drawerWidth() })
      if (isNarrowing(cur.current, target)) apply(target)
      // Wider: hold the current tier and mode until the animation ends.
      holdUntil.current = Date.now() + ms + 50
      clearTimeout(settle)
      settle = window.setTimeout(() => { holdUntil.current = 0; measure() }, ms + 50)
    }

    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    if (ro) {
      ro.observe(app)
      const main = q('.d-main'); if (main) ro.observe(main)
      const side = q('.d-side'); if (side) ro.observe(side)
    } else window.addEventListener('resize', onResize)
    window.addEventListener(BRIEF_FRAME_EVENT, onFrame)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener(BRIEF_FRAME_EVENT, onFrame)
      cancelAnimationFrame(raf)
      clearTimeout(settle)
    }
  }, [appRef, layout, claudeOpen, shell])

  return { mode: shell && claudeOpen && layout === 'desktop' ? mode : 'dock', tier: layout === 'desktop' ? tier : null }
}

