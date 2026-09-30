import type { IdeaScoreRow } from '../../lib/ideaScores'
import { label } from '../../lib/labels'

// Read-at-a-glance marks for an idea row (Ivan 09-29: "I can't see shit").
// Score and outlier each get a color range; the source gets a stable hue so
// rows from the same feed group by eye. Lime stays reserved for live state.

export type Tier = 'top' | 'good' | 'mid' | 'low' | 'none'

/** Composite / ICP score, 0-100ish: 90+ top, 75+ good, 60+ mid, below low. */
export function scoreTier(s: number | null): Tier {
  if (s == null || s < 0) return 'none'
  return s >= 90 ? 'top' : s >= 75 ? 'good' : s >= 60 ? 'mid' : 'low'
}

/** Outlier lift, 1.0 = baseline: 1.5+ strong, 1.0+ above, below is below. */
export function outlierTier(s: number): Tier {
  return s >= 1.5 ? 'top' : s >= 1 ? 'mid' : 'low'
}

const HUES = ['amber', 'mint', 'sky', 'violet', 'pink'] as const
export type Hue = typeof HUES[number] | 'coral' | 'grey'

export function sourceHue(src: string): Hue {
  const s = src.toLowerCase()
  if (!s || s === 'manual') return 'grey'
  if (/call/.test(s)) return 'violet'
  if (/radar|industry/.test(s)) return 'sky'
  if (/competitor/.test(s)) return 'coral'
  if (/\bx\b|twitter|viral/.test(s)) return 'pink'
  if (/claude|session/.test(s)) return 'mint'
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
}

export function ScorePill({ score, big }: { score: number | null; big?: boolean }) {
  const t = scoreTier(score)
  return (
    <span className={`cn-pill cn-t-${t}${big ? ' cn-pill-big' : ''}`} title={t === 'none' ? 'Not scored yet' : `Score ${Math.round(score!)}`}>
      {t === 'none' ? '–' : Math.round(score!)}
    </span>
  )
}

/** The row's tag strip: source, format, outlier lift, unclassified. */
export function IdeaTags({ src, row, unvalidated, unclassified }: { src: string; row?: IdeaScoreRow; unvalidated: boolean; unclassified?: boolean }) {
  const bare = src.replace(/^From /, '').replace(/\s*\(personal pass[^)]*\)$/i, '')
  const name = bare.charAt(0).toUpperCase() + bare.slice(1)
  void unvalidated
  return (
    <span className="cn-tags">
      {name && <span className={`cn-tag cn-h-${sourceHue(src)}`} title={src}>{name}</span>}
      {row?.recommended_format && <span className="cn-tag cn-h-grey">{label(row.recommended_format)}</span>}
      {unclassified && <span className="cn-tag cn-h-coral">no content type</span>}
    </span>
  )
}
