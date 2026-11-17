// PLACE VISITS (2026-11-17). One row per page he stays on, written by the db RPC inbox_log_visit.
// A visit counts once the place and sub have stayed the same for 3 seconds, so a pass-through
// click is not logged, and the same page twice in a row is logged once.

export function surfaceOf(layout: 'desktop' | 'phone', briefNative: boolean): 'brief' | 'phone' | 'web' {
  if (layout === 'phone') return 'phone'
  return briefNative ? 'brief' : 'web'
}

export function createVisitLogger(
  send: (place: string, sub: string | null, surface: string) => void,
  dwellMs = 3000,
): { seen(place: string, sub: string | null, surface: string): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: string | null = null
  let last: string | null = null
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  return {
    seen(place, sub, surface) {
      const key = `${place}\u0000${sub ?? ''}`
      // Still on the same page (a re-render or a one-shot key changed): keep the running clock.
      if (key === pending && timer) return
      clear()
      pending = key
      if (key === last) return
      timer = setTimeout(() => {
        timer = null
        last = key
        try { send(place, sub, surface) } catch { /* never shown */ }
      }, dwellMs)
    },
    stop() { clear(); pending = null },
  }
}

/** Fire and forget, like markXQuickSeen: signed out does nothing, a failure is swallowed. */
export function sendVisit(place: string, sub: string | null, surface: string): void {
  void (async () => {
    try {
      // Loaded on first use so the logger itself stays free of the client (and testable without env).
      const { supabase } = await import('./supabase')
      const { data } = await supabase.auth.getSession()
      if (!data.session) return
      await supabase.rpc('inbox_log_visit', { p_place: place, p_sub: sub, p_surface: surface })
    } catch { /* never shown */ }
  })()
}
