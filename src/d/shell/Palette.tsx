import { useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette, type FindState } from '../../exp/v2c/CommandPalette'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { CROSS_MIN, crossSearch, crossSearchOtherLanes, type CrossHit, type CrossResults, type LaneCount } from '../../lib/crossSearch'
import { CONTENT_LANES, type ContentLane } from '../../lib/content'
import type { IconName } from '../../ds'
import { PLACES, PLACE_ORDER, type PlaceId } from '../places'
import { dHash, hitHash } from '../route'
import { usePageCommands } from './commands'

// ⌘K: TODAY'S COMMAND PALETTE (exp/v2c/CommandPalette + lib/crossSearch),
// mounted with D's own vocabulary. What it does NOT bring along is today's
// global key layer (bare j / k / x / / / ? over the old list DOM): D pages own
// their own keys, and a second listener walking rows it does not know would
// fight them. The palette is opened by ⌘K from the frame, nothing else.
//
// A picked search hit lands on the D place that holds it:
//   conversation -> #exp/d/dms?thread=<prospect>
//   draft        -> #exp/d/content?draft=<id>&lane=<lane>
//   magnet       -> #exp/d/content/magnets?magnet=<id>&lane=<lane>
// and a `d-open` window event carries the hit for a page already on screen.

const EMPTY: CrossResults = {
  hits: [], counts: { dm: 0, draft: 0, magnet: 0 } as CrossResults['counts'], lane: 'ivan', failed: [],
}
const DEBOUNCE = 220

const PLACE_ICON: Record<PlaceId, IconName> = {
  lanes: 'sends', dms: 'dms', content: 'content', ops: 'ops', sales: 'sales', claude: 'ask', settings: 'settings',
}

type Props = {
  onClose: () => void
  navigate: (hash: string) => void
  toggleClaude: () => void
  openBell: () => void
  lane?: ContentLane
}

export function DPalette({ onClose, navigate, toggleClaude, openBell, lane: startLane = 'ivan' }: Props) {
  const page = usePageCommands()
  const [q, setQ] = useState('')
  const [lane, setLane] = useState<ContentLane>(startLane)
  const [res, setRes] = useState<CrossResults>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [elsewhere, setElsewhere] = useState<LaneCount[]>([])
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (term.length < CROSS_MIN) { setRes(EMPTY); setElsewhere([]); setBusy(false); return }
    setBusy(true)
    const mine = ++seq.current
    const t = window.setTimeout(() => {
      void crossSearchOtherLanes(term, lane, CONTENT_LANES).then(c => { if (seq.current === mine) setElsewhere(c) }).catch(() => {})
      void crossSearch(term, lane).then(r => {
        if (seq.current !== mine) return
        setRes(r); setBusy(false)
      }).catch(() => {
        if (seq.current !== mine) return
        setRes({ ...EMPTY, lane, failed: ['anything'] }); setBusy(false)
      })
    }, DEBOUNCE)
    return () => window.clearTimeout(t)
  }, [q, lane])

  const find: FindState = { ...res, lane, q, busy, elsewhere, setLane }

  const cmds = useMemo<WbCommand[]>(() => [
    ...page,
    {
      id: 'claude.toggle', title: 'Ask Claude', group: 'Claude', icon: 'ask', key: '⌘J',
      hint: 'Opens the Claude drawer beside the page. Asking never sends anything.', ready: true, run: toggleClaude,
    },
    {
      id: 'go.alerts', title: 'Open alerts', group: 'Go', icon: 'bell', key: null,
      hint: 'The bell: system alerts, then every notification by day.', ready: true, run: openBell,
    },
    ...PLACE_ORDER.map<WbCommand>(id => ({
      id: `go.${id}`, title: `Go to ${PLACES[id].label}`, group: 'Go', icon: PLACE_ICON[id], key: null,
      hint: `Opens ${PLACES[id].label}.`, ready: true, run: () => navigate(dHash(id)),
    })),
  ], [page, toggleClaude, openBell, navigate])

  const pick = (h: CrossHit) => {
    window.dispatchEvent(new CustomEvent('d-open', { detail: h }))
    navigate(hitHash(h))
  }

  return <CommandPalette cmds={cmds} find={find} onQuery={setQ} onPick={pick} onClose={onClose} />
}
