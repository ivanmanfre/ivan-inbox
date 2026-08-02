import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_SECTION_STATE, readSectionState, writeSectionState, type SectionState,
} from '../lib/sectionState'

/**
 * A section's filter + search state, restored on mount and written on change.
 *
 * Keyed per section (`content.posts.ivan`, `content.lm.risedtc`, …) so two
 * lists that happen to share a facet vocabulary still keep their own answer.
 * The initialiser reads storage SYNCHRONOUSLY — the same instant-paint rule the
 * Today cache follows — because a filter that appears a frame after the rows do
 * makes the list visibly jump under a hand.
 */
export function useSectionState(section: string): [SectionState, (s: SectionState) => void] {
  const [state, setState] = useState<SectionState>(() => readSectionState(section))
  // The section key changes when the lane switches. Re-read rather than carry:
  // the previous lane's answer belongs to the previous lane.
  const key = useRef(section)
  useEffect(() => {
    if (key.current === section) return
    key.current = section
    setState(readSectionState(section))
  }, [section])

  const set = useCallback((s: SectionState) => {
    setState(s)
    writeSectionState(section, s)
  }, [section])

  // While the effect above has not yet run, `state` still belongs to the old
  // section. Returning the freshly-read value for that one render keeps the
  // pills and the rows agreeing on which lane they are describing.
  const current = key.current === section ? state : (readSectionState(section) ?? EMPTY_SECTION_STATE)
  return [current, set]
}
