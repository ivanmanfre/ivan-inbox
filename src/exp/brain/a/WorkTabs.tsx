// WorkTabs.tsx — the segmented control at the top of the Work place, picking
// between the three jobs this candidate folds under "Work": Content, Lanes
// (job key `sends`), Ops. This is NOT the same group as v2c's WORK_JOBS
// (content/magnets/styles/strategy, the two content lanes) — that group's own
// segmented control (Rail.tsx's WorkSegment) still renders INSIDE the Content
// surface when `job === 'content'`, unmodified. This control only decides
// which of the three top-level jobs is showing.
import { JOB_LABEL, type Job } from '../../v2c/layout'

export const WORK_PLACE_JOBS: Job[] = ['content', 'sends', 'ops']
const MEMBERS = WORK_PLACE_JOBS

export function WorkTabs({ job, counts, sev, onJob }: {
  job: Job
  counts: Partial<Record<Job, number>>
  sev: Partial<Record<Job, 'attention' | 'urgent'>>
  onJob: (j: Job) => void
}) {
  return (
    <div className="ba-worktabs">
      {MEMBERS.map(j => (
        <button
          key={j} type="button"
          className={`ba-wt${job === j ? ' on' : ''}`}
          aria-current={job === j ? 'page' : undefined}
          onClick={() => onJob(j)}
        >
          {JOB_LABEL[j]}
          {(counts[j] ?? 0) > 0 && <b className={sev[j] ? sev[j] : undefined}>{counts[j]}</b>}
        </button>
      ))}
    </div>
  )
}
