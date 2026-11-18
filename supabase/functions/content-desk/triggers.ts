// Proactive desk messages: triggers, not a timer (MISSION section 3). Pure, so
// the 2-week replay (OUT/eval/replay_triggers.py) runs the exact rules.
//
// Five triggers, each carrying an artifact, each deduped by key:
//   week_plan    Monday 08:00+ Warsaw: what's dated, autopilot picks, open slots, drafts that fit
//   call_line    a fresh postable line from a call (quoted verbatim) + a "Draft it" chip
//   post_beat    a post beating its own normal (>= 2x his organic median, >= 48h old, not boosted)
//   empty_slot   a week with an open original slot that starts within 72h
//   t3_done      a cloud job finished (the report RPC writes that message; counted, never suppressed)
// At most `cap` (5) per Warsaw week. Proactive messages only TALK: every change
// needs Ivan's reply, so a chip is the most a trigger ever offers.

import type { WeekFill, PostRow, CallLine } from './brief.ts'
import { warsaw } from './brief.ts'

export type LedgerRow = { kind: string; dedupe_key: string; fired_at: string; suppressed?: string | null }
export type ReviewDraft = { first_line: string; belief: number | null; vehicle: string | null; is_copy: boolean; status: string; scheduled_at: string | null }
export type TriggerInput = {
  now: string
  weeks: WeekFill[]                 // from render(): this week, next week, week after
  posts: PostRow[]                  // ivan_week_posts_worked rows
  callLines: CallLine[]
  queue: { slot_at: string; origin: string; first_line: string }[]
  drafts: ReviewDraft[]             // undated review drafts that could fill a slot
  t3Done: { id: string; title: string; at: string }[]
  ledger: LedgerRow[]
  cap?: number
}
export type Planned = {
  kind: 'week_plan' | 'call_line' | 'post_beat' | 'empty_slot' | 't3_done'
  dedupe_key: string
  body: string
  artifact: { kind: string; ref: string }
  chips: { label: string; send: string }[]
}

const TZ = 'Europe/Warsaw'
const PER_KIND: Record<string, number> = { week_plan: 1, call_line: 2, post_beat: 1, empty_slot: 1, t3_done: 99 }
const PRIORITY = ['t3_done', 'week_plan', 'call_line', 'empty_slot', 'post_beat']

function wall(iso: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>)
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday }
}

/** The Monday (YYYY-MM-DD, Warsaw) of the week holding this instant. */
export function warsawMonday(iso: string): string {
  const w = wall(iso)
  const d = new Date(w.day + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** Warsaw midnight of a YYYY-MM-DD as an instant (ms). */
function warsawMidnight(day: string): number {
  let t = Date.parse(day + 'T00:00:00Z')
  for (let k = 0; k < 2; k++) {
    const w = wall(new Date(t).toISOString())
    const wallMs = Date.parse(w.day + 'T' + String(w.hour).padStart(2, '0') + ':00:00Z')
    t += Date.parse(day + 'T00:00:00Z') - wallMs
  }
  return t
}

const q = (s: string, n = 90) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return `"${t.length > n ? t.slice(0, n - 1) + '…' : t}"` }

function fillers(w: WeekFill, drafts: ReviewDraft[]): ReviewDraft[] {
  const undated = drafts.filter((d) => d.status === 'review' && !d.scheduled_at && !d.is_copy)
  const want = w.poland < 1 ? undated.filter((d) => d.belief === 5 || d.vehicle === 'poland_place') : []
  const missing = undated.filter((d) => d.belief != null && w.missing_beliefs.includes(d.belief))
  return [...new Set([...want, ...missing, ...undated])].slice(0, 2)
}

export function planTriggers(input: TriggerInput): Planned[] {
  const cap = input.cap ?? 5
  const now = input.now
  const nowMs = Date.parse(now)
  const w = wall(now)
  const monday = warsawMonday(now)
  const fired = new Set(input.ledger.map((l) => l.dedupe_key))
  const out: Planned[] = []
  const daytime = w.hour >= 8 && w.hour < 21

  // ---- t3_done (never suppressed; the report RPC already wrote the message)
  for (const j of input.t3Done) {
    const key = `t3_done:${j.id}`
    if (!fired.has(key)) out.push({ kind: 't3_done', dedupe_key: key, body: `Cloud job finished: ${q(j.title, 80)}.`, artifact: { kind: 't3_job', ref: j.id }, chips: [] })
  }

  if (daytime) {
    // ---- week_plan: Monday from 08:00
    const thisWeek = input.weeks.find((x) => x.week_start === monday)
    if (w.weekday === 'Mon' && thisWeek) {
      const key = `week_plan:${monday}`
      if (!fired.has(key)) {
        const auto = input.queue.filter((x) => x.origin === 'autopilot' && warsawMonday(x.slot_at) === monday)
        const lines = [`Your week: ${thisWeek.originals} of ${thisWeek.cap} originals dated${thisWeek.dated.length > thisWeek.originals ? `, plus ${thisWeek.dated.length - thisWeek.originals} ${thisWeek.dated.length - thisWeek.originals === 1 ? 'copy' : 'copies'}` : ''}.`]
        for (const x of thisWeek.dated) lines.push(`- ${warsaw(x.at)} ${q(x.first_line, 70)}${auto.some((a) => a.slot_at === x.at) ? ' (autopilot pick)' : ''}`)
        if (thisWeek.open.length) lines.push(`Open: ${thisWeek.open.join('; ')}.`)
        const fit = fillers(thisWeek, input.drafts)
        if (fit.length && thisWeek.originals < thisWeek.cap) lines.push(`Drafts that could fill it: ${fit.map((d) => q(d.first_line, 60)).join(' and ')}.`)
        out.push({
          kind: 'week_plan', dedupe_key: key, body: lines.join('\n'), artifact: { kind: 'week', ref: monday },
          chips: fit.length && thisWeek.originals < thisWeek.cap
            ? [{ label: 'Date the first one', send: `date the one that starts ${q(fit[0].first_line, 70)} on this week's open day` }]
            : [],
        })
      }
    }

    // ---- call_line: a fresh postable line (last 24h), quoted verbatim
    for (const c of input.callLines) {
      const age = nowMs - Date.parse(c.ingested_at)
      if (!(age >= 0 && age <= 24 * 3600e3)) continue
      if (!c.said || c.draft_id || !['scored', 'reviewing', 'pending'].includes(c.status)) continue
      const key = `call_line:${c.id}`
      if (fired.has(key)) continue
      out.push({
        kind: 'call_line', dedupe_key: key,
        body: `A line from your call that could be a post${c.belief ? ` (belief ${c.belief})` : ''}:\n"${c.said.trim()}"\n${c.topic ? c.topic.trim() : ''}`.trim(),
        artifact: { kind: 'call_line', ref: c.id },
        chips: [{ label: 'Draft it', send: `draft a post from the call line that starts ${q(c.said, 60)}` }],
      })
    }

    // ---- post_beat: beating its own normal, 2+ days old, not boosted, posted in the last 5 days
    for (const p of input.posts) {
      if (!p.posted_at || p.too_new || p.boosted || !p.worked || (p.times_median ?? 0) < 2) continue
      const age = nowMs - Date.parse(p.posted_at)
      if (age > 5 * 86400e3) continue
      const key = `post_beat:${p.url ?? p.first_line}`
      if (fired.has(key)) continue
      out.push({
        kind: 'post_beat', dedupe_key: key,
        body: `${q(p.first_line ?? '', 80)} is beating your normal: ${p.impressions ?? '?'} impressions, ${p.times_median}x your median, ${p.likes ?? 0} likes, ${p.comments ?? 0} comments. A follow-up on the same thread could ride it.`,
        artifact: { kind: 'post', ref: p.url ?? '' },
        chips: [{ label: 'Idea: follow-up', send: `save an idea: a follow-up to ${q(p.first_line ?? '', 60)}` }],
      })
    }

    // ---- empty_slot: a week with an open original slot starting within 72h (or running now)
    for (const wk of input.weeks) {
      if (wk.originals >= wk.cap) continue
      const start = warsawMidnight(wk.week_start)
      const end = start + 7 * 86400e3
      const lead = start - nowMs
      if (!(lead <= 72 * 3600e3 && nowMs < end - 2 * 86400e3)) continue
      if (wk.week_start === monday && w.weekday === 'Mon') continue // the week plan covers it
      const key = `empty_slot:${wk.week_start}`
      if (fired.has(key)) continue
      const fit = fillers(wk, input.drafts)
      out.push({
        kind: 'empty_slot', dedupe_key: key,
        body: `${wk.label === 'THIS WEEK' ? 'This week' : 'Week of ' + wk.week_start} still has ${wk.cap - wk.originals} open original slot${wk.cap - wk.originals > 1 ? 's' : ''}${wk.open.length ? ': ' + wk.open.slice(1).join('; ') : ''}.${fit.length ? ` Drafts that fit: ${fit.map((d) => q(d.first_line, 60)).join(' and ')}.` : ' No undated draft fits yet.'}`,
        artifact: { kind: 'week', ref: wk.week_start },
        chips: fit.length ? [{ label: 'Date the first one', send: `date the one that starts ${q(fit[0].first_line, 70)} in the open slot of the week of ${wk.week_start}` }] : [],
      })
      break
    }
  }

  // ---- caps: per kind and per Warsaw week, counting what already fired
  const week = input.ledger.filter((l) => !l.suppressed && warsawMonday(l.fired_at) === monday)
  const count: Record<string, number> = {}
  for (const l of week) count[l.kind] = (count[l.kind] ?? 0) + 1
  let total = week.length
  const kept: Planned[] = []
  for (const p of out.sort((a, z) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(z.kind))) {
    if (p.kind !== 't3_done') {
      if (total >= cap) continue
      if ((count[p.kind] ?? 0) >= (PER_KIND[p.kind] ?? 1)) continue
    }
    count[p.kind] = (count[p.kind] ?? 0) + 1
    total++
    kept.push(p)
  }
  return kept
}
