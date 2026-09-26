import { useCallback, useEffect, useState } from 'react'
import { fetchVerdict, verdictParts, LOW_COVER_DAYS, type Verdict } from '../../lib/contentVerdict'
import type { ContentLane } from '../../lib/content'

// ---------------------------------------------------------------------------
// THE VERDICT LINE on top of Posts (rebuild, blueprint v3, NEW).
//
// "Nothing of yours is scheduled until Oct 7. Rise has 33 days on the board,
// to Nov 13. Arch has 2 days on the board, to Oct 1. One post has been blocked
// by the lint since Sep 8." Every lane at once, whichever lane is open: the
// answer to "is anything about to run dry" should not need three taps.
//
// It sits at the top of the list and scrolls away with it, so it costs the
// phone no fixed chrome. A client part opens that lane; the blocked part opens
// your Errors tab, where the stopped post is listed with its reason.
// ---------------------------------------------------------------------------

// The last answer, kept across the lane switch (each lane mounts its own
// list), so switching lanes repaints the line at once and re-reads quietly.
let last: Verdict | null = null

function useVerdict() {
  const [v, setV] = useState<Verdict | null>(last)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    fetchVerdict().then(r => { last = r; setV(r); setErr(null) }, e => setErr(String(e?.message ?? e)))
  }, [])
  useEffect(() => {
    load()
    const on = () => load()
    window.addEventListener('wb-rows-changed', on)
    const t = window.setInterval(load, 5 * 60_000)
    return () => { window.removeEventListener('wb-rows-changed', on); window.clearInterval(t) }
  }, [load])
  return { v, err, load }
}

export function VerdictLine({ lane, setLane, laneCounts }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  laneCounts?: Partial<Record<ContentLane, number>>
}) {
  const { v, err, load } = useVerdict()
  if (err && !v) {
    return (
      <p className="wb-ct-verdict" data-state="failed">
        <span className="a-sev-urgent">Couldn’t read the schedule. </span>
        <button type="button" className="wb-ct-vpart" onClick={load}>Try again</button>
      </p>
    )
  }
  if (!v) return <p className="wb-ct-verdict a-dim" data-state="loading">Reading the schedule…</p>
  const waiting = laneCounts
    ? Object.values(laneCounts).reduce<number>((a, n) => a + (n ?? 0), 0)
    : undefined
  const parts = verdictParts(v, waiting)
  const go = (l: ContentLane, errors?: boolean) => {
    if (errors) {
      // The Ivan lane reads its stored tab when it mounts, so a jump from a
      // client lane lands on Errors too; the event covers the mounted case.
      try { localStorage.setItem('wb-content-tab-ivan', 'error') } catch { /* private mode */ }
      window.dispatchEvent(new Event('wb-open-content-errors'))
    }
    if (l !== lane) setLane(l)
  }
  return (
    <p className="wb-ct-verdict" data-state="ready"
      title={`A board turns red with fewer than ${LOW_COVER_DAYS} days scheduled. Dates are read the way each publisher reads them.`}>
      {parts.map(p => {
        const tappable = p.lane && (p.errors || p.lane !== lane)
        const cls = `wb-ct-vpart${p.tone === 'urgent' ? ' a-sev-urgent' : ''}`
        return tappable
          ? <button key={p.key} type="button" className={cls} data-part={p.key} onClick={() => go(p.lane!, p.errors)}>{p.text}</button>
          : <span key={p.key} className={cls} data-part={p.key}>{p.text}</span>
      }).flatMap((el, i) => (i === 0 ? [el] : [' ', el]))}
    </p>
  )
}
