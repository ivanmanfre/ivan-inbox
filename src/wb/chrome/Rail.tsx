/* ==========================================================================
   src/wb/chrome/Rail.tsx: S38 the desktop rail, S39 the phone bar and the
   work segment, on the design system.

   THE MODEL IS UNCHANGED and that is the point. Ten jobs, the two content
   lanes plus Styles and Strategy nested under one group label, Claude below a
   separator because it is a peer and not a job, the automation alarm kept out
   of every count because it is not work anyone can do, and the sync line in
   the footer. Every prop, every handler and every rule the old file argued for
   in its comments survives here; what it stops doing is drawing itself.

   What the system buys:
     · the counts are `Badge`, so a backlog and a problem are one component
       with a tone rather than two class names that drifted apart,
     · the collapsed rail's presence pip is the same Badge decision expressed
       by `collapsed`, not a second element with its own severity classes,
     · the active marker is one `layoutId` that SLIDES between rows instead of
       a background that pops on the row you land on,
     · the ten glyphs are lucide marks (ds/icons.tsx), so the rail loses its
       last unicode: the old file drew ☼ ◉ ▤ ▦ ▧ ◎ ⇅ ▣ ◈ ⚙︎ ✳ ⚠ « » ↻.

   The 44px phone floor lives on `.ds-tab` in the system, so the bar cannot
   fall under it by editing this file.
   ========================================================================== */
import { useEffect, useRef } from 'react'
import {
  Avatar, Badge, Icon, IconButton, LiveDot, Rail as DsRail, RailGroup, RailItem,
  RailSeparator, TabBar, type IconName, type TabItem,
} from '../../ds'
import { JOBS, JOB_LABEL, WORK_JOBS, isWorkJob, type Job } from '../../exp/v2c/layout'
import { relAge } from '../../exp/v2c/Surface'
import './chrome.css'

type Counts = Partial<Record<Job, number>>
type Sev = Partial<Record<Job, 'attention' | 'urgent'>>

// The group's four members, and the label each one wears inside the group. The
// rail, the phone bar and the segment all read this one map.
export const WORK_LANE_LABEL: Record<string, string> = {
  content: 'Content', magnets: 'Magnets', styles: 'Styles', strategy: 'Strategy',
}

// The lucide mark per job (SYSTEM.md's icon map). One name per job, the same
// name the phone bar reads, so the two canvases cannot disagree about what a
// job looks like.
const JOB_MARK: Record<Job, IconName> = {
  today: 'today', dms: 'dms', content: 'content', magnets: 'magnets',
  styles: 'styles', strategy: 'strategy', sends: 'sends', money: 'money',
  ops: 'ops', settings: 'settings',
}

export function labelFor(j: Job): string {
  return isWorkJob(j) ? WORK_LANE_LABEL[j] : JOB_LABEL[j]
}

// --------------------------------------------------------------------------
// S39-8/9 · the work segment: the group's members as a scrolling row of pills,
// rendered inside the Content surface on both canvases.
// --------------------------------------------------------------------------
export function WorkSegment({ job, counts, onJob }: {
  job: Job
  counts: Counts
  onJob: (j: Job) => void
}) {
  // The strip scrolls rather than shrinking: four members already overflow
  // 390px. Scrolling only helps if the ACTIVE pill is the one on screen, which
  // is what this does on every job change.
  const segRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = segRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [job])

  if (!isWorkJob(job)) return null
  return (
    <div className="a-worksep">
      <span className="a-worksep-l ds-t-eyebrow">Content</span>
      <div className="a-worksep-seg" ref={segRef} role="tablist" aria-label="Content lanes">
        {WORK_JOBS.map(j => {
          const n = counts[j] ?? 0
          const on = job === j
          return (
            <button
              key={j} type="button" role="tab" className="a-worksep-pill"
              data-active={on} aria-selected={on}
              onClick={() => onJob(j)}
            >
              {WORK_LANE_LABEL[j]}
              {n > 0 ? <Badge tone="neutral" label={`${n} in ${WORK_LANE_LABEL[j]}`}>{n}</Badge> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// S38 · the desktop rail.
// --------------------------------------------------------------------------
export function Rail({
  job, counts, countNote, health, sev, chatOn, chatLive, onJob, onChat,
  loadedAt, stale, onRefresh, collapsed = false, onToggle,
}: {
  job: Job
  counts: Counts
  // The automation alarm. Kept OUT of `counts` on purpose: everything in that
  // map is work Ivan can do, and a stopped workflow is not. It is a separate
  // signal in a separate place.
  health?: { n: number; note: string }
  // What each count SUMS, in one sentence, on the row itself. A number whose
  // predicate is unstated is a number a reader has to trust blindly.
  countNote?: Partial<Record<Job, string>>
  // A count that is a PROBLEM rather than a workload takes a severity tone; a
  // plain backlog never does.
  sev: Sev
  chatOn: boolean
  chatLive: boolean
  onJob: (j: Job) => void
  onChat: () => void
  loadedAt: string | null
  stale: boolean
  onRefresh: () => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  const row = (j: Job, nested = false) => (
    <RailItem
      key={j}
      icon={JOB_MARK[j]}
      label={labelFor(j)}
      active={job === j}
      nested={nested}
      count={counts[j] ?? 0}
      sev={sev[j]}
      countNote={(counts[j] ?? 0) > 0 ? countNote?.[j] : undefined}
      collapsed={collapsed}
      markerId="a-rail-active"
      onClick={() => onJob(j)}
    />
  )

  const before = JOBS.filter(j => j !== 'settings' && !isWorkJob(j) && j !== 'sends' && j !== 'ops')
  const after = JOBS.filter(j => j === 'sends' || j === 'ops')

  return (
    <DsRail
      collapsed={collapsed}
      className="a-rail"
      top={
        <>
          {/* The word "Workbench" sat here until 2026-08-22. Ivan: "why does it
              says workbench delete that". He is the only person who will ever
              open this app. */}
          {!collapsed ? <Avatar name="Ivan Manfredi" initials="IM" size="sm" tint={1} /> : null}
          {onToggle ? (
            <IconButton
              icon={collapsed ? 'expand' : 'collapse'}
              label={collapsed ? 'Expand the rail' : 'Collapse the rail'}
              size="sm"
              onClick={onToggle}
            />
          ) : null}
        </>
      }
      footer={
        <div className="a-rail-foot">
          {/* AUTOMATION HEALTH, in the frame rather than in any roll-up. It
              answers the same question the sync line answers, which is whether
              the machine is still running. Renders nothing when nothing is
              wrong; the click goes to Ops, where the list lives. */}
          {health && health.n > 0 ? (
            <RailItem
              icon="guard" label="Workflows" count={health.n} sev="attention"
              countNote={health.note} collapsed={collapsed}
              markerId="a-rail-active" onClick={() => onJob('ops')}
            />
          ) : null}
          {row('settings')}
          <button
            type="button" className="a-rail-sync" onClick={onRefresh}
            title={stale ? 'The last read failed or went stale. Read again.' : 'Read again'}
          >
            <span className="a-rail-sync-dot" data-bad={stale || undefined} aria-hidden />
            {!collapsed ? (
              <span className="a-rail-sync-t a-mono">{loadedAt ? relAge(loadedAt) : 'not loaded'}</span>
            ) : null}
            <Icon name="refresh" size={16} />
          </button>
        </div>
      }
    >
      <div className="a-rail-jobs">
        {before.map(j => row(j))}
        {/* The group is a LABEL, not a collapsed drawer: every lane is still
            one click away, and the rail states the same grouping the phone bar
            and the segment state. */}
        <RailGroup label="Content" collapsed={collapsed}>
          {WORK_JOBS.map(j => row(j, true))}
        </RailGroup>
        {after.map(j => row(j))}
      </div>

      {/* Claude is below the rule and shaped differently because it is not a
          job. Picking a job changes the working column; picking Claude docks a
          PEER beside whatever is already there. */}
      <RailSeparator />
      <RailItem
        icon="ask" label="Claude" active={chatOn} collapsed={collapsed}
        markerId="a-rail-active" onClick={onChat}
        tail={chatLive ? <LiveDot label="Claude is working" /> : undefined}
      />
      {!collapsed ? (
        <div className="a-rail-hint ds-t-meta">
          {chatOn ? 'Docked beside your work' : 'Dock it beside your work'}
        </div>
      ) : null}
    </DsRail>
  )
}

// --------------------------------------------------------------------------
// S39 · the phone bar. Six slots, spent deliberately: Settings leaves (the one
// unambiguously non-daily job), Claude takes a real slot because a conversation
// you have to hunt for is one you stop having, and the four content lanes SHARE
// one slot, setting the same `job` state the rail sets. One state, one model,
// two renderings; never a second router nested inside a tab.
// --------------------------------------------------------------------------
const MOBILE: Job[] = ['today', 'dms', 'content', 'sends', 'ops']

export function MobileTabs({ job, counts, sev, chatLive, onJob, onChat }: {
  job: Job
  counts: Counts
  // The same severity map the rail reads. Without it the bar painted EVERY
  // count red, and 19 posts to review is a workload, not an alarm.
  sev: Sev
  chatLive: boolean
  onJob: (j: Job) => void
  onChat: () => void
}) {
  // The Content slot's badge sums every group member that carries a count, so
  // a lane joining the group never needs this line edited again.
  const workCount = WORK_JOBS.reduce((s, j) => s + (counts[j] ?? 0), 0)
  const workSev: 'attention' | 'urgent' | undefined =
    WORK_JOBS.map(j => sev[j]).find(Boolean) ?? undefined

  const items: TabItem[] = [
    ...MOBILE.map<TabItem>(j => j === 'content'
      ? { id: 'content', icon: JOB_MARK.content, label: 'Content', count: workCount, sev: workSev }
      : { id: j, icon: JOB_MARK[j], label: JOB_LABEL[j], count: counts[j] ?? 0, sev: sev[j] }),
    { id: 'chat', icon: 'ask', label: 'Claude' },
  ]
  const active = isWorkJob(job) ? 'content' : MOBILE.includes(job) ? job : ''

  return (
    <div className="a-tabs" data-live={chatLive || undefined}>
      <TabBar
        items={items}
        active={active}
        markerId="a-tabs-active"
        onSelect={id => { if (id === 'chat') onChat(); else onJob(id as Job) }}
      />
    </div>
  )
}
