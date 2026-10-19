// Test signal on a pending reply draft (read only): how drafts like this one went in the last 45 days.
// RPC reply_draft_history (db/296) computes the category and counts server side. Fetched once per
// opened draft and cached for the session, so it adds nothing to the per-refresh query count.
import { supabase } from './supabase'

export type ReplyHistory = { n: number; unchanged: number; edited: number; discarded: number; windowDays: number; intent: string | null; move: string | null; model: string }

const cache = new Map<string, Promise<ReplyHistory | null>>()

export function fetchReplyHistory(messageId: string): Promise<ReplyHistory | null> {
  let p = cache.get(messageId)
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.rpc('reply_draft_history', { p_message_id: messageId }, { get: true })
      if (error) throw error
      const r = (Array.isArray(data) ? data[0] : null) as { n: number; unchanged: number; edited: number; discarded: number; window_days: number; reply_intent: string | null; move: string | null; ai_model: string } | null | undefined
      return r ? { n: r.n, unchanged: r.unchanged, edited: r.edited, discarded: r.discarded, windowDays: r.window_days, intent: r.reply_intent, move: r.move, model: r.ai_model } : null
    })()
    p.catch(() => cache.delete(messageId))
    cache.set(messageId, p)
  }
  return p
}

export function historyLine(h: ReplyHistory): string {
  if (h.n < 5) return `Not enough history yet (${h.n})`
  return `You sent ${h.unchanged} of ${h.n} like this unchanged (${h.windowDays}d) · edited ${h.edited}, discarded ${h.discarded}`
}

export type DeclineShadow = { v?: string; type?: string | null; is_decline?: boolean | null; would_send?: string | null; proposed_text?: string | null; reason?: string | null; quote?: string | null }

const TYPE: Record<string, string> = {
  not_now: 'not now', budget_objection: 'budget objection', no_funds: 'no budget', already_covered: 'already covered',
  brush_off: 'brush-off', hard_no: 'flat no', no_pitch_policy: 'no-pitch policy', wrong_person: 'wrong person / left',
  scan_objection: 'objects to the scan', wrong_vertical: 'not their kind of business',
}
const WOULD: Record<string, string> = {
  nothing: 'send nothing', close: 'close', close_door: 'close + door open', question: 'ask a question', writer: 'keep the drafter\'s reply',
}

export function declineLine(d: DeclineShadow): string | null {
  if (!d || d.v !== 'decline_shadow_v1') return null
  const type = d.is_decline ? (TYPE[d.type ?? ''] ?? d.type ?? 'decline') : 'not a decline'
  const would = WOULD[d.would_send ?? ''] ?? d.would_send ?? '?'
  return `${type} → would ${would}`
}
