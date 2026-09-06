/* ==========================================================================
   src/wb/ask/Runner.tsx — "Run on the runner", and the jobs it produces.

   TWO PIECES, one state.

   `RunnerControl` is a split button on the composer strip, directly under the
   model picker: the left half sends what is in the composer as a PROMPT job,
   the right half opens the goal specs the runner can see on disk and sends one
   as a GOAL job. Whatever model the picker holds rides with either.

   `RunnerSection` is the band at the top of the thread that the jobs land in,
   plus the sheet behind "Open report".

   WHY A BAND AND NOT AN INTERLEAVE. The direction offered both. A job carries
   a `created_at`; a `Turn` in this pane does not — the chat handle keeps turns
   in arrival order with no timestamp on the object at all — so interleaving
   would have meant either threading a clock through `useChat` and the event
   reducer, or sorting jobs against turns by a field that does not exist. The
   band is the smaller diff and the honest one: a job is not part of the
   conversation, it is work running somewhere else that this thread can see.

   THE SPLIT IS A REAL SPLIT, not a menu with a default. A prompt job is the
   thing he will reach for twenty times a day and it must cost one press.
   ========================================================================== */
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, Popover, PopoverItem, Sheet, fadeT, list, rise, spring } from '../../ds'
import {
  RunnerError, dispatchJob, cancelJob, fetchSpecs, jobTitle, logTail,
  useJobDeepLink, useRunnerJobs, type GoalSpec, type RunnerJob,
} from './jobs'
import { JobCard } from './JobCard'
import './ask.css'

/** What a failure of the dispatch door says on the glass. Nothing here names a
 * function, a status code or a container: he is one operator, not an on-call. */
function refusal(e: unknown): string {
  const code = e instanceof RunnerError ? e.code : ''
  switch (code) {
    case 'runner_unreachable':
    case 'runner_not_configured':
      return 'The runner is not answering right now.'
    case 'dispatch_unreachable':
      return 'Could not reach the dispatch. Nothing was queued.'
    case 'not_signed_in':
      return 'Sign in again to run something.'
    case 'model_not_allowed':
      return 'That model is not one the runner takes.'
    case 'input_too_long':
      return 'That is too long to send as one job.'
    default:
      return 'That did not go through. Nothing was queued.'
  }
}

export type RunnerHandle = ReturnType<typeof useRunner>

/**
 * One place the control and the band both read, so a job dispatched by the
 * button is on screen in the band in the same commit.
 */
export function useRunner(model: string | null) {
  const jobs = useRunnerJobs()
  const link = useJobDeepLink()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

  // A notification's url is `./#exp/brain-b/ask?job=<id>&report=1`, so arriving
  // from the phone's lock screen opens the sheet on the job it named.
  useEffect(() => {
    if (link.job && link.report) setReport(link.job)
  }, [link.job, link.report])

  const run = useCallback(async (kind: 'prompt' | 'goal', input: string, cwd?: string | null) => {
    if (!input.trim()) return false
    setBusy(true)
    setNote(null)
    try {
      const { id } = await dispatchJob({ kind, input, cwd: cwd ?? null, model })
      jobs.add(id, kind, input, model, cwd ?? null)
      return true
    } catch (e) {
      setNote(refusal(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [jobs, model])

  const stop = useCallback(async (id: string) => {
    try { await cancelJob(id) } catch (e) { setNote(refusal(e)) }
    void jobs.refresh()
  }, [jobs])

  return {
    ...jobs, run, stop, busy, note, clearNote: () => setNote(null),
    report, openReport: setReport, closeReport: () => setReport(null),
    focus: link.job,
  }
}

// ---------------------------------------------------------------------------
// The control.
// ---------------------------------------------------------------------------

export function RunnerControl({ runner, text, onSent }: {
  runner: RunnerHandle
  /** The composer's text, which is what a prompt job carries. */
  text: string
  onSent: () => void
}) {
  const [open, setOpen] = useState(false)
  const [specs, setSpecs] = useState<GoalSpec[] | null>(null)
  const [specErr, setSpecErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // The list is fetched when the menu opens, never on mount: a pane that asked
  // a cold container for a file listing on every load would pay for a menu
  // nobody opened. `fetchSpecs` caches for a minute, so re-opening is free.
  const openMenu = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setLoading(true)
    setSpecErr(null)
    try {
      setSpecs(await fetchSpecs())
    } catch (e) {
      setSpecs(null)
      setSpecErr(e instanceof RunnerError && e.code === 'runner_not_configured'
        ? 'The runner has no address yet.'
        : 'The runner is not answering, so its specs cannot be listed.')
    } finally {
      setLoading(false)
    }
  }

  const sendPrompt = async () => {
    if (await runner.run('prompt', text)) onSent()
  }

  const sendGoal = async (s: GoalSpec) => {
    setOpen(false)
    await runner.run('goal', s.path, s.cwd ?? null)
  }

  return (
    <div className="a-brain-runner">
      <span className="a-brain-runbtn">
        {/* The default half. Disabled with nothing typed, because a job with no
            input is the one thing the door refuses anyway. */}
        <Button
          variant="outline" size="sm" icon="zap"
          busy={runner.busy}
          disabled={!text.trim()}
          onClick={() => void sendPrompt()}
        >Run on the runner</Button>
        <Button
          variant="outline" size="sm" iconEnd="disclose"
          aria-expanded={open}
          aria-label="Choose a goal spec to run on the runner"
          onClick={() => void openMenu()}
        />
        <Popover open={open} label="Goal specs on the runner" className="a-brain-specmenu">
          {loading && <div className="a-brain-modelnote">Asking the runner what it can see…</div>}
          {!loading && specErr && <div className="a-brain-modelnote">{specErr}</div>}
          {!loading && !specErr && specs && specs.length === 0 && (
            <div className="a-brain-modelnote">The runner sees no goal specs on disk.</div>
          )}
          {!loading && !specErr && specs?.map(s => (
            <PopoverItem
              key={s.path}
              icon="doc"
              onClick={() => void sendGoal(s)}
              tail={s.mtime ? <span className="a-dim a-mono">{s.mtime.slice(0, 10)}</span> : undefined}
            >{s.name || s.path.split('/').pop()}</PopoverItem>
          ))}
          {/* Said once, where the choice is made, rather than discovered by a
              job that runs for an hour on the wrong machine. */}
          <div className="a-brain-modelnote">
            A job runs on the runner, not in this tab. Lock the phone; the
            finish lands in the feed.
          </div>
        </Popover>
      </span>
      {runner.note && (
        <span className="a-brain-runnote">
          <Icon name="alert" size={16} />
          <span>{runner.note}</span>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The band, and the report sheet.
// ---------------------------------------------------------------------------

function ReportSheet({ job, onClose }: { job: RunnerJob | null; onClose: () => void }) {
  const lines = logTail(job?.log ?? null)
  return (
    <Sheet
      open={!!job}
      onClose={onClose}
      title={job ? jobTitle(job) : 'Job'}
      sub={job?.kind === 'goal' ? 'goal run on the runner' : 'prompt on the runner'}
      className="a-brain-reportsheet"
    >
      {job?.report_path && (
        <div className="a-brain-reportpath">
          <span className="a-dim">Report synced to the Mac</span>
          <span className="a-mono">{job.report_path}</span>
        </div>
      )}
      {job?.cwd && (
        <div className="a-brain-reportpath">
          <span className="a-dim">Ran in</span>
          <span className="a-mono">{job.cwd}</span>
        </div>
      )}
      {lines.length > 0
        ? (
          <div className="a-brain-joblog" data-full>
            {lines.map((l, i) => <span className="a-brain-joblog-l" key={i}>{l}</span>)}
          </div>
        )
        : <span className="a-brain-note">This job wrote no log.</span>}
    </Sheet>
  )
}

export function RunnerSection({ runner }: { runner: RunnerHandle }) {
  const [open, setOpen] = useState(true)
  const jobs = runner.jobs
  if (jobs.length === 0) return null
  const live = jobs.filter(j => j.status === 'queued' || j.status === 'running').length
  const shown = runner.report ? jobs.find(j => j.id === runner.report) ?? null : null

  return (
    <section className="a-brain-runlane" data-runner-lane>
      <div className="a-brain-runlane-h">
        <span className="a-brain-runlane-t">Runner</span>
        <span className="a-brain-runlane-n a-mono">
          {live > 0 ? `${live} running` : `${jobs.length} recent`}
        </span>
        <Button
          variant="quiet" size="sm" iconEnd={open ? 'discloseUp' : 'disclose'}
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >{open ? 'Hide' : 'Show'}</Button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a-brain-runlane-b"
            variants={list} initial="hidden" animate="show"
            exit={{ opacity: 0, transition: fadeT }}
            transition={spring}
          >
            {jobs.map(j => (
              <motion.div key={j.id} variants={rise}>
                <JobCard
                  job={j}
                  focused={runner.focus === j.id}
                  onCancel={id => void runner.stop(id)}
                  onOpenReport={id => runner.openReport(id)}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <ReportSheet job={shown} onClose={runner.closeReport} />
    </section>
  )
}
