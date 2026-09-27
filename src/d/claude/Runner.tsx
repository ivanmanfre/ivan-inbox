import { useCallback, useEffect, useState } from 'react'
import {
  RunnerError, cancelJob, dispatchJob, fetchSpecs, isOpen, jobTitle, logLines, logTail, useJobDeepLink, useRunnerJobs,
  type GoalSpec, type JobStatus, type RunnerJob,
} from '../../wb/ask/jobs'
import { Sheet } from '../ui/Sheet'
import { Btn } from '../ui/Key'
import { CIcon } from './icons'

// Runner jobs: today's runner (`inbox-runner-dispatch` for writes, `runner_jobs`
// rows + realtime for reads, wb/ask/jobs.ts), drawn in D. A job runs on the
// Railway runner, not in this tab, and its finish lands in the bell.

const STATE: Record<JobStatus, string> = {
  queued: 'waiting for the runner', running: 'running', done: 'done', error: 'failed', cancelled: 'stopped',
}

/** Today's refusal words (wb/ask/Runner.tsx), unchanged. */
export function refusal(e: unknown): string {
  const code = e instanceof RunnerError ? e.code : ''
  switch (code) {
    case 'runner_unreachable': case 'runner_not_configured': return 'The runner is not answering right now.'
    case 'dispatch_unreachable': return 'Could not reach the dispatch. Nothing was queued.'
    case 'not_signed_in': return 'Sign in again to run something.'
    case 'model_not_allowed': return 'That model is not one the runner takes.'
    case 'input_too_long': return 'That is too long to send as one job.'
    default: return 'That did not go through. Nothing was queued.'
  }
}

export function useDRunner(model: string | null) {
  const jobs = useRunnerJobs()
  const link = useJobDeepLink()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  useEffect(() => { if (link.job && link.report) setReport(link.job) }, [link.job, link.report])
  const { add, refresh } = jobs
  const run = useCallback(async (kind: 'prompt' | 'goal', input: string, cwd?: string | null) => {
    if (!input.trim()) return false
    setBusy(true); setNote(null)
    try {
      const { id } = await dispatchJob({ kind, input, cwd: cwd ?? null, model })
      add(id, kind, input, model, cwd ?? null)
      return true
    } catch (e) { setNote(refusal(e)); return false } finally { setBusy(false) }
  }, [add, model])
  const stop = useCallback(async (id: string) => {
    try { await cancelJob(id) } catch (e) { setNote(refusal(e)) }
    void refresh()
  }, [refresh])
  return { ...jobs, run, stop, busy, note, clearNote: () => setNote(null), report, setReport, focus: link.job }
}
export type DRunner = ReturnType<typeof useDRunner>

function elapsed(j: RunnerJob, now: number): string | null {
  if (!j.started_at) return null
  const s = Math.max(0, Math.floor(((j.finished_at ? Date.parse(j.finished_at) : now) - Date.parse(j.started_at)) / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** The jobs that matter now: every open one, plus the newest finished ones. */
export function visibleJobs(jobs: RunnerJob[], n = 3): RunnerJob[] {
  const open = jobs.filter(j => isOpen(j.status))
  const shut = jobs.filter(j => !isOpen(j.status)).slice(-Math.max(0, n - open.length))
  return [...shut, ...open]
}

/** The band's count: running and waiting are different facts (today's RunnerSection rule). */
export function runnerCount(jobs: RunnerJob[]): string {
  const running = jobs.filter(j => j.status === 'running').length
  const queued = jobs.filter(j => j.status === 'queued').length
  return running > 0 ? `${running} running` : queued > 0 ? `${queued} waiting` : `${jobs.length} recent`
}

export function RunnerJobs({ runner }: { runner: DRunner }) {
  const [now, setNow] = useState(() => Date.now())
  const anyOpen = runner.jobs.some(j => isOpen(j.status))
  const [shown, setShown] = useState<boolean | null>(null)
  const running = runner.jobs.some(j => j.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])
  const open = shown ?? (anyOpen || !!runner.focus)
  const jobs = visibleJobs(runner.jobs)
  const reportJob = runner.jobs.find(j => j.id === runner.report) ?? null
  if (runner.jobs.length === 0 && !runner.note) return null
  return (
    <div className="dcl-jobs" data-runner>
      {runner.note && <div className="dcl-fail"><span>{runner.note}</span><Btn onClick={runner.clearNote}>Dismiss</Btn></div>}
      {runner.jobs.length > 0 && (
        <button type="button" className="dcl-jobs-h" aria-expanded={open} onClick={() => setShown(!open)}>
          <b>Runner</b><span>{runnerCount(runner.jobs)}</span><em>{open ? 'Hide' : 'Show'}</em>
        </button>
      )}
      {open && jobs.map(j => {
        const line = isOpen(j.status) ? logLines(j.log, 1)[0] : null
        const el = elapsed(j, now)
        return (
          <div key={j.id} className={`dcl-job dcl-job-${j.status}${runner.focus === j.id ? ' dcl-focus' : ''}`} data-job={j.id}>
            <div className="dcl-job-h">
              <b>{jobTitle(j)}</b>
              <span>{STATE[j.status]}{el ? ` · ${el}` : ''}{typeof j.cost_usd === 'number' ? ` · $${j.cost_usd.toFixed(2)}` : ''}</span>
              {(j.log || j.report_path) && <button type="button" className="dcl-link" onClick={() => runner.setReport(j.id)}>Log</button>}
              {isOpen(j.status) && <button type="button" className="dcl-link" data-verb="stop-job" onClick={() => void runner.stop(j.id)}>Stop</button>}
            </div>
            {line && <div className="dcl-job-l">{line}</div>}
          </div>
        )
      })}
      <Sheet open={!!reportJob} onClose={() => runner.setReport(null)} title={reportJob ? jobTitle(reportJob) : 'Runner'} sub={reportJob ? STATE[reportJob.status] : undefined}>
        <pre className="dcl-log">{reportJob ? (logTail(reportJob.log).join('\n') || 'Nothing written yet.') : ''}</pre>
        {reportJob?.report_path && <p className="dcl-dim">Report: {reportJob.report_path}</p>}
      </Sheet>
    </div>
  )
}

/** The runner key in the composer row: run what is typed, or a goal spec off disk. */
export function RunnerMenu({ runner, text, onSent, disabled }: { runner: DRunner; text: string; onSent: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [specs, setSpecs] = useState<GoalSpec[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    setErr(null)
    fetchSpecs().then(s => { if (live) setSpecs(s) }, e => {
      if (live) setErr(e instanceof RunnerError && e.code === 'runner_not_configured' ? 'The runner has no address yet.' : 'The runner is not answering, so its specs cannot be listed.')
    })
    return () => { live = false }
  }, [open])
  const go = (kind: 'prompt' | 'goal', input: string, cwd?: string | null) => {
    setOpen(false)
    void runner.run(kind, input, cwd).then(ok => { if (ok && kind === 'prompt') onSent() })
  }
  return (
    <span className="dcl-menuw">
      <button type="button" className="dcl-ib" aria-expanded={open} aria-label="Run on the runner" title="Run on the runner" disabled={disabled} onClick={() => setOpen(o => !o)}><CIcon name="run" /></button>
      {open && (
        <div className="dcl-menu" role="menu">
          <button type="button" role="menuitem" data-verb="run-job" disabled={!text.trim() || runner.busy} onClick={() => go('prompt', text)}>
            Run what is typed on the runner
          </button>
          {!specs && !err && <div className="dcl-dim">Asking the runner what it can see…</div>}
          {err && <div className="dcl-dim">{err}</div>}
          {specs && specs.length === 0 && <div className="dcl-dim">The runner sees no goal specs on disk.</div>}
          {specs?.map(s => (
            <button type="button" role="menuitem" key={s.path} data-verb="run-goal" onClick={() => go('goal', s.path, s.cwd ?? null)}>
              {s.name || s.path.split('/').pop()}{s.mtime ? <small>{s.mtime.slice(0, 10)}</small> : null}
            </button>
          ))}
          <div className="dcl-dim">A job runs on the runner, not in this tab. Its finish lands in the bell.</div>
        </div>
      )}
    </span>
  )
}
