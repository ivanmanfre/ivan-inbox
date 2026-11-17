import { PLACES, PLACE_ORDER } from '../places'

// Brief's Mac sidebar follows this list (daily-brief-trim Task 9.1): bridge.js reads the hidden
// [data-places] line, checks it, and the native app draws its rows, View menu and number keys from it.
// Places with nav 'hidden' (Intel, Claude) stay off the list; the palette and ⌘J still reach them.

export type PlaceWire = { id: string; label: string; group: 'main' | 'low' }

export function PlacesNode() {
  const list: PlaceWire[] = PLACE_ORDER.flatMap(id => {
    const p = PLACES[id]
    return p.nav === 'hidden' ? [] : [{ id: p.id, label: p.label, group: p.nav }]
  })
  return <span hidden data-places>{JSON.stringify(list)}</span>
}
