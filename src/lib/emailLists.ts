import { supabase } from './supabase'

// Sales > Email: one read, the `inbox_email_lists` RPC (SECURITY DEFINER,
// operator only, counts only). Test rows and our own addresses are never
// counted; `hidden` says how many were left out so a small number is honest.
// Ivan's cold email lane (Instantly) is not a nurture list and is not here.

export type EmailList = {
  key: string
  kind: 'nurture' | 'signup' | 'broadcast' | 'request'
  name: string
  real?: number
  hidden?: number
  last30?: number
  last_at?: string | null
  sent?: number
  pending?: number
  unsub?: number
  bounced?: number
  steps?: number
  live_steps?: number
  step1_active?: boolean
  issues?: number
  last_sent?: string | null
  last_recipients?: number | null
  failed?: number
  qualifying?: number
  reports_sent?: number
  enrolled?: number
}

export type EmailClient = { client: 'ivan' | 'swishdm' | 'rise' | 'arch'; label: string; lists: EmailList[] }
export type EmailLists = { at: string; swishdm_nurture_armed: boolean; clients: EmailClient[] }

export async function fetchEmailLists(): Promise<EmailLists> {
  const { data, error } = await supabase.rpc('inbox_email_lists')
  if (error) throw new Error(error.message)
  const d = data as (EmailLists & { ok?: boolean }) | null
  if (!d || d.ok !== true || !Array.isArray(d.clients)) throw new Error('The email list read came back empty.')
  return d
}

/** A list with nothing in it, ever (no real or hidden sign-up, nothing sent). */
export function isUnused(l: EmailList): boolean {
  if (l.kind === 'broadcast') return (l.issues ?? 0) === 0
  return (l.real ?? 0) === 0 && (l.hidden ?? 0) === 0 && (l.sent ?? 0) === 0
}

/** The lists worth a row, and the never-used ones folded into one line. SwishDM's own nurture always shows. */
export function splitLists(c: EmailClient): { shown: EmailList[]; unused: EmailList[] } {
  const keep = (l: EmailList) => !isUnused(l) || l.key === 'seq:swishdm_ai_search_report' || l.kind === 'request' || l.kind === 'signup'
  return { shown: c.lists.filter(keep), unused: c.lists.filter(l => !keep(l)) }
}

/** Lists whose members come from another list (SwishDM report nurture = sent report requests): shown, never summed. */
export const DERIVED = new Set(['seq:swishdm_ai_search_report'])

/** Real sign-ups across a client's lists (broadcasts are not sign-ups; derived lists would double count). */
export function clientReal(c: EmailClient): { real: number; last30: number } {
  return c.lists.reduce((a, l) => (l.kind === 'broadcast' || DERIVED.has(l.key) ? a : { real: a.real + (l.real ?? 0), last30: a.last30 + (l.last30 ?? 0) }), { real: 0, last30: 0 })
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' })
const DAY_Y = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw' })
export function shortDay(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never'
  return d.getUTCFullYear() === now.getUTCFullYear() ? DAY.format(d) : DAY_Y.format(d)
}
