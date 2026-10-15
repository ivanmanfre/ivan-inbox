import type { ReactNode } from 'react'
import { tagsLine, type PostTags } from './calTags'

// The calendar's tag row (calTags.ts reads the tags).

/**
 * The tag row. `compact` (month cells): format, aim and the board tag, the pillar folded into the
 * row's title. Full (day list, buffer): every tag, the aim spelled "Aim: Trust".
 */
export function CalTags({ t, compact = false, lead }: { t: PostTags | null; compact?: boolean; lead?: ReactNode }) {
  if (!t) return lead ? <span className="cv2-tags">{lead}</span> : null
  return (
    <span className={`cv2-tags${compact ? ' cv2-tags-c' : ''}`} title={tagsLine(t)}>
      {lead}
      {t.board === 'on' && <span className="cv2-tag cv2-tag-board" title={t.boardTitle}>{t.boardWord}</span>}
      {t.board === 'removed' && <span className="cv2-tag cv2-tag-removed" title={t.boardTitle}>{t.boardWord}</span>}
      {t.lm && <span className="cv2-tag cv2-tag-lm">LM</span>}
      <span className="cv2-tag cv2-tag-fmt">{t.format}</span>
      {t.aim && <span className="cv2-tag cv2-tag-aim" title={`Aim: ${t.aim}`}>{compact ? t.aim : `Aim: ${t.aim}`}</span>}
      {t.pillar && <span className="cv2-tag cv2-tag-pillar" title={`Pillar: ${t.pillar}`}>{t.pillar}</span>}
    </span>
  )
}
