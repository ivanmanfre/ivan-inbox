import type { ContentDraft } from '../../../lib/content'
import type { PolandRead } from '../../../lib/poland'
import { DAY_MS, WAIT_DAYS } from '../model'
import type { PlanItem } from './planBrain'

// THE POLAND METER (review 2026-11-06 #31). Ivan 2026-10-27: "we need more poland posts", about 2 a week; his
// cadence is 5 a week (content_plan_config). Each Weeks row says "Poland 2/2 · Business 2/3". What counts as Poland is
// the reasoned read (lib/poland), never a keyword. Polemic, political and migration takes count like any other:
// nothing is filtered out of the picks.
export const POLAND_TARGET = 2

export type WeekMix = { poland: number; business: number; unread: number; businessTarget: number }

/** The week's split over the cards the row draws. A card no read covers yet (or a slot with no draft) is "unread". */
export function weekMix(drawn: readonly PlanItem[], reads: ReadonlyMap<string, PolandRead>, target: number): WeekMix {
  let poland = 0, business = 0, unread = 0
  for (const it of drawn) {
    const v = it.draftId ? reads.get(it.draftId)?.poland : null
    if (v === true) poland++
    else if (v === false) business++
    else unread++
  }
  return { poland, business, unread, businessTarget: Math.max(0, target - POLAND_TARGET) }
}

export function mixWords(m: WeekMix): string {
  return `Poland ${m.poland}/${POLAND_TARGET} · Business ${m.business}/${m.businessTarget}${m.unread ? ` · ${m.unread} not read yet` : ''}`
}

/** "X outlier by @x (tracked account; 710 likes vs own median 15)": the source's lift, or 0. */
function liftOf(r: Pick<ContentDraft, 'source_label'>): number {
  const m = (r.source_label ?? '').match(/(\d[\d,]*) likes vs own median ([\d.]+)/i)
  if (!m) return 0
  const likes = Number(m[1].replace(/,/g, '')), med = Number(m[2])
  return med > 0 ? likes / med : likes
}

const QA_HELD = /^QA_(HELD|BLOCKED)$/i

/**
 * The Poland drafts waiting in Review that a short week can take, best first: written in the last 14 days before
 * older ones, then the source's lift (likes over its author's median), then the newest. Undated review drafts of
 * Ivan's seat only, never one already on the plan, held by an Undo, or held by writing QA.
 */
export function polandPicks(rows: readonly ContentDraft[], reads: ReadonlyMap<string, PolandRead>, skip: ReadonlySet<string>, now: number): ContentDraft[] {
  const fresh = (r: ContentDraft) => (Date.parse(r.created_at) || 0) > now - WAIT_DAYS * DAY_MS
  return rows
    .filter(r => r.client_id == null && r.status === 'review' && !r.scheduled_at && !r.published_at && !skip.has(r.id)
      && reads.get(r.id)?.poland === true && !QA_HELD.test((r.qa_verdict ?? '').trim()))
    .sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || liftOf(b) - liftOf(a) || b.created_at.localeCompare(a.created_at))
}
