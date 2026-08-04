import { JOBS, JOB_ICON, JOB_LABEL, WORK_JOBS, isWorkJob, type Job } from './layout'
import { relAge } from './Surface'

// One model, both viewports (the IA seat's must-fix).
//
// The tournament build taught two incompatible things: the desktop rail gave
// Content a full peer row beside Drafts, while the phone folded both into one
// "Work" tab with a segmented control inside the surface. Two viewports, two
// answers to "what is Content" — a rail row on one, half a tab on the other.
//
// Resolved in favour of the grouping, because that is the model the phone's six
// slots can actually hold. This strip is that model, rendered identically on
// both canvases directly above the working surface, and the desktop rail shows
// the same rows nested under one label so the rail agrees with it instead of
// contradicting it.
//
// 2026-08-03: the group's members changed. Inbox was absorbed into DMs, which
// freed a mobile slot, so DMs left the group and became a destination on both
// canvases. What remains grouped is what the label always described — the two
// CONTENT lanes, posts and lead magnets.
export const WORK_LANE_LABEL: Record<string, string> = { content: 'Content', magnets: 'Magnets', styles: 'Styles' }

export function WorkSegment({ job, counts, onJob }: {
  job: Job
  counts: Counts
  onJob: (j: Job) => void
}) {
  if (!isWorkJob(job)) return null
  return (
    <div className="wb-workhead">
      <span className="wb-workhead-l">Content</span>
      <div className="wb-workseg">
        {WORK_JOBS.map(j => (
          <span key={j} className={`wb-ws${job === j ? ' on' : ''}`} onClick={() => onJob(j)}>
            {WORK_LANE_LABEL[j]}
            {(counts[j] ?? 0) > 0 && <b>{counts[j]}</b>}
          </span>
        ))}
      </div>
    </div>
  )
}

// The desktop rail — what replaces the bottom tab bar above 1000px.
//
// A bottom bar has six fixed slots and no room to grow (TabBar.tsx renders
// exactly six, no overflow, no scroll), which is why every previous candidate's
// answer to "one more surface" was to spend an existing slot. A vertical rail is
// not slot-limited: seven jobs plus Claude fit without crowding, Content gets to
// be its own destination instead of a segment, and each row has width for a
// LABEL, a COUNT and a state — none of which fit in an 86px icon column.
//
// The rail also carries the two things the app has nowhere else to put: how fresh
// the data is, and whether Claude is docked. Those belong to the whole workbench,
// not to any one job, so they belong to the frame.

type Counts = Partial<Record<Job, number>>

export function Rail({ job, counts, sev, chatOn, chatLive, onJob, onChat, loadedAt, stale, onRefresh, collapsed, onToggle }: {
  job: Job
  counts: Counts
  // A count that is a PROBLEM rather than a workload (errored content, a stuck
  // schedule) takes the amber tier; a plain backlog never does. The audit's
  // point 8: amber must mean warning, not "not done yet".
  sev: Partial<Record<Job, 'attention' | 'urgent'>>
  chatOn: boolean
  chatLive: boolean
  onJob: (j: Job) => void
  onChat: () => void
  loadedAt: string | null
  stale: boolean
  onRefresh: () => void
  // Ivan, 2026-08-04: "make the navigator bar on the left collapsible". State
  // lives in Shell (persisted), so both Rail mounts agree.
  collapsed?: boolean
  onToggle?: () => void
}) {
  const row = (j: Job) => {
    const n = counts[j] ?? 0
    const s = sev[j]
    return (
      <div
        key={j}
        className={`wb-rj${job === j ? ' on' : ''}${isWorkJob(j) ? ' wb-rj-lane' : ''}`}
        onClick={() => onJob(j)}
      >
        <span className="wb-rj-ic">{JOB_ICON[j]}</span>
        <span className="wb-rj-l">{isWorkJob(j) ? WORK_LANE_LABEL[j] : JOB_LABEL[j]}</span>
        {n > 0 && <span className={`wb-rj-n${s ? ` ${s}` : ''}`}>{n}</span>}
      </div>
    )
  }

  // Rail order with the two work lanes nested under one label, so the rail states
  // the same grouping the WorkSegment and the phone's bottom bar state. Content is
  // still one click away — the group is a label, not a collapsed drawer.
  const before = JOBS.filter(j => j !== 'settings' && !isWorkJob(j) && j !== 'sends' && j !== 'ops')
  const after = JOBS.filter(j => j === 'sends' || j === 'ops')

  return (
    <nav className={`wb-rail${collapsed ? ' min' : ''}`}>
      <div className="wb-rail-top">
        {!collapsed && <span className="avatar-me">IM</span>}
        {!collapsed && <span className="wb-rail-ttl">Workbench</span>}
        {onToggle && (
          <button
            type="button" className="wb-rail-minbtn"
            title={collapsed ? 'Expand the rail' : 'Collapse the rail'}
            aria-label={collapsed ? 'Expand the rail' : 'Collapse the rail'}
            onClick={onToggle}
          >{collapsed ? '»' : '«'}</button>
        )}
      </div>

      <div className="wb-rail-jobs">
        {before.map(row)}
        <div className={`wb-rail-grp${isWorkJob(job) ? ' on' : ''}`}>
          <div className="wb-rail-grp-l">Content</div>
          {WORK_JOBS.map(row)}
        </div>
        {after.map(row)}
      </div>

      {/* Claude is deliberately below the rule and shaped differently: it is not
          a job. Picking a job changes what the working column shows; picking
          Claude docks a PEER beside whatever is already there. Making it look
          like a seventh tab would be the lie the IA audit warned about. */}
      <div className="wb-rail-sep" />
      <div className={`wb-rj wb-rj-peer${chatOn ? ' on' : ''}`} onClick={onChat}>
        <span className="wb-rj-ic">✳</span>
        <span className="wb-rj-l">Claude</span>
        <span className={`wb-peer-dot${chatOn ? ' on' : ''}${chatLive ? ' live' : ''}`} />
      </div>
      <div className="wb-rail-hint">
        {chatOn ? 'Docked beside your work' : 'Dock it beside your work'}
      </div>

      <div className="wb-rail-foot">
        {JOBS.filter(j => j === 'settings').map(row)}
        <div className="wb-rail-sync" onClick={onRefresh}>
          {/* `.bad`, never `.stale`: `.stale` is a SHARED class (styles.css:266, the
              "you already replied" card) whose padding, border and font-size leak
              into this 7px dot and inflate it into a blob — the workbench's own CSS
              comment warns about exactly this and the markup was still doing it.
              Caught in crops/state-failed-ops-desktop.png, where the dot rendered
              ~26px AND stayed green while the sync had failed. */}
          <span className={`wb-sync-dot${stale ? ' bad' : ''}`} />
          <span className="wb-sync-t">{loadedAt ? relAge(loadedAt) : 'not loaded'}</span>
          <span className="wb-sync-r">↻</span>
        </div>
      </div>
    </nav>
  )
}

// The mobile bottom bar. Six slots, spent deliberately: Settings leaves (it is
// the one unambiguously non-daily job, and the audit's own recommendation is to
// cut it first), Claude takes a real slot because a conversation you have to
// hunt for is one you stop having, and Content+Magnets SHARE one slot — the same
// grouping the rail shows and the same WorkSegment inside the surface, setting
// the same `job` state. One state, one model, two renderings; never a second
// router nested inside a tab.
//
// The Inbox slot is gone (its rows now live in DMs), and DMs took its place
// rather than staying a segment inside another tab: it is the surface that
// carries the badge, so it cannot be two taps deep.
const MOBILE: { job: Job; icon: string; label: string }[] = [
  { job: 'today', icon: JOB_ICON.today, label: 'Today' },
  { job: 'dms', icon: JOB_ICON.dms, label: 'DMs' },
  { job: 'content', icon: JOB_ICON.content, label: 'Content' },
  { job: 'sends', icon: JOB_ICON.sends, label: 'Sends' },
  { job: 'ops', icon: JOB_ICON.ops, label: 'Ops' },
]

export function MobileTabs({ job, counts, sev, chatLive, onJob, onChat }: {
  job: Job
  counts: Counts
  // Same severity map the rail reads. Without it the bar painted EVERY count
  // red — 19 posts to review is a workload, not an alarm — which is the exact
  // amber-vs-pending rule the rail comments already state and the bar ignored.
  sev: Partial<Record<Job, 'attention' | 'urgent'>>
  chatLive: boolean
  onJob: (j: Job) => void
  onChat: () => void
}) {
  // The Work slot's badge sums every WORK_JOBS member that carries a count, so
  // a job joining the group never needs this line edited again.
  const workCount = WORK_JOBS.reduce((s, j) => s + (counts[j] ?? 0), 0)
  return (
    <div className="tabbar">
      {MOBILE.map(t => {
        const active = t.job === 'content' ? isWorkJob(job) : job === t.job
        const n = t.job === 'content' ? workCount : counts[t.job] ?? 0
        return (
          <div key={t.job} className={`tb ${active ? 'on' : ''}`} onClick={() => onJob(t.job)}>
            <div className="ic bubble">
              {t.icon}
              {/* Red is for a PROBLEM (a failed fetch, a stuck lane). A backlog
                  is a workload and takes the neutral pill — the audit's
                  amber-vs-pending point, applied to the badge. */}
              {n > 0 && <span className={`cnt${sev[t.job] ? '' : ' neutral'}`}>{n}</span>}
            </div>
            <div className="l">{t.label}</div>
          </div>
        )
      })}
      <div className="tb" onClick={onChat}>
        <div className="ic bubble">✳{chatLive && <span className="wb-tb-live" />}</div>
        <div className="l">Claude</div>
      </div>
    </div>
  )
}
