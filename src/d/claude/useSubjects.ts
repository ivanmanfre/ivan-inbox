import { useMemo } from 'react'
import { draftSubject, laneSubject, type Subject } from '../../exp/v2c/chat/paneContext'
import { LANE_LABEL, normalizeQa, type ContentLane } from '../../lib/content'
import { useDraftDetail } from '../../hooks/useContent'
import { PLACES } from '../places'
import type { DRoute } from '../route'
import { seatOf } from '../seats'
import { useClaudeHandoff } from '../ui/claudeHandoff'

// What the drawer may attach, today's three kinds (exp/v2c/Shell.tsx seeSubjects):
//  - the page he is on and its lane (`laneSubject`),
//  - the person a page handed over (DMs: `handOffToClaude`, today's `threadSubject`),
//  - the content draft open on the page (`?draft=<id>`), read with today's
//    columns and shaped by today's `draftSubject` (shallow: names and states;
//    the post text only when he switches the chip to full text).
// Nothing here is sent by itself; the drawer's send carries the attached ones.

function laneName(route: DRoute): string {
  const lane = route.query.get('lane')
  if (lane) return LANE_LABEL[lane as ContentLane] ?? lane
  return route.place === 'dms' ? 'all lanes' : 'every seat'
}

export function useSubjects(route: DRoute): Subject[] {
  const handoff = useClaudeHandoff()
  const draftId = route.place === 'content' ? route.query.get('draft') : null
  const { detail, error, missing } = useDraftDetail(draftId)
  const draft = !error && !missing && detail?.id === draftId ? detail : null

  const page = PLACES[route.place]?.label ?? route.place
  const lane = laneName(route)
  return useMemo(() => {
    const out: Subject[] = []
    if (handoff) out.push(handoff.subject)
    if (draft) {
      const seat = seatOf(draft.client_id)
      const qa = normalizeQa(draft.qa)
      out.push(draftSubject({ ...draft, qa_verdict: draft.qa_verdict ?? qa?.verdict, qa_score: draft.qa_score ?? qa?.score }, seat ? LANE_LABEL[seat] : lane))
    }
    out.push(laneSubject(page, lane))
    return out
  }, [handoff, draft, page, lane])
}
