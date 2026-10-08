// The send log (Ivan 2026-10-08: "an all logs collapsible at the end that shows all sends DM1, DM2,
// DM3, DM4, INVITE, DM5, FOLLOW UP. all tagged"). Every message that actually went out from the seat,
// newest first, each with the touch it was. Read only.
//
// The touch follows the reviewed rules the reply-source snapshot uses (db/20261007_reply_sources.sql):
// message_type first (connection_note = Invite, InMail, Email, a hand-typed reply), then the
// recorded sequence_step for a DM (4 is DM4 unless the template is a recycle), then the template
// name for the step-less sends (replies, scan deliveries, follow-ups). Nothing is guessed past that:
// a send the rules cannot place reads "Other".
import { supabase } from '../../lib/supabase'
import type { InboxMessage, Thread } from '../../lib/inbox'

export type Touch = 'invite' | 'intro' | 'dm1' | 'dm2' | 'dm3' | 'dm4' | 'dm5' | 'recycle' | 'followup' | 'reply' | 'delivery' | 'lm' | 'inmail' | 'email' | 'hand' | 'other'
export const TOUCH_ORDER: readonly Touch[] = ['invite', 'intro', 'dm1', 'dm2', 'dm3', 'dm4', 'dm5', 'recycle', 'followup', 'reply', 'delivery', 'lm', 'inmail', 'email', 'hand', 'other']
export const TOUCH_LABEL: Record<Touch, string> = {
  invite: 'Invite', intro: 'Intro offer', dm1: 'DM1', dm2: 'DM2', dm3: 'DM3', dm4: 'DM4', dm5: 'DM5', recycle: 'Recycle', followup: 'Follow-up',
  reply: 'Reply', delivery: 'Scan sent', lm: 'Lead magnet', inmail: 'InMail', email: 'Email', hand: 'By hand', other: 'Other',
}

export function touchOf(m: Pick<InboxMessage, 'message_type' | 'channel' | 'ai_model'>, step: number | null | undefined): Touch {
  const model = (m.ai_model ?? '').toLowerCase()
  if (m.message_type === 'connection_note') return 'invite'
  if (m.channel === 'email' || m.message_type === 'email') return 'email'
  if (m.message_type === 'inmail' || m.channel === 'linkedin_inmail') return 'inmail'
  if (m.message_type === 'manual_reply' || model === 'manual_mirror' || /^manual/.test(model)) return 'hand'
  if (step != null && step >= 1) {
    if (step === 4 && /recycle/.test(model)) return 'recycle'
    if (step <= 5) return (`dm${step}` as Touch)
  }
  if (/recycle/.test(model)) return 'recycle'
  if (/^pre_dm1/.test(model)) return 'intro'
  if (/lm_gate/.test(model)) return 'lm'
  if (/deliver/.test(model)) return 'delivery'
  if (/reply|warm_reply/.test(model)) return 'reply'
  if (/follow_?up|stall_bump|reopen|cameback/.test(model)) return 'followup'
  return 'other'
}

export type SendRow = { m: InboxMessage; t: Thread; touch: Touch }

export const LOG_DAYS = 30

/** Every sent outbound message of these threads in the last LOG_DAYS, newest first. */
export function sentIn(threads: Thread[], now: number = Date.now()): { m: InboxMessage; t: Thread }[] {
  const from = now - LOG_DAYS * 86_400_000
  const out: { m: InboxMessage; t: Thread }[] = []
  for (const t of threads) for (const m of t.messages) {
    if (m.direction !== 'outbound' || !m.sent_at) continue
    const at = Date.parse(m.sent_at)
    if (at >= from && at <= now + 60_000) out.push({ m, t })
  }
  return out.sort((a, b) => Date.parse(b.m.sent_at!) - Date.parse(a.m.sent_at!))
}

// The view the inbox reads has no sequence_step, so the log asks outreach_messages for the steps
// of the window once (ids + steps only, a few KB a page) and keeps them for the session.
const steps = new Map<string, number | null>()
let inFlight: Promise<void> | null = null
let readAt = 0
export async function readSteps(now: number = Date.now()): Promise<ReadonlyMap<string, number | null>> {
  if (inFlight) { await inFlight; return steps }
  if (readAt && now - readAt < 5 * 60_000) return steps
  inFlight = (async () => {
    const since = new Date(now - LOG_DAYS * 86_400_000).toISOString()
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await supabase.from('outreach_messages').select('id, sequence_step')
        .eq('direction', 'outbound').not('sent_at', 'is', null).gte('sent_at', since)
        .order('sent_at', { ascending: false }).order('id', { ascending: true }).range(from, from + 999)
      if (error) throw error
      for (const r of (data ?? []) as { id: string; sequence_step: number | null }[]) steps.set(r.id, r.sequence_step)
      if (!data || data.length < 1000) break
    }
    readAt = Date.now()
  })()
  try { await inFlight } finally { inFlight = null }
  return steps
}
