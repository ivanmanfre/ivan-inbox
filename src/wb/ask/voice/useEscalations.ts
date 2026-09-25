// useEscalations: the queue between the voice model's tool call and the chat.
//
//   escalate_to_workbench(task)  ->  enqueue(task)
//   chat idle                    ->  send(task)   (a normal user turn in the thread)
//   answer settles in `turns`    ->  feed(resultToSpeak(answer))
//
// One at a time, because the chat send refuses a second turn while one runs. A
// send that never shows up in `turns` (refused, offline) is retried once the
// chat is idle, up to MAX_TRIES, then the voice model is told it did not start.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Turn } from '../../../exp/v2c/chat/events'
import { chatBusy, countUserTurns, dispatched, resultToSpeak, settledAnswer } from './escalation'

export const DISPATCH_WAIT_MS = 8_000
export const MAX_TRIES = 3

type Job = { task: string; state: 'waiting' | 'sent'; before: number; sentAt: number; tries: number }

export function useEscalations({ turns, send, feed }: {
  turns: Turn[]
  send: (text: string) => void
  feed: (text: string) => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [tick, setTick] = useState(0)
  // send/feed identities change with the parent's renders; the effect reads
  // them through refs so it only re-runs on turns, jobs and the retry tick.
  const sendRef = useRef(send); sendRef.current = send
  const feedRef = useRef(feed); feedRef.current = feed

  const enqueue = useCallback((task: string) => {
    const t = task.trim()
    if (!t) return
    setJobs(j => [...j, { task: t, state: 'waiting', before: 0, sentAt: 0, tries: 0 }])
  }, [])

  useEffect(() => {
    const head = jobs[0]
    if (!head) return
    if (head.state === 'sent') {
      const done = settledAnswer(turns, head.task, head.before)
      if (done) {
        feedRef.current(resultToSpeak(done))
        setJobs(j => j.slice(1))
        return
      }
      if (dispatched(turns, head.task, head.before)) return
      // Not in the thread yet. Give the send its window, then try again.
      const left = DISPATCH_WAIT_MS - (Date.now() - head.sentAt)
      if (left > 0) {
        const id = setTimeout(() => setTick(n => n + 1), left)
        return () => clearTimeout(id)
      }
      if (head.tries >= MAX_TRIES) {
        feedRef.current(`The task "${head.task}" did not start. Tell him to say it again or type it.`)
        setJobs(j => j.slice(1))
        return
      }
      setJobs(j => [{ ...head, state: 'waiting' }, ...j.slice(1)])
      return
    }
    // waiting: dispatch only into an idle chat.
    if (chatBusy(turns)) return
    const before = countUserTurns(turns, head.task)
    setJobs(j => [{ ...head, state: 'sent', before, sentAt: Date.now(), tries: head.tries + 1 }, ...j.slice(1)])
    sendRef.current(head.task)
  }, [turns, jobs, tick])

  return { enqueue, working: jobs[0]?.task ?? null, queued: jobs.length }
}
