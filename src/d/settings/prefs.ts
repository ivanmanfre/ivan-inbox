/* Per-device preferences, on today's libs and today's storage keys:
   push (lib/push, one row per device in push_subscriptions), the new-reply
   sound (lib/chime, localStorage `inbox-chime`) and density (html[data-density]
   + localStorage `inbox-density`, read at boot by main.tsx).
   The /next/ preview (VITE_PREVIEW=1) NEVER subscribes or unsubscribes push:
   same guard as App.tsx, so a side-by-side preview cannot steal the live
   app's subscription. */
import { useCallback, useEffect, useState } from 'react'
import { disablePush, enablePush, getPushState, type PushState } from '../../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'
import { ReadTimeout, withTimeout } from '../ui/timeout'

export const isPreview = (): boolean => import.meta.env.VITE_PREVIEW === '1'
export const isIOS = (): boolean => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = (): boolean => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches
  || (navigator as unknown as { standalone?: boolean }).standalone === true)

export type Push = { state: PushState | 'reading' | 'unknown'; busy: boolean; error: string; blocked: string | null; set: (on: boolean) => void }

/** Why the push keys cannot act on this device, or null when they can. */
export function pushBlocked(state: PushState | 'reading' | 'unknown', preview = isPreview()): string | null {
  if (preview) return 'This preview never turns push on or off. Use the live app for that.'
  if (isIOS() && !isStandalone()) return 'On iPhone, push works only from the Home Screen app (Share, then Add to Home Screen), then turn it on there.'
  if (state === 'unsupported') return 'This browser does not support web push.'
  if (state === 'denied') return 'Notifications are blocked for this site. Allow them in the browser settings, then turn push on.'
  return null
}

export function usePush(): Push {
  const [state, setState] = useState<PushState | 'reading' | 'unknown'>('reading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A service worker that never answers must not leave "Reading this device…" up: 12 s, then say so.
  useEffect(() => {
    let live = true
    void withTimeout(getPushState()).then(s => { if (live) setState(s) }, e => { if (live) setState(e instanceof ReadTimeout ? 'unknown' : 'unsupported') })
    return () => { live = false }
  }, [])
  const blocked = pushBlocked(state)
  const set = useCallback((on: boolean) => {
    if (blocked || busy) return
    setBusy(true); setError('')
    const run = on ? enablePush().catch(() => false) : disablePush()
    void run.then(async ok => {
      if (ok) setState(on ? 'on' : 'off')
      else { setState(await getPushState()); setError(on ? 'Not turned on. Check that the browser allows notifications for this site.' : 'Could not turn push off on this device.') }
    }).finally(() => setBusy(false))
  }, [blocked, busy])
  return { state, busy, error, blocked, set }
}

export function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(chimeEnabled)
  const set = useCallback((next: boolean) => {
    setChimeEnabled(next)
    setOn(next)
    if (next) playChime() // plays once, so the volume is heard
  }, [])
  return [on, set]
}

export type Density = 'comfortable' | 'compact'
export const currentDensity = (): Density => (document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable')

export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(currentDensity)
  const set = useCallback((next: Density) => {
    // Written explicitly (never removed): main.tsx reads an absent key as
    // "compact on desktop", so Comfortable must be stored to stick.
    document.documentElement.dataset.density = next
    try { localStorage.setItem('inbox-density', next) } catch { /* private window */ }
    setD(next)
  }, [])
  return [d, set]
}

/* The theme key the old app wrote (`inbox-theme`). D is dark only, but main.tsx
   still applies a stored "light" at boot, which turns the mounted old panels
   (Money, legacy content) light inside D's dark frame. Reset removes it. */
export function useStoredTheme(): ['light' | 'dark', () => void] {
  const read = (): 'light' | 'dark' => {
    try { return localStorage.getItem('inbox-theme') === 'light' || document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  }
  const [t, setT] = useState(read)
  const reset = useCallback(() => {
    try { localStorage.setItem('inbox-theme', 'dark') } catch { /* private window */ }
    document.documentElement.dataset.theme = 'dark'
    setT('dark')
  }, [])
  return [t, reset]
}
