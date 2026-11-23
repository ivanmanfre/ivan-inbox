// The three seats, in the one order every D surface draws them. Tenancy comes
// from client_id only: Ivan is NULL (older rows) or 'ivan', Rise is 'risedtc'
// (ops_drafts also carries a legacy 'rise'), Arch is 'arch'. Seats are never
// added together anywhere in D: every count is a Record<Seat, ...>.
export type Seat = 'ivan' | 'risedtc' | 'arch' | 'swishdm' | 'anna' | 'leah'

export const SEATS: readonly Seat[] = ['ivan', 'risedtc', 'arch', 'swishdm', 'anna', 'leah']

/** Studio seats: Ivan's offer sent from a teammate's own LinkedIn seat (Anna, Leah). Same lane rules. */
export type StudioSeat = 'anna' | 'leah'
export const STUDIO_SEATS: readonly StudioSeat[] = ['anna', 'leah']
export const isStudioSeat = (s: string | null | undefined): s is StudioSeat => s === 'anna' || s === 'leah'
/** First name and full name of a studio seat's person. */
export const STUDIO_NAME: Record<StudioSeat, string> = { anna: 'Anna', leah: 'Leah' }
export const STUDIO_FULL_NAME: Record<StudioSeat, string> = { anna: 'Anna Sol Manfredi', leah: 'Leah McMichael' }

/** Outreach eligibility is separate from the content/measurement registry. */
export const outreachSeats = (lanes: readonly { client_id: string }[]): Seat[] => SEATS.filter(s => isStudioSeat(s) || lanes.some(l => l.client_id === s))

/** Short name, as the panel prints it: Ivan / Rise / Arch. */
export const SEAT_NAME: Record<Seat, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch', swishdm: 'SwishDM', anna: 'Anna', leah: 'Leah' }

/** Whose seat it is, as the plates print it. */
export const SEAT_OWNER: Record<Seat, string> = { ivan: 'your seat', risedtc: "Mattan's seat", arch: "Davorin's seat" , swishdm: "Jonathan's seat", anna: "Anna's seat", leah: "Leah's seat" }

/** The seat a row belongs to, or null for a client this app does not know. */
export function seatOf(clientId: string | null | undefined): Seat | null {
  const id = (clientId ?? '').trim().toLowerCase()
  if (id === '' || id === 'ivan') return 'ivan'
  if (id === 'risedtc' || id === 'rise') return 'risedtc'
  if (id === 'arch') return 'arch'
  if (id === 'swishdm') return 'swishdm'
  if (id === 'anna') return 'anna'
  if (id === 'leah') return 'leah'
  return null
}

/** A per-seat number that may not be known. null = the read failed or has not landed. */
export type SeatNumbers = Record<Seat, number | null>

export const UNKNOWN_SEATS: SeatNumbers = { ivan: null, risedtc: null, arch: null, swishdm: null, anna: null, leah: null }

// PostgREST `or` filter for one seat. Ivan's rows are NULL on older writes and
// 'ivan' in the view; both are his, nothing else is. Rise also has a legacy 'rise'.
export function seatFilter(seat: Seat): string {
  if (seat === 'ivan') return 'client_id.is.null,client_id.eq.ivan'
  if (seat === 'risedtc') return 'client_id.eq.risedtc,client_id.eq.rise'
  return `client_id.eq.${seat}`
}
