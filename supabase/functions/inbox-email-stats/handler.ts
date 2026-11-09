// INBOX_EMAIL_STATS_V1 (2026-11-09). Ivan: "on Lanes on ivan i wanna see the email sends count ... bounce stats
// and all relevant email stats from instantly". Instantly's own counters, read live with the server-side key;
// the key never reaches the browser. Read-only: no campaign, lead or mailbox is touched.

export type CampaignStat = {
  id: string; name: string; status: number; daily_limit: number | null; open_tracking: boolean | null; leads: number; contacted: number; sent: number
  replies: number; auto_replies: number; bounced: number; unsubscribed: number; completed: number; opportunities: number
}
export type DayStat = { date: string; sent: number; replies: number; auto_replies: number }
export type MailboxStat = { day: string; count: number; healthy: number; min_health: number | null; spam: number; problems: string[] }
export type EmailStats = { fetched_at: string; campaigns: CampaignStat[]; days: DayStat[]; mailboxes: MailboxStat | null }

type Get = (path: string) => Promise<unknown>
export type MailboxRow = { day: string; email: string; health_score: number | string | null; warmup_spam: number | string | null; problems: unknown }

const num = (v: unknown) => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : 0 }
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export async function readEmailStats(get: Get, mailboxRows: MailboxRow[], now = Date.now()): Promise<EmailStats> {
  const [rawCampaigns, rawDays, rawList] = await Promise.all([
    get('/api/v2/campaigns/analytics'),
    get(`/api/v2/campaigns/analytics/daily?start_date=${isoDay(now - 13 * 86400000)}&end_date=${isoDay(now)}`),
    // Settings (daily cap, open tracking) live on the campaign, not in its analytics.
    get('/api/v2/campaigns?limit=100').catch(() => null),
  ])
  if (!Array.isArray(rawCampaigns) || !Array.isArray(rawDays)) throw Error('Instantly answered in an unexpected shape.')
  const items = rawList && typeof rawList === 'object' && Array.isArray((rawList as { items?: unknown }).items) ? (rawList as { items: Record<string, unknown>[] }).items : []
  const setting = new Map(items.map(c => [String(c.id), c]))
  const campaigns = rawCampaigns.map((c: Record<string, unknown>) => ({
    id: String(c.campaign_id ?? ''), name: String(c.campaign_name ?? 'Campaign'), status: num(c.campaign_status),
    daily_limit: typeof setting.get(String(c.campaign_id))?.daily_limit === 'number' ? setting.get(String(c.campaign_id))!.daily_limit as number : null,
    open_tracking: typeof setting.get(String(c.campaign_id))?.open_tracking === 'boolean' ? setting.get(String(c.campaign_id))!.open_tracking as boolean : null,
    leads: num(c.leads_count), contacted: num(c.contacted_count), sent: num(c.emails_sent_count),
    // Instantly counts out-of-office answers in reply_count_automatic; a person's answer is the unique non-automatic one.
    replies: num(c.reply_count_unique), auto_replies: num(c.reply_count_automatic_unique),
    bounced: num(c.bounced_count), unsubscribed: num(c.unsubscribed_count), completed: num(c.completed_count),
    opportunities: num(c.total_opportunities),
  })).filter(c => c.id)
  const days = rawDays.map((d: Record<string, unknown>) => ({
    date: String(d.date ?? ''), sent: num(d.sent), replies: num(d.unique_replies), auto_replies: num(d.unique_replies_automatic),
  })).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).sort((a, b) => a.date.localeCompare(b.date))
  return { fetched_at: new Date(now).toISOString(), campaigns, days, mailboxes: mailboxesOf(mailboxRows) }
}

/** The newest monitor day only (n8n R8Qb7rPvEmZxT7DY writes one row per mailbox per day). */
export function mailboxesOf(rows: MailboxRow[]): MailboxStat | null {
  const day = rows.reduce((m, r) => (r.day > m ? r.day : m), '')
  if (!day) return null
  const today = rows.filter(r => r.day === day)
  const scores = today.filter(r => r.health_score != null && r.health_score !== '').map(r => num(r.health_score))
  const problems = today.flatMap(r => (Array.isArray(r.problems) ? r.problems : []).map(p => `${r.email}: ${typeof p === 'string' ? p : JSON.stringify(p)}`))
  return {
    day, count: today.length, healthy: today.filter(r => !(Array.isArray(r.problems) && r.problems.length)).length,
    min_health: scores.length ? Math.min(...scores) : null, spam: today.reduce((a, r) => a + num(r.warmup_spam), 0), problems,
  }
}
