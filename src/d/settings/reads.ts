/* Settings reads: the push devices (from their user agent; the endpoint and keys
   never leave the DB), the client boards (slug for the label, token only inside
   the link), and the two Money figures the plate shows. All SELECTs. */
import { supabase } from '../../lib/supabase'
import { fetchCashConfig, fetchMrrRows, mrrByClient, type ClientMrrRow } from '../../lib/money'

export type Device = { device: 'iPhone' | 'Mac' | 'Browser'; browser: string; created_at: string }

export function deviceOf(ua: string | null | undefined): Pick<Device, 'device' | 'browser'> {
  const u = ua ?? ''
  const device = /iPhone|iPad/.test(u) ? 'iPhone' : /Macintosh/.test(u) ? 'Mac' : 'Browser'
  const browser = device === 'iPhone' ? 'Safari (Home Screen app)' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'browser'
  return { device, browser }
}

/** Newest first. */
export async function fetchDevices(): Promise<Device[]> {
  const { data, error } = await supabase.from('push_subscriptions').select('user_agent, created_at').order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{ user_agent: string | null; created_at: string }>).map(r => ({ ...deviceOf(r.user_agent), created_at: r.created_at }))
}

export type Board = { slug: string; client_id: string; token: string }
export async function fetchBoards(): Promise<Board[]> {
  const { data, error } = await supabase.from('client_boards').select('slug, client_id, token').in('client_id', ['risedtc', 'arch'])
  if (error) throw error
  return (data ?? []) as Board[]
}

export type MoneyPlate = { mrr: ClientMrrRow[]; cash: number | null; cashAsOf: string | null }
export async function fetchMoneyPlate(): Promise<MoneyPlate> {
  const [rows, cash] = await Promise.all([fetchMrrRows(), fetchCashConfig()])
  return { mrr: mrrByClient(rows), cash: cash.cashOnHandUsd, cashAsOf: cash.cashAsOfDate }
}
