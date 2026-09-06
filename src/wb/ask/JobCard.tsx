/* ==========================================================================
   src/wb/ask/JobCard.tsx — one runner job, in the Ask thread.

   A turn is a minute of Claude inside the chat container. A JOB is an hour of
   Claude on the runner with the MacBook shut, so the card says the four things
   a turn card never has to: whether it has started, how long it has been going,
   what it is doing right now, and where the thing it wrote ended up.

   It is drawn on the answer card's own skeleton (`.a-brain-answer`'s inline
   rule, the same meta line, the same prose measure) because a job IS an answer
   at a different time scale, and giving it a second visual grammar would make
   the thread read as two apps.

   WHAT IT WILL NOT DO: claim to show the report. The report is a file the
   runner wrote on its own disk; it reaches the Mac on the next sync and the
   card says exactly that in those words, with the path. The sheet behind
   "Open report" carries the full readable log and that path — everything this
   surface actually holds, and nothing it does not.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Button, Chip, Icon, spring } from '../../ds'
import { isOpen, jobTitle, logLines, type RunnerJob, type JobStatus } from './jobs'
import './ask.css'

/** The word on the pill, and the tone it carries. Never the raw enum. */
const STATE: Record<JobStatus, { word: string; tone: 'quiet' | 'accent' | 'clear' | 'urgent' }> = {
  queued: { word: 'Waiting for the runner', tone: 'quiet' },
  running: { word: 'Running', tone: 'accent' },
  done: { word: 'Done', tone: 'clear' },
  error: { word: 'Failed', tone: 'urgent' },
  cancelled: { word: 'Stopped', tone: 'quiet' },
}

/** h:mm:ss for anything past an hour, m:ss under it. A job runs for hours. */
export function elapsedWord(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * How long this job has been going, ticking only while it is.
 *
 * A finished job's elapsed is a FACT (finished_at - started_at) and must stop
 * moving: a card that keeps counting after the work ended is telling him
 * something is still happening.
 */
function useElapsed(job: RunnerJob): string | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (job.status !== 'running') return
    const t = window.setInterval(() => tick(n => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [job.status])
  if (!job.started_at) return null
  const from = new Date(job.started_at).getTime()
  const to = job.finished_at ? new Date(job.finished_at).getTime() : Date.now()
  return elapsedWord(to - from)
}

export function JobCard({ job, focused, onCancel, onOpenReport }: {
  job: RunnerJob
  /** The card a `?job=` deep link named: it is marked and scrolled to. */
  focused?: boolean
  onCancel: (id: string) => void
  onOpenReport: (id: string) => void
}) {
  const state = STATE[job.status]
  const elapsed = useElapsed(job)
  const lines = logLines(job.log, 3)
  const open = isOpen(job.status)
  const [stopping, setStopping] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focused) box.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  return (
    <motion.div
      ref={box}
      className="a-brain-job"
      data-job={job.id}
      data-status={job.status}
      data-focus={focused ? '' : undefined}
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 8 }}
      transition={spring}
    >
      <div className="a-brain-job-head">
        <span className="a-brain-job-t a-nowrap">{jobTitle(job)}</span>
        <Chip tone={state.tone}>{state.word}</Chip>
      </div>

      <div className="a-brain-tmeta">
        <span>{job.kind === 'goal' ? 'goal run' : 'prompt'}</span>
        <span className="a-brain-tdot" aria-hidden />
        <span>on the runner</span>
        {job.ran_on && <><span className="a-brain-tdot" aria-hidden /><span className="a-brain-tmeta-n">{job.ran_on}</span></>}
        {elapsed && <><span className="a-brain-tdot" aria-hidden /><span className="a-brain-tmeta-n">{elapsed}</span></>}
        {typeof job.cost_usd === 'number' && (
          <><span className="a-brain-tdot" aria-hidden /><span>${job.cost_usd.toFixed(2)}</span></>
        )}
      </div>

      {/* The last three readable frames. While it runs this is the only honest
          answer to "what is it doing", and it is rendered as sentences: the raw
          stream-json is a protocol, not a status. */}
      {lines.length > 0 && (
        <div className="a-brain-joblog">
          {lines.map((l, i) => (
            <span className="a-brain-joblog-l" key={`${job.id}:${i}:${l.slice(0, 24)}`} data-last={i === lines.length - 1 ? '' : undefined}>{l}</span>
          ))}
        </div>
      )}

      {job.status === 'queued' && lines.length === 0 && (
        <span className="a-brain-note">Queued. The runner picks the next job up within about fifteen seconds.</span>
      )}

      {job.status === 'error' && job.error_detail && (
        <div className="a-brain-err">
          <Icon name="error" size={16} />
          <span>{job.error_detail.slice(0, 300)}</span>
        </div>
      )}

      {job.status === 'cancelled' && (
        <span className="a-brain-note">You stopped this one. Nothing more is coming.</span>
      )}

      {/* The report is a FILE on the runner. It reaches the Mac on the next
          sync, and saying so with the path is the whole truth this surface
          holds — a link that pretended to open it would be a link to nothing. */}
      {job.report_path && (
        <span className="a-brain-note a-brain-jobpath">
          Report synced to the Mac: <span className="a-mono">{job.report_path}</span>
        </span>
      )}

      <div className="a-wrapline">
        {open && (
          <Button
            // `stop`'s glyph is a filled square, and a square to the left of a
            // word reads as an unchecked box on a row of them. `close` is the
            // same meaning without the false affordance.
            variant="quiet" size="sm" icon="close" busy={stopping}
            onClick={() => { setStopping(true); onCancel(job.id) }}
          >Cancel</Button>
        )}
        {!open && (job.log || job.report_path) && (
          <Button variant="quiet" size="sm" iconEnd="next" onClick={() => onOpenReport(job.id)}>Open report</Button>
        )}
      </div>
    </motion.div>
  )
}
