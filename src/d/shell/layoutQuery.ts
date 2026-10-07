import { skinHas } from '../../ds/skin'

// React's layout, the one source of layout truth (SPEC-foundation §4).
// Today: desktop from a 1000px viewport. Under the `shell` skin section a
// fine-pointer window from 720px is desktop too (SPEC-shell-spacing §2.3, G7):
// a Mac window (Brief's narrowest canvas is 764) never drops into the phone
// frame, and collapsing the native sidebar never swaps Desktop for PhoneFrame.
export const DESK_MQ = '(min-width: 1000px)'
export const DESK_MQ_SHELL = '(min-width: 1000px), (min-width: 720px) and (pointer: fine)'

export const deskQuery = (): string => (skinHas('shell') ? DESK_MQ_SHELL : DESK_MQ)

/** desktop | phone for the current window, with the current flag. */
export function isDeskNow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(deskQuery()).matches
}
