import type { Notification, NotificationGroup } from '../../lib/turns'
import { warsawDayWord } from '../ui/time'

// Pure shaping for the bell feed (tested in feedShape.test.ts).

/** A producer's line as a person would say it: no leading emoji, no [ARCH] tag, no em dash, no bare URL. */
export function cleanLine(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/^(?:\p{Extended_Pictographic}|\u200d|\ufe0f|\s)+/u, '')
    .replace(/^\s*\[(ARCH|RISE|IVAN)\]\s*/i, '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\s|:,-]+$/, '')
    .trim()
}

/** The body minus the title it usually repeats. */
export function bodyLine(n: Pick<Notification, 'title' | 'body'>): string {
  const t = cleanLine(n.title)
  const b = cleanLine(n.body)
  if (!b || b === t) return ''
  if (b.startsWith(t)) return b.slice(t.length).replace(/^[\s|:,>*\u2022-]+/, '').trim()
  return b
}

/** Groups by Warsaw day, newest first, with each day's unread count. */
export function feedDays(groups: NotificationGroup[], now: number = Date.now()): { day: string; groups: NotificationGroup[]; unread: number }[] {
  const out: { day: string; groups: NotificationGroup[]; unread: number }[] = []
  for (const g of groups) {
    const day = warsawDayWord(g.lastSeenAt, now)
    const last = out[out.length - 1]
    if (last && last.day === day) { last.groups.push(g); last.unread += g.unread > 0 ? 1 : 0 }
    else out.push({ day, groups: [g], unread: g.unread > 0 ? 1 : 0 })
  }
  return out
}
