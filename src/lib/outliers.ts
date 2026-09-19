/* ==========================================================================
   OUTLIERS — the reach outlier study behind Strategy > Markets.

   `operator_market_outliers('clientops', lane)` (db/102) returns the newest
   stored study for a lane, or null when the lane has none. The study is a
   reasoned pass over a frozen corpus: posts that beat their author's own
   baseline, typed by reading, with the reactors on the top ones judged by
   headline. It is the market only; the lane's own posts never enter it.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

export type OutlierCard = { headline: string; figure: string; base: string; change: string }
export type OutlierTravel = { type: string; label: string; n: number }
export type OutlierBand = {
  type: string; label: string; posts: number; reactors: number
  brand_lo: number; brand_hi: number; brand: number; peer: number; vendor: number
}
export type OutlierWinner = {
  author: string; lift: number; likes: number; reposts: number; comments: number
  brand: number; peer: number; n: number; type_label: string; first_line: string; url: string
}
export type OutlierStudy = {
  run_id: string
  created_at: string
  answer: { figure: string; unit: string; line: string }
  cards: OutlierCard[]
  base: { authors: number; posts: number; outliers: number; months: number; top_n: number; audited_posts: number; per_post: number; reactors: number }
  travels: OutlierTravel[]
  bands: OutlierBand[]
  winners: OutlierWinner[]
  method: string[]
}

export type OutlierRead =
  | { kind: 'ready'; data: OutlierStudy }
  | { kind: 'none' }
  | { kind: 'failed'; message: string }

export async function fetchOutliers(lane: string): Promise<OutlierRead> {
  const { data, error } = await supabase.rpc('operator_market_outliers', {
    p_gate: CLIENT_OPS_GATE, p_client_id: lane,
  })
  if (error) return { kind: 'failed', message: error.message || 'The outlier study read failed.' }
  if (data === null || data === undefined) return { kind: 'none' }
  const d = data as Partial<OutlierStudy>
  if (!d.answer || !Array.isArray(d.cards) || !Array.isArray(d.winners) || !d.base) {
    return { kind: 'failed', message: 'The outlier study returned no usable payload.' }
  }
  return {
    kind: 'ready',
    data: {
      ...(d as OutlierStudy),
      travels: Array.isArray(d.travels) ? d.travels : [],
      bands: Array.isArray(d.bands) ? d.bands : [],
      method: Array.isArray(d.method) ? d.method : [],
    },
  }
}

/** The rule on this surface: three cards, three lines, the rest behind the fold. */
export const SHOWN_CARDS = 3
export const SHOWN_WINNERS = 3

const pct = (n: number) => `${Math.round(Number(n) || 0)}%`
const lift = (n: number) => `${(Math.round((Number(n) || 0) * 10) / 10).toString()}x`
const count = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-US')

/** One winner as one line: who, how far past their own baseline, what came back, who reacted. */
export function winnerFigures(w: OutlierWinner): string[] {
  return [
    `${lift(w.lift)} own baseline`,
    `${count(w.likes)} likes`,
    `${count(w.reposts)} reposts`,
    `${pct(w.brand)} brand side of ${count(w.n)}`,
  ]
}

/** A band is a range across posts, never a point: 40 reactors a post cannot carry a decimal. */
export function bandRange(b: OutlierBand): string {
  return b.brand_lo === b.brand_hi ? pct(b.brand_lo) : `${Math.round(b.brand_lo)} to ${pct(b.brand_hi)}`
}

export function bandBase(b: OutlierBand): string {
  return `${count(b.posts)} ${b.posts === 1 ? 'post' : 'posts'}, ${count(b.reactors)} reactors`
}

export { pct as outlierPct }
