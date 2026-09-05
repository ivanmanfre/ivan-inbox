// Direction toggle for goal run inbox-app-revamp-2026-09-05, Phase 2.
// `?ds=a|b` picks one of two design directions applied to the eight key screens;
// no flag = the app exactly as shipped. Read ONCE from the hash the page was
// loaded with (navigation timing entry, like src/exp/brain/b/skin.ts) because the
// rail rewrites the hash through wbHash() and drops the query. Stashed per tab
// in sessionStorage so a reload inside the same tab keeps the direction;
// `?ds=plain` clears it.
export type Direction = 'a' | 'b'

function bootHash(): string {
  if (typeof location === 'undefined') return ''
  let url = location.href
  try {
    const nav = performance?.getEntriesByType?.('navigation')?.[0] as { name?: string } | undefined
    if (nav?.name) url = nav.name
  } catch { /* no navigation timing: the live hash is the best available */ }
  const at = url.indexOf('#')
  return at < 0 ? '' : url.slice(at)
}

export function readDirection(hash: string): Direction | 'plain' | null {
  const m = hash.match(/\?([^#]*)/)
  const s = new URLSearchParams(m?.[1] ?? '').get('ds')
  return s === 'a' || s === 'b' || s === 'plain' ? s : null
}

const KEY = 'wb-direction'
function resolve(): Direction | null {
  if (typeof location === 'undefined') return null
  const explicit = readDirection(bootHash()) ?? readDirection(location.hash)
  try {
    if (explicit === 'plain') { sessionStorage.removeItem(KEY); return null }
    if (explicit) { sessionStorage.setItem(KEY, explicit); return explicit }
    const kept = sessionStorage.getItem(KEY)
    if (kept === 'a' || kept === 'b') return kept
  } catch { /* storage blocked: the hash is all we have */ }
  return explicit === 'a' || explicit === 'b' ? explicit : null
}

export const DIRECTION: Direction | null = resolve()
