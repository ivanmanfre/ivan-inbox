// Which conversations have a write in flight, per prospect (Ivan 10-21, Diane O'Brien). The thread pane
// used to keep one `busy` flag for every thread: one request that never answered greyed Send, Discard,
// Later and compose in every conversation until a relaunch. Now the pane is keyed per thread and the flag
// lives here, per prospect: another thread is never blocked, and coming back to a thread whose send is
// still running shows it busy (so it is not pressed twice).
import { useSyncExternalStore } from 'react'

const running = new Map<string, number>()
const subs = new Set<() => void>()
const emit = () => { for (const f of subs) f() }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

/** Mark a write in flight on this thread. The returned release is safe to call more than once. */
export function holdPane(pid: string): () => void {
  running.set(pid, (running.get(pid) ?? 0) + 1)
  emit()
  let done = false
  return () => {
    if (done) return
    done = true
    const n = (running.get(pid) ?? 1) - 1
    if (n > 0) running.set(pid, n); else running.delete(pid)
    emit()
  }
}

export const paneBusy = (pid: string) => running.has(pid)
export function usePaneBusy(pid: string): boolean {
  return useSyncExternalStore(subscribe, () => running.has(pid), () => false)
}

/** Tests only. */
export function resetPaneBusy(): void { running.clear(); emit() }

/** "Draft it" in flight, per prospect: it survives the keyed pane remounting when he switches threads. */
export type DraftJob = { running: boolean; error: string | null }
const jobs = new Map<string, DraftJob>()
export function setDraftJob(pid: string, job: DraftJob | null): void {
  if (job) jobs.set(pid, job); else jobs.delete(pid)
  emit()
}
export const draftJobOf = (pid: string) => jobs.get(pid) ?? null
export function useDraftJob(pid: string): DraftJob | null {
  return useSyncExternalStore(subscribe, () => jobs.get(pid) ?? null, () => null)
}
export function resetDraftJobs(): void { jobs.clear(); emit() }
