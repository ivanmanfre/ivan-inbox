/* ==========================================================================
   src/wb/chrome/intents.ts - "do this in the Claude pane", from outside it.

   Two asks reach the Claude surface from chrome that does not hold its state:
     · the workflow pill (rail row, phone capsule) opens the alerts sheet,
       because Ops has had no workflow list since 31 Aug;
     · ⌘D starts voice the way the on-screen mic does.

   On the desktop the pane is only BUILT while the drawer is open, so the ask
   can arrive before anything is listening. An intent keeps it: `request()`
   hands it to the live listener if there is one, and otherwise parks it until
   the next listener mounts, which runs it once. Nothing is queued twice: a
   second request while one is parked is the same request.
   ========================================================================== */

export type Intent = {
  /** Runs the listener now, or parks the ask (unless `park` is false, for a
   *  caller that will not open the pane and must not leave a stale ask behind).
   *  Returns true when it ran now. */
  request: (park?: boolean) => boolean
  /** Register the live handler. A parked ask runs once, right away. */
  listen: (fn: () => void) => () => void
}

export function createIntent(): Intent {
  let handler: (() => void) | null = null
  let parked = false
  return {
    request(park = true) {
      if (handler) { handler(); return true }
      if (park) parked = true
      return false
    },
    listen(fn) {
      handler = fn
      if (parked) { parked = false; fn() }
      return () => { if (handler === fn) handler = null }
    },
  }
}

/** Open the alerts sheet (the bell), where the workflow alert row lives. */
export const alertsIntent = createIntent()

/** Start or stop voice, the same thing the composer's mic button does. */
export const voiceIntent = createIntent()
