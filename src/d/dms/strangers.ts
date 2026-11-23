// Strangers the reply detectors filed as VENDOR or UNSURE (inbound_triage_log). They wrote on
// LinkedIn but the engine never did, so no prospect or message row exists for them: they are read
// here, read-only, and drawn in the Likely spam folder beside the real spam threads.
import { supabase } from '../../lib/supabase'
import { forget, recall, remember } from '../../lib/pageMemo'
import { seatOf, type Seat } from '../seats'

export type StrangerVerdict = 'vendor' | 'unsure'

export type Stranger = {
  id: string
  client_id: string
  who: string | null
  verdict: StrangerVerdict
  reason: string | null
  message_text: string | null
  decided_at: string
}

export const STRANGER_DAYS = 30
const DAY = 86_400_000
const VERDICTS: readonly string[] = ['vendor', 'unsure']
/** The seats that have a Likely spam folder. */
export const STRANGER_SEATS: readonly Seat[] = ['risedtc', 'arch', 'swishdm']
const COLUMNS = 'id,client_id,who,verdict,reason,message_text,decided_at'
const MEMO = 'dms:strangers'

/** One seat's strangers, newest first, inside the window. Personal and buyer rows never come in. */
export function strangersFor(rows: readonly Stranger[], seat: Seat, now: number = Date.now()): Stranger[] {
  if (!STRANGER_SEATS.includes(seat)) return []
  return rows
    .filter(r => VERDICTS.includes(r.verdict) && seatOf(r.client_id) === seat && now - Date.parse(r.decided_at) <= STRANGER_DAYS * DAY)
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
}

async function fetchStrangers(now: number): Promise<Stranger[]> {
  const { data, error } = await supabase.from('inbound_triage_log').select(COLUMNS)
    .in('client_id', ['risedtc', 'rise', 'arch', 'swishdm'])
    .in('verdict', [...VERDICTS]).is('surfaced_prospect_id', null)
    .gte('decided_at', new Date(now - STRANGER_DAYS * DAY).toISOString())
    .order('decided_at', { ascending: false }).limit(1000)
  if (error) throw error
  return (data ?? []) as Stranger[]
}

/** The read the page runs. Only a good read is remembered; an empty one never replaces a non-empty copy. */
export async function readStrangers(): Promise<Stranger[]> {
  const rows = await fetchStrangers(Date.now())
  if (!remember(MEMO, rows)) forget(MEMO)
  return rows
}

/** The last read of this session, for the first paint of a DMs visit. */
export function rememberedStrangers(): Stranger[] | null {
  return recall<Stranger[]>(MEMO)?.value ?? null
}
