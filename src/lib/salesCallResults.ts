import { supabase } from './supabase'

export type SalesCallResult = {
  meeting_id: string
  name: string
  starts_at: string
  outcome: string | null
  deal_status: string | null
  prospect_id: string | null
}

export async function fetchSalesCallResults(): Promise<SalesCallResult[]> {
  const { data, error } = await supabase.rpc('inbox_sales_call_results')
  if (error) throw error
  return data as SalesCallResult[]
}

const OUTCOMES: ReadonlyMap<string, string> = new Map([
  ['HELD', 'Held'],
  ['COMPLETED', 'Held'],
  ['NO_SHOW', 'No-show'],
  ['NOSHOW', 'No-show'],
  ['CANCELED', 'Canceled'],
  ['CANCELLED', 'Canceled'],
  ['RESCHEDULED', 'Rescheduled'],
])

export function callResultLabel(outcome: string | null): string {
  return OUTCOMES.get(outcome?.trim().toUpperCase().replace(/[-\s]+/g, '_') ?? '') ?? 'Unconfirmed'
}

export const DEAL_STATUS: ReadonlyMap<string, string> = new Map([
  ['open', 'Follow-up open'],
  ['lost', 'Lost'],
  ['won', 'Won'],
  ['stop', 'Follow-up stopped'],
  ['next_call_booked', 'Next call booked'],
])
