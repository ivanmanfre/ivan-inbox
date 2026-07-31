import { JOBS, JOB_ICON, JOB_LABEL, type Job } from './layout'
import { relAge } from './Surface'

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

export function Rail({ job, counts, sev, chatOn, chatLive, onJob, onChat, loadedAt, stale, onRefresh }: {
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
}) {
  const row = (j: Job) => {
    const n = counts[j] ?? 0
    const s = sev[j]
    return (
      <div
        key={j}
        className={`wb-rj${job === j ? ' on' : ''}`}
        onClick={() => onJob(j)}
      >
        <span className="wb-rj-ic">{JOB_ICON[j]}</span>
        <span className="wb-rj-l">{JOB_LABEL[j]}</span>
        {n > 0 && <span className={`wb-rj-n${s ? ` ${s}` : ''}`}>{n}</span>}
      </div>
    )
  }

  return (
    <nav className="wb-rail">
      <div className="wb-rail-top">
        <span className="avatar-me">IM</span>
        <span className="wb-rail-ttl">Workbench</span>
      </div>

      <div className="wb-rail-jobs">
        {JOBS.filter(j => j !== 'settings').map(row)}
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
          <span className={`wb-sync-dot${stale ? ' stale' : ''}`} />
          <span className="wb-sync-t">{loadedAt ? relAge(loadedAt) : 'not loaded'}</span>
          <span className="wb-sync-r">↻</span>
        </div>
      </div>
    </nav>
  )
}

// The mobile bottom bar. Six slots, same as today's, but spent differently:
// Settings leaves (it is the one unambiguously non-daily job, and the audit's own
// recommendation is to cut it first), Claude takes a real slot because a
// conversation you have to hunt for is one you stop having, and Drafts+Content
// SHARE one slot — the segmented control inside the Work surface sets the same
// `job` state the desktop rail sets, so there is one state with two renderings
// rather than a second router nested inside a tab.
const MOBILE: { job: Job; icon: string; label: string }[] = [
  { job: 'today', icon: JOB_ICON.today, label: 'Today' },
  { job: 'inbox', icon: JOB_ICON.inbox, label: 'Inbox' },
  { job: 'drafts', icon: '✦', label: 'Work' },
  { job: 'sends', icon: JOB_ICON.sends, label: 'Sends' },
  { job: 'ops', icon: JOB_ICON.ops, label: 'Ops' },
]

export function MobileTabs({ job, counts, chatLive, onJob, onChat }: {
  job: Job
  counts: Counts
  chatLive: boolean
  onJob: (j: Job) => void
  onChat: () => void
}) {
  const workCount = (counts.drafts ?? 0) + (counts.content ?? 0)
  return (
    <div className="tabbar">
      {MOBILE.map(t => {
        const active = t.job === 'drafts' ? job === 'drafts' || job === 'content' : job === t.job
        const n = t.job === 'drafts' ? workCount : counts[t.job] ?? 0
        return (
          <div key={t.job} className={`tb ${active ? 'on' : ''}`} onClick={() => onJob(t.job)}>
            <div className="ic bubble">
              {t.icon}
              {/* Red is for what is waiting on Ivan. An unread count is a
                  workload, not a warning — the audit's amber-vs-pending point,
                  applied to the badge. */}
              {n > 0 && <span className={`cnt${t.job === 'inbox' ? ' neutral' : ''}`}>{n}</span>}
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
