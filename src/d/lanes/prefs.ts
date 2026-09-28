/* Lanes view state that survives a reload: the chosen seat and which sections
   are open. Both are view choices (localStorage), never a write to the data. */
import { useCallback, useState } from 'react'
import { SEATS, type Seat } from '../seats'

export const SEAT_KEY = 'd-lanes-seat-v1'
export const OPEN_KEY = 'd-lanes-open-v2'

/** The folded sections under the seat's first screen (KPIs, supply, campaigns and charts are always open). */
export type SectionId = 'control' | 'inbound' | 'detail' | 'channels' | 'log' | 'problems'
export const SECTIONS: SectionId[] = ['control', 'inbound', 'detail', 'channels', 'log', 'problems']
/** All folded until Ivan opens one (Ivan 09-28: "we can have everything collapsed"). */
export const DEFAULT_OPEN: Record<SectionId, boolean> = { control: false, inbound: false, detail: false, channels: false, log: false, problems: false }

const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode: view state only */ } }

export function storedSeat(): Seat {
  const v = read(SEAT_KEY)
  return (SEATS as readonly string[]).includes(v ?? '') ? (v as Seat) : 'ivan'
}
export function storeSeat(s: Seat) { write(SEAT_KEY, s) }

export function parseOpen(raw: string | null): Record<SectionId, boolean> {
  const out = { ...DEFAULT_OPEN }
  try {
    const o = JSON.parse(raw ?? '{}') as Record<string, unknown>
    for (const k of SECTIONS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  } catch { /* a broken value falls back to the default */ }
  return out
}

export function useOpenSections(): [Record<SectionId, boolean>, (id: SectionId) => void] {
  const [open, setOpen] = useState(() => parseOpen(read(OPEN_KEY)))
  const toggle = useCallback((id: SectionId) => setOpen(prev => {
    const next = { ...prev, [id]: !prev[id] }
    write(OPEN_KEY, JSON.stringify(next))
    return next
  }), [])
  return [open, toggle]
}
