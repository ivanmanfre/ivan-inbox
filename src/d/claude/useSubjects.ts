import { useEffect, useMemo, useState } from 'react'
import { draftSubject, laneSubject, type DraftLike, type Subject } from '../../exp/v2c/chat/paneContext'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import { supabase } from '../../lib/supabase'
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

const DRAFT_COLS = 'id, client_id, status, type, title, topic, post_body, scheduled_at, updated_at, qa_verdict:qa->>verdict, qa_score:qa->>score'

function laneName(route: DRoute): string {
  const lane = route.query.get('lane')
  if (lane) return LANE_LABEL[lane as ContentLane] ?? lane
  return route.place === 'dms' ? 'all lanes' : 'every seat'
}

export function useSubjects(route: DRoute): Subject[] {
  const handoff = useClaudeHandoff()
  const draftId = route.place === 'content' ? route.query.get('draft') : null
  const [draft, setDraft] = useState<(DraftLike & { client_id?: string | null }) | null>(null)
  useEffect(() => {
    let live = true
    setDraft(null)
    if (!draftId) return
    void supabase.from('carousel_drafts').select(DRAFT_COLS).eq('id', draftId).maybeSingle()
      .then(({ data }) => { if (live) setDraft((data as DraftLike | null) ?? null) }, () => undefined)
    return () => { live = false }
  }, [draftId])

  const page = PLACES[route.place]?.label ?? route.place
  const lane = laneName(route)
  return useMemo(() => {
    const out: Subject[] = []
    if (handoff) out.push(handoff.subject)
    if (draft) {
      const seat = seatOf(draft.client_id)
      out.push(draftSubject(draft, seat ? LANE_LABEL[seat] : lane))
    }
    out.push(laneSubject(page, lane))
    return out
  }, [handoff, draft, page, lane])
}
