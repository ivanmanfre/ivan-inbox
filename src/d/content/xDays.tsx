import { useEffect, useState } from 'react'
import { fetchXCalendar, type XCalendarItem } from '../../lib/xReview'
import { XLogo } from '../ops/x/glyphs'
import { warsawDay, warsawDayTime, warsawHm } from '../ui/time'

// X ARTICLES ON THE CALENDAR (Ivan 2026-10-11: "a small flag on every box when there is an
// x article scheduled"). A mark on the day, never a card: an article is not a LinkedIn draft
// and cannot be dragged here. Scheduled = black, out = grey, failed = red.

export type XDays = Map<string, XCalendarItem[]>

/** Every X article with a day from 60 days back to 4 months ahead, keyed by Warsaw day. */
export function useXDays(): XDays {
  const [days, setDays] = useState<XDays>(() => new Map())
  useEffect(() => {
    let live = true
    const read = () => {
      const now = Date.now()
      fetchXCalendar(new Date(now - 60 * 864e5), new Date(now + 120 * 864e5))
        .then(r => {
          if (!live) return
          const m: XDays = new Map()
          for (const x of r) { const k = warsawDay(x.at); m.set(k, [...(m.get(k) ?? []), x]) }
          setDays(m)
        })
        .catch(() => { /* the calendar still works without the marks */ })
    }
    read()
    const t = setInterval(read, 5 * 60_000)
    return () => { live = false; clearInterval(t) }
  }, [])
  return days
}

const WORD: Record<string, string> = { approved: 'scheduled', publishing: 'going out', published: 'out', failed: 'failed' }

export function XMarks({ items, time = true }: { items: XCalendarItem[] | undefined; time?: boolean }) {
  if (!items?.length) return null
  return (
    <>
      {items.map(x => {
        const out = x.status === 'published' && !!x.x_url
        const label = `X article ${WORD[x.status] ?? x.status}, ${warsawDayTime(x.at)}: ${x.title ?? ''}`
        return (
          <a
            key={x.id} className="xmark" data-status={x.status}
            href={out ? x.x_url! : `#exp/d/ops/x?id=${x.id}`}
            {...(out ? { target: '_blank', rel: 'noreferrer' } : {})}
            aria-label={label} title={label}
            onClick={e => e.stopPropagation()}
          >
            <XLogo size={9} />{time && <span>{warsawHm(x.at)}</span>}
          </a>
        )
      })}
    </>
  )
}
