/* ==========================================================================
   src/exp/v2c/Rail.tsx — the chrome moved, the arithmetic stayed.

   S38 (the desktop rail), S39 (the phone bar and the work segment) are rebuilt
   on `src/ds` in src/wb/chrome/Rail.tsx (goal run inbox-app-revamp-2026-09-05,
   Phase 3 W1). Shell.tsx imports the three components from here, so this file
   is the seam: it re-exports them and keeps the one thing that was never a
   view, `rollup()`.
   ========================================================================== */
import { JOBS, isWorkJob, JOB_LABEL, type Job } from './layout'
import { WORK_LANE_LABEL } from '../../wb/chrome/Rail'

export { Rail, MobileTabs, WorkSegment, WORK_LANE_LABEL } from '../../wb/chrome/Rail'

type Counts = Partial<Record<Job, number>>

// THE GLOBAL ROLL-UP, and the one rule that keeps it honest.
//
// The danger with a single global number is that a reader assumes it covers
// everything, and this one does not: it does not know about the staged client
// ideas, the lm idea candidates at `reviewing`, the comment feed, the send
// queue, or the automation alarm.
//
// So the rule is: THE ROLL-UP IS THE RAIL'S OWN COUNTS, ADDED UP. Nothing else
// may enter it. That makes it self-auditing: every summand is a row on the
// same rail with its own numeral, so the reader can check the arithmetic
// without leaving the screen, and a number that appears in the total but
// nowhere below it is impossible by construction.
export function rollup(counts: Counts): { n: number; note: string } {
  const parts = JOBS
    .map(j => ({ j, n: counts[j] ?? 0 }))
    .filter(p => p.n > 0)
  const n = parts.reduce((s, p) => s + p.n, 0)
  const names = parts
    .map(p => `${isWorkJob(p.j) ? WORK_LANE_LABEL[p.j] : JOB_LABEL[p.j]} ${p.n}`)
    .join(' + ')
  return {
    n,
    note: n === 0
      ? 'Nothing waiting on the rail.'
      : `${names}. This is the rail's counts added up and nothing else: it does not cover ideas, sends, or automation health.`,
  }
}

// THE "117 WAITING ON YOU" ROLL-UP IS GONE FROM THE RAIL. Ivan, on first sight
// of it: "118 waiting on you wtf is that". It was arithmetically honest and
// that was the whole problem: three clients, three kinds of object, one
// numeral, presented as a personal queue. The per-row counts stay, because
// each one names a real, workable list. `rollup()` itself is a pure function
// with tests and the arithmetic is still the right arithmetic if a total is
// ever wanted somewhere it reads as a total; nothing calls it today, and that
// is deliberate rather than an oversight.
