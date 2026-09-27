import { useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette, type FindState } from '../../exp/v2c/CommandPalette'
import type { WbCommand } from '../../exp/v2c/commandSource'
import { CROSS_MIN, crossSearch, crossSearchOtherLanes, type CrossHit, type CrossResults, type LaneCount } from '../../lib/crossSearch'
import { CONTENT_LANES, type ContentLane } from '../../lib/content'
import type { IconName } from '../../ds'
import { PLACES, PLACE_ORDER, type PlaceId } from '../places'
import { dHash, hitHash } from '../route'
import { peopleFromThreads } from '../../exp/v2c/commandVerbs'
import { useDInbox } from '../counts/inbox'
import { usePageCommands } from './commands'
import { layerCommands, openKeySheet, useLayerBulk } from './Layer'

// ⌘K: TODAY'S COMMAND PALETTE (exp/v2c/CommandPalette + lib/crossSearch),
// mounted with D's own vocabulary plus today's command layer (shell/Layer.tsx):
// the Move / Select / Act / Open bands over any old view's rows on screen, the
// shortcut sheet, the People band (every loaded conversation by name, desktop,
// as today), every page's registered commands, and Go to each place and each
// old job that now lives inside one (Magnets, Styles, Strategy, Orbit, Money).
// The search opens on the lane the page is showing.
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

/** One row per id: the first (a page's own) wins. */
function dedupe(cmds: WbCommand[]): WbCommand[] {
  const seen = new Set<string>()
  return cmds.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

const PLACE_ICON: Record<PlaceId, IconName> = {
  lanes: 'sends', dms: 'dms', content: 'content', ops: 'ops', sales: 'sales', claude: 'ask', settings: 'settings',
}

type Props = {
  onClose: () => void
  navigate: (hash: string) => void
  toggleClaude: () => void
  openBell: () => void
  lane?: ContentLane
  desktop?: boolean
}

/** Places inside a place: today's jobs that D keeps under a sub. */
const GO_SUBS: { id: string; title: string; icon: IconName; hash: string }[] = [
  { id: 'go.magnets', title: 'Go to Magnets', icon: 'content', hash: dHash('content', 'magnets') },
  { id: 'go.styles', title: 'Go to Styles', icon: 'content', hash: dHash('content', 'styles') },
  { id: 'go.strategy', title: 'Go to Strategy', icon: 'content', hash: dHash('content', 'strategy') },
  { id: 'go.orbit', title: 'Go to Orbit', icon: 'sales', hash: dHash('sales', 'orbit') },
  { id: 'go.money', title: 'Go to Money', icon: 'settings', hash: dHash('settings', 'money') },
]

/** The lane the page on screen is showing (`?lane=` or `?seat=`), for the search's first lane. */
export function laneOnScreen(hash: string): ContentLane {
  const q = new URLSearchParams(hash.split('?')[1] ?? '')
  const v = q.get('lane') ?? q.get('seat') ?? ''
  return v === 'risedtc' || v === 'rise' ? 'risedtc' : v === 'arch' ? 'arch' : 'ivan'
}

export function DPalette({ onClose, navigate, toggleClaude, openBell, lane: startLane = laneOnScreen(location.hash), desktop = true }: Props) {
  const page = usePageCommands()
  const inbox = useDInbox()
  const runBulk = useLayerBulk()
  // Read once when the palette opens (it mounts on open), as today's layer did.
  const [layer] = useState(() => layerCommands({ page: [], openSheet: openKeySheet, closeTop: () => {}, runBulk }))
  // Live: the inbox may still be landing when the palette opens.
  const people = useMemo(() => (desktop ? peopleFromThreads(inbox.threads) : []), [desktop, inbox.threads])
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

  const cmds = useMemo<WbCommand[]>(() => dedupe([
    ...page,
    ...layer,
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
    ...GO_SUBS.map<WbCommand>(g => ({
      id: g.id, title: g.title, group: 'Go', icon: g.icon, key: null, hint: `Opens ${g.title.slice(6)}.`, ready: true, run: () => navigate(g.hash),
    })),
    {
      id: 'move.sheet', title: 'Keyboard shortcuts', group: 'Move', icon: 'list', key: '?',
      hint: 'Every key the frame and this page answer to.', ready: true, run: openKeySheet,
    },
    ...people.map<WbCommand>(p => ({
      id: `person.${p.id}`, title: `Open ${p.name}`, group: 'People', icon: 'person', key: null,
      hint: p.sub, search: p.search, ready: true, run: () => navigate(dHash('dms', null, { thread: p.id })),
    })),
  ]), [page, layer, people, toggleClaude, openBell, navigate])

  const pick = (h: CrossHit) => {
    window.dispatchEvent(new CustomEvent('d-open', { detail: h }))
    navigate(hitHash(h))
  }

  return <CommandPalette cmds={cmds} find={find} onQuery={setQ} onPick={pick} onClose={onClose} />
}
