import { normalizeImageUrls, type ContentDraft } from '../../../lib/content'
import { dayLabel, type Lane } from '../model'
import { laneOfRow } from '../weekModel'
import { warsawDay } from '../../ui/time'
import { DAY_MS } from '../model'

// THE SAME PICTURE TWICE (SPEC-content §2.2 PicState, upgrade #3; Ivan:
// "same selfies everywhere"). Pure over the week's rows: a single picture
// (never a carousel's slides) that another post of the same seat also carries,
// dated within ±14 days of this one or waiting in review, flags BOTH posts.
export const REPEAT_DAYS = 14

/** One URL, compared without its query string or case (signed links and resizes differ there). */
export function normUrl(u: string): string {
  return u.split('?')[0].split('#')[0].trim().toLowerCase()
}

export type Repeat = { otherId: string; label: string }

const whenOf = (r: ContentDraft): number => Date.parse(r.scheduled_at ?? r.created_at)

export function picRepeats(rows: readonly ContentDraft[]): Map<string, Repeat> {
  const byUrl = new Map<string, ContentDraft[]>()
  for (const r of rows) {
    if (r.type === 'carousel' || r.type === 'video' || r.published_at || r.status === 'published') continue
    const lane = laneOfRow(r)
    const first = normalizeImageUrls(r.image_urls)[0]
    if (!lane || !first) continue
    const k = `${lane}|${normUrl(first)}`
    const a = byUrl.get(k); if (a) a.push(r); else byUrl.set(k, [r])
  }
  const out = new Map<string, Repeat>()
  for (const list of byUrl.values()) {
    if (list.length < 2) continue
    for (const r of list) {
      const other = list.find(o => o.id !== r.id && (o.status === 'review' || r.status === 'review' || Math.abs(whenOf(o) - whenOf(r)) <= REPEAT_DAYS * DAY_MS))
      if (!other) continue
      out.set(r.id, { otherId: other.id, label: other.scheduled_at ? `also on ${dayLabel(warsawDay(other.scheduled_at)).replace(/ \w+$/, '')}` : 'also on a draft in review' })
    }
  }
  return out
}

export type { Lane }
