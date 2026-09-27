/* The campaign-sheet lines the coordinator assigned to Lanes (COVERAGE.md,
   "Coordinator assignments"):
     LANES #3  Arch company expansion: note arm vs blank arm, 30 days.
     LANES #6  Arch sponsor lane: no follow-up after the first message.
     LANES #10 Rise Company Expansion: brands stopped because a colleague replied.
   Each line reads real rows; a lane the campaign does not carry draws nothing. */
import type { Seat } from '../seats'
import type { Load } from './useRead'

type Arms = Array<{ arm: string; n: number }>

export function armsLine(arms: Arms): string {
  const total = arms.reduce((a, x) => a + x.n, 0)
  if (!total) return 'Company expansion invites, 30 days: none went out.'
  return `Company expansion invites, 30 days: ${arms.map(a => `${a.n} ${a.arm}`).join(', ')}. Games and apps get their note; D2C and unknown go blank on purpose, plus the half of every invite that goes blank.`
}

export function SheetNotes({ seat, lanes, arms, stopped }: {
  seat: Seat; lanes: string[]; arms: Load<Arms>; stopped: Load<number> | null
}) {
  const sponsor = seat === 'arch' && lanes.some(l => l === 'sponsor_team' || l === 'sponsor_mined')
  const expansion = seat === 'arch' && lanes.includes('company_expansion')
  if (!sponsor && !expansion && !stopped) return null
  return (
    <div className="dl-notes">
      {expansion && (
        arms.kind === 'loading' ? <p className="dl-unk">Reading the company expansion invite arms…</p>
          : arms.kind === 'failed' ? <p className="dl-bad">Could not read the company expansion invite arms: {arms.message}</p>
            : <p>{armsLine(arms.data)}</p>
      )}
      {sponsor && <p>No follow-up planned: sponsor lane stops after the first message.</p>}
      {stopped && (
        stopped.kind === 'loading' ? <p className="dl-unk">Reading stopped brands…</p>
          : stopped.kind === 'failed' ? <p className="dl-bad">Could not read stopped brands: {stopped.message}</p>
            : <p>Stopped brands <b>{stopped.data}</b>: a colleague at the brand replied, so nobody else there gets a note.</p>
      )}
    </div>
  )
}
