/* Outreach performance for the Strategy "Outreach" view. Every number comes from ONE
   database function (`outreach_perf_payload`); this file only types it and formats it.
   The alarm math lives in SQL so the weekly WhatsApp digest and this page can never disagree.
   Spec: docs/superpowers/specs/2026-09-16-outreach-performance-alerts-design.md */
import { supabase } from './supabase'
import type { ContentLane } from './content'

export type PerfCell = { step: string; n: number; replies: number; rate: number; positive_n: number; positive_rate: number | null; base_n: number; base_replies: number; base_rate: number; status: 'ok' | 'thin' | 'drift' }
export type PerfVariant = { step: string; variant: string; n: number; replies: number; rate: number; others_n: number; others_rate: number; status: 'ok' | 'thin' | 'sibling' }
export type PerfSplit = { step: string; dim: 'source' | 'variant' | 'country' | 'vertical'; value: string; n: number; replies: number; rate: number }
export type PerfAlarm = { kind: 'drift' | 'sibling'; step: string; variant: string | null; now_n: number; now_replies: number; now_rate: number; prior_n: number; prior_rate: number; gap: number; suspect_dim: string | null; suspect_share: number | null; split: { value: string; n: number; replies: number; rate: number }[] }
export type PerfRow = { step: string; variant: string; source: string; country: string; vertical: string; n: number; replies: number; rate: number }
export type PerfLane = { lane: string; campaigns: string[]; cells: PerfCell[]; variants: PerfVariant[]; splits: PerfSplit[]; alarms: PerfAlarm[]; table: PerfRow[] }
export type PerfPayload = { ok: boolean; client_id: string; days: number; generated_at: string; mature_before: string; cur_from: string; base_from: string; floor: number; child_floor: number; lanes: PerfLane[]; reply_basis: { threaded: number; stamp_only: number } }
export type PerfState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'empty'; reason: string } | { kind: 'ready'; data: PerfPayload }

export async function fetchOutreachPerf(lane: ContentLane): Promise<PerfState> {
  const { data, error } = await supabase.rpc('outreach_perf_payload', { p_client_id: lane, p_days: 90 })
  if (error) return { kind: 'failed', message: error.message }
  const p = data as PerfPayload | null
  if (!p || p.ok !== true) return { kind: 'failed', message: 'No payload came back.' }
  if (!p.lanes.length) return { kind: 'empty', reason: 'No active lanes with DM sends in the last 90 days.' }
  return { kind: 'ready', data: p }
}

export function pct(rate: number): string { return `${(rate * 100).toFixed(1)}%` }

const STEP: Record<string, string> = { dm1: 'DM1', nudge: 'Nudge', dm3: 'DM3', inmail: 'InMail' }
export function stepLabel(step: string): string { return STEP[step] ?? step }

export function alarmTitle(lane: string, a: PerfAlarm): string {
  return a.variant ? `${lane} · ${stepLabel(a.step)} · ${a.variant}` : `${lane} · ${stepLabel(a.step)}`
}

export function alarmLine(a: PerfAlarm): string {
  const tail = a.kind === 'drift' ? 'prior 60d' : 'other variants'
  return `${pct(a.now_rate)} now (${a.now_replies} of ${a.now_n}) vs ${pct(a.prior_rate)} ${tail}`
}

export function rankAlarms(lanes: PerfLane[]): { lane: string; alarm: PerfAlarm }[] {
  const all = lanes.flatMap(l => l.alarms.map(alarm => ({ lane: l.lane, alarm })))
  const kindRank = (k: PerfAlarm['kind']) => (k === 'drift' ? 0 : 1)
  return all.sort((x, y) => kindRank(x.alarm.kind) - kindRank(y.alarm.kind) || y.alarm.gap - x.alarm.gap)
}
