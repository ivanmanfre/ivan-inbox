/* ==========================================================================
   src/ds/skin.ts — THE ONE DESIGN FLAG (Brief 4, SPEC-foundation §3).

   The "brief" skin is Oxygen's light design, owned section by section. A
   section is on when it is in the resolved set; the set is written to <html>
   as data-skin-on="tokens type motion shell …" and every skinned rule keys
   off `:root[data-skin-on~='<section>']`. Flag off = no attribute = today's
   look, byte for byte.

   Resolution, first match wins:
     1. URL ?skin=off | ?skin=brief:dms,home | ?skin=brief:all — a session
        override, copied to sessionStorage and removed from the address.
     2. sessionStorage['ds-skin']
     3. localStorage['ds-skin']   ('off' or a section list)
     4. defaults: phone → PHONE, Brief (html.brief-native) → BRIEF_DESKTOP,
        a plain desktop browser → WEB_DESKTOP.
   Any section implies the foundation: tokens, type, motion and shell.

   Daily Brief steps aside per section: its injected glass.css / bridge.js
   check data-skin-on and stand down for every section Inbox owns.
   ========================================================================== */

export type Section = 'tokens' | 'type' | 'motion' | 'shell' | 'home' | 'dms' | 'content' | 'lanes' | 'ops' | 'sales' | 'claude' | 'settings'
  | 'content.brain' | 'content.calendar' | 'content.ideas' | 'content.review' | 'content.lms'
export type SkinLayout = 'desktop' | 'phone'

export const SECTIONS: readonly Section[] = ['tokens', 'type', 'motion', 'shell', 'home', 'dms', 'content', 'lanes', 'ops', 'sales', 'claude', 'settings',
  'content.brain', 'content.calendar', 'content.ideas', 'content.review', 'content.lms']
export const FOUNDATION: readonly Section[] = ['tokens', 'type', 'motion', 'shell']

// Verified sections. Each starts empty and grows only after that section's
// acceptance passes live (BUILD_PLAN decision 1). PHONE grows only after a
// check on Ivan's real phone.
export const BRIEF_DESKTOP: Section[] = []
export const WEB_DESKTOP: Section[] = []
export const PHONE: Section[] = []

export const SKIN_KEY = 'ds-skin'

const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s)

/** Parse 'off' | 'brief' | 'brief:all' | 'brief:dms,home' | 'dms,home'. null = not a skin value. */
export function parseSkin(raw: string | null | undefined): Set<Section> | null {
  if (raw == null) return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (v === 'off' || v === '0' || v === 'none') return new Set()
  const list = v.startsWith('brief:') ? v.slice(6) : v === 'brief' || v === 'on' ? 'all' : v
  if (list === 'all') return new Set(SECTIONS)
  const out = new Set<Section>()
  for (const part of list.split(/[\s,+]+/)) {
    if (isSection(part)) out.add(part)
  }
  return out.size ? withFoundation(out) : null
}

function withFoundation(s: Set<Section>): Set<Section> {
  if (s.size === 0) return s
  const out = new Set(s)
  for (const f of FOUNDATION) out.add(f)
  // A content sub-tab implies the content frame; the content frame implies nothing below it.
  for (const k of s) if (k.startsWith('content.')) out.add('content')
  return out
}

export type SkinInput = {
  search: string
  session: string | null
  local: string | null
  briefNative: boolean
  layout: SkinLayout
}

/** Which raw value won, so the boot code can persist a URL override to the session. */
export function resolveSkin(i: SkinInput): { set: Set<Section>; from: 'url' | 'session' | 'local' | 'default'; raw: string | null } {
  const q = new URLSearchParams(i.search.startsWith('?') ? i.search.slice(1) : i.search).get('skin')
  const url = parseSkin(q)
  if (url) return { set: url, from: 'url', raw: q }
  const ses = parseSkin(i.session)
  if (ses) return { set: ses, from: 'session', raw: i.session }
  const loc = parseSkin(i.local)
  if (loc) return { set: loc, from: 'local', raw: i.local }
  const d = i.layout === 'phone' ? PHONE : i.briefNative ? BRIEF_DESKTOP : WEB_DESKTOP
  return { set: withFoundation(new Set(d)), from: 'default', raw: null }
}

/** The html attribute value, in a stable order (tests and screenshots compare it). */
export function skinAttr(s: Set<Section>): string {
  return SECTIONS.filter(x => s.has(x)).join(' ')
}

// ---------------------------------------------------------------------------
// The live store: resolved once at boot (main.tsx, before React mounts, so
// there is no flash) and again whenever React's layout flips.
// ---------------------------------------------------------------------------

let current: Set<Section> = new Set()
const subs = new Set<() => void>()

const read = (st: Storage | undefined, k: string): string | null => { try { return st?.getItem(k) ?? null } catch { return null } }

export function isBriefNative(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('brief-native') || (typeof navigator !== 'undefined' && navigator.userAgent.includes('DailyBrief/'))
}

/** Resolve for `layout` and write <html> attributes. Returns the set. */
export function applySkin(layout: SkinLayout): Set<Section> {
  if (typeof window === 'undefined') return current
  const r = resolveSkin({
    search: window.location.search,
    session: read(window.sessionStorage, SKIN_KEY),
    local: read(window.localStorage, SKIN_KEY),
    briefNative: isBriefNative(),
    layout,
  })
  if (r.from === 'url' && r.raw != null) {
    // A session override: it survives hash navigation, and leaves the address.
    try { window.sessionStorage.setItem(SKIN_KEY, r.raw) } catch { /* private mode */ }
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('skin')
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
    } catch { /* not a navigable document */ }
  }
  const root = document.documentElement
  const attr = skinAttr(r.set)
  if (r.set.size) root.dataset.skin = 'brief'
  else delete root.dataset.skin
  if (attr) root.dataset.skinOn = attr
  else delete root.dataset.skinOn
  root.dataset.layout = layout
  // The phone status bar follows the skin (manifest default #000000).
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    if (!meta.dataset.base) meta.dataset.base = meta.content
    meta.content = r.set.has('tokens') ? '#f6f8f3' : meta.dataset.base
  }
  const changed = skinAttr(current) !== attr
  current = r.set
  if (changed) subs.forEach(f => f())
  return current
}

export function skinHas(s: Section): boolean { return current.has(s) }
export function skinSet(): ReadonlySet<Section> { return current }
export function subscribeSkin(f: () => void): () => void { subs.add(f); return () => { subs.delete(f) } }

/** Test hook: reset the store between cases. */
export function __resetSkinForTests(s: Set<Section> = new Set()) { current = s }
