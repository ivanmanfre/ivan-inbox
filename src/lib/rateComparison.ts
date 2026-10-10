import { supabase } from './supabase'
import type { Seat } from '../d/seats'

export type RateDates = { from: string; to: string }
export type RateComparisonRow = {
  client_id: Seat; period: 'current' | 'previous'; period_from: string; period_to: string
  lane: string; channel: 'invitation' | 'dm'; people: number; mature: number
  pending: number; outcomes: number; rate_pct: number | null
}
export function warsawDate(now: number): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year','month','day'].map(k => p.find(x => x.type === k)!.value).join('-')
}
// UTC arithmetic is only on date-only strings, never a local timestamp key.
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0,10)
export function presetRateDates(days: number, now: number): RateDates {
  const today = warsawDate(now)
  return { from: shift(today, -days), to: shift(today, -1) }
}
export function previousRateDates(d: RateDates): RateDates {
  const days = Math.round((Date.parse(d.to) - Date.parse(d.from)) / 864e5) + 1
  return { from: shift(d.from, -days), to: shift(d.from, -1) }
}
export function validRateDates(d: RateDates, today: string): boolean {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && shift(s, 0) === s
  return valid(d.from) && valid(d.to) && d.from <= d.to && d.to <= today
}
export async function fetchRateComparison(d: RateDates): Promise<RateComparisonRow[]> {
  const { data, error } = await supabase.rpc('inbox_rate_comparison', { p_from: d.from, p_to: d.to })
  if (error) throw error
  return (data ?? []) as RateComparisonRow[]
}
