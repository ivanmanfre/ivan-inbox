// A new build reloads the page, but never under Ivan's hands (2026-09-28: "Every 20, 30 seconds it
// refreshes the screen... When I'm writing something it refreshes"). The service worker hands over on
// every deploy, and on a busy day the deploys land minutes apart, so the old reload-at-once wiped a
// half-typed reply and re-read the whole inbox each time. Now the new build waits for a quiet moment:
//   - the tab has been in the background a few seconds, or
//   - nobody has touched the page for IDLE_MS,
// and in both cases only when no field is focused and no typed text is still unsent. Moving to
// another place (a hash change) is also a quiet moment. A page of the old build that can no longer
// load (its chunk left with the deploy, vite:preloadError) reloads at once: waiting would leave a
// blank page.

export const IDLE_MS = 5 * 60_000
export const HIDDEN_MS = 3_000
export const CHECK_MS = 15_000

const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'])

type Field = HTMLInputElement | HTMLTextAreaElement

const isTextField = (el: Element | null): el is Field =>
  !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NOT_TEXT.has((el as HTMLInputElement).type)))

/** A focused text field or contenteditable: someone is typing, or about to. */
export function isEditing(doc: Document): boolean {
  const a = doc.activeElement as HTMLElement | null
  return !!a && (a.isContentEditable || isTextField(a))
}

export const placeOf = (url: string) => (url.split('#')[1] ?? '').split('?')[0]

export function armUpdateReload({
  win = window, doc = document, reload = () => win.location.reload(),
  idleMs = IDLE_MS, hiddenMs = HIDDEN_MS, checkMs = CHECK_MS, now = () => Date.now(),
}: {
  win?: Window; doc?: Document; reload?: () => void
  idleMs?: number; hiddenMs?: number; checkMs?: number; now?: () => number
} = {}) {
  let pending = false
  let done = false
  let last = now()
  let hiddenTimer: number | null = null
  let away = false // hidden for at least hiddenMs
  let tick: number | null = null
  // Fields someone typed into. A field that saves itself (the DM draft, data-autosave) never holds
  // the reload back; any other field does while it still has text (a reply not sent yet).
  const typed = new Set<Field>()

  const unsent = () => [...typed].some(f => {
    if (!f.isConnected || f.value.trim() === '') { typed.delete(f); return false }
    return !f.closest('[data-autosave]')
  })
  const quiet = () => !isEditing(doc) && !unsent()
  const fire = () => {
    if (done) return
    done = true
    if (tick !== null) win.clearInterval(tick)
    if (hiddenTimer !== null) win.clearTimeout(hiddenTimer)
    reload()
  }
  const check = () => {
    if (!pending || done || !quiet()) return
    if (away || now() - last >= idleMs) fire()
  }

  const onActivity = () => { last = now() }
  const onInput = (e: Event) => { last = now(); if (isTextField(e.target as Element)) typed.add(e.target as Field) }
  const onVis = () => {
    if (hiddenTimer !== null) { win.clearTimeout(hiddenTimer); hiddenTimer = null }
    away = false
    if (pending && doc.visibilityState === 'hidden') hiddenTimer = win.setTimeout(() => { hiddenTimer = null; away = true; check() }, hiddenMs)
  }
  // Only a change of place (#exp/d/dms -> #exp/d/lanes), never opening a conversation (?thread=).
  const onNav = (e: Event) => {
    const { oldURL, newURL } = e as HashChangeEvent
    if (pending && quiet() && placeOf(oldURL) !== placeOf(newURL)) fire()
  }
  const onStale = (e: Event) => { e.preventDefault(); fire() }
  win.addEventListener('hashchange', onNav)
  win.addEventListener('vite:preloadError', onStale)
  for (const e of ['keydown', 'pointerdown', 'wheel', 'touchstart']) win.addEventListener(e, onActivity, { capture: true, passive: true })
  win.addEventListener('input', onInput, { capture: true })
  doc.addEventListener('visibilitychange', onVis)

  return {
    /** A new build has taken over: reload at the next quiet moment. */
    request() {
      if (pending || done) return
      pending = true
      tick = win.setInterval(check, checkMs)
      onVis()
    },
    get pending() { return pending },
  }
}
