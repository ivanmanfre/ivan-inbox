import { useCallback, useEffect, useRef } from 'react'
import { BEFORE_HASH_NAVIGATION } from '../lib/navigationGuard'

/** Keep an editor mounted until a dirty close or hash navigation is explicitly discarded. */
export function useUnsavedNavigation(dirty: boolean, confirmLeave: () => Promise<boolean>) {
  const live = useRef({ dirty, confirmLeave })
  live.current = { dirty, confirmLeave }
  const pending = useRef(false)
  const permitHash = useRef(false)
  const acceptedHash = useRef(typeof location === 'undefined' ? '' : location.hash)

  const canLeave = useCallback(async () => {
    if (pending.current) return false
    if (!live.current.dirty) return true
    pending.current = true
    try {
      const ok = await live.current.confirmLeave()
      if (ok) permitHash.current = true
      return ok
    } finally { pending.current = false }
  }, [])

  useEffect(() => {
    let mounted = true
    const onHash = (e: Event) => {
      const target = location.hash
      if (target === acceptedHash.current) return
      if (permitHash.current || !live.current.dirty) {
        permitHash.current = false
        acceptedHash.current = target
        return
      }
      // The router dispatches this veto before reading the hash. Native Window
      // hash listeners alone run in registration order, even with capture.
      e.preventDefault()
      e.stopImmediatePropagation()
      history.replaceState(null, '', acceptedHash.current)
      void canLeave().then(ok => {
        if (!ok || !mounted) return
        history.replaceState(null, '', target)
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!live.current.dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener(BEFORE_HASH_NAVIGATION, onHash)
    window.addEventListener('hashchange', onHash, true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      mounted = false
      window.removeEventListener(BEFORE_HASH_NAVIGATION, onHash)
      window.removeEventListener('hashchange', onHash, true)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [canLeave])
  const rememberHash = useCallback(() => { acceptedHash.current = location.hash; permitHash.current = false }, [])
  return { canLeave, rememberHash }
}
