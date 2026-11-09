// INBOX_EMAIL_STATS_V1 (2026-11-09): Instantly's counters for Ivan's cold/warm email, read through the
// inbox-email-stats function (the Instantly key stays server-side). Bare fetch, same as inboxCalendar.ts.
import { supabase } from './supabase'
import type { EmailStats } from '../../supabase/functions/inbox-email-stats/handler'
export type { EmailStats, CampaignStat, DayStat, MailboxStat } from '../../supabase/functions/inbox-email-stats/handler'

export async function fetchEmailStats(): Promise<EmailStats> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw Error('Sign in again to read email stats.')
  const r = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-email-stats`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(11000),
  })
  const result = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(result.error || 'Email stats are unavailable. Try again.')
  return result as EmailStats
}

/** Instantly campaign status codes (v2 API). */
export const CAMPAIGN_STATUS: Record<number, string> = { 0: 'draft', 1: 'sending', 2: 'paused', 3: 'finished', 4: 'follow-ups only', [-1]: 'mailboxes unhealthy', [-2]: 'bounce protection', [-99]: 'suspended' }

/** The 7 calendar days ending today, zero for a day Instantly has no row for (weekends send nothing). */
export function lastDays(s: EmailStats, today: string) {
  const end = Date.parse(today + 'T00:00:00Z')
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(end - (6 - i) * 86400000).toISOString().slice(0, 10)
    return s.days.find(d => d.date === date) ?? { date, sent: 0, replies: 0, auto_replies: 0 }
  })
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

export function emailTotals(s: EmailStats, today: string) {
  const live = s.campaigns
  const sum = (k: 'sent' | 'contacted' | 'replies' | 'auto_replies' | 'bounced' | 'unsubscribed' | 'opportunities') => live.reduce((a, c) => a + c[k], 0)
  const sent = sum('sent'), contacted = sum('contacted'), bounced = sum('bounced'), replies = sum('replies')
  const week = lastDays(s, today)
  return {
    sent, contacted, bounced, replies, auto: sum('auto_replies'), unsubscribed: sum('unsubscribed'), opportunities: sum('opportunities'),
    bouncePct: pct(bounced, sent), replyPct: pct(replies, contacted),
    today: s.days.find(d => d.date === today)?.sent ?? 0, week: week.reduce((a, d) => a + d.sent, 0),
    opensOff: live.length > 0 && live.every(c => c.open_tracking === false),
  }
}
