// escalation.ts: how a spoken escalation finds its answer in the thread.
//
// The voice model calls escalate_to_workbench({ task }); LiveVoice hands the
// task to the SAME send the typed composer uses, so it lands in the Claude
// thread as a normal user turn and streams like any other. This file is the
// pure part: reading `turns` to know when that turn is in flight, when its
// answer has settled, and what to say about it. Pure so it is tested, not trusted.
import type { Turn } from '../../../exp/v2c/chat/events'
import { speakableText } from '../../../lib/realtime/voice'

/** How many user turns already carry this exact text. The next one is ours. */
export function countUserTurns(turns: Turn[], task: string): number {
  const want = task.trim()
  let n = 0
  for (const t of turns) if (t.role === 'user' && t.text.trim() === want) n++
  return n
}

/**
 * Is a Claude turn in flight right now? The chat send refuses a second turn
 * while one runs, so a dispatch must wait. A trailing user turn with no answer
 * after it is the in-flight shape: the answer half is only appended when the
 * stream ends, and a hydrated open row carries no answer half at all.
 */
export function chatBusy(turns: Turn[]): boolean {
  const last = turns[turns.length - 1]
  return !!last && last.role === 'user'
}

export type Settled = { text: string; error: string | null }

/**
 * The answer to the (before+1)-th user turn carrying `task`, once it has
 * settled. Null while that user turn has not appeared, or its answer has not
 * landed, or the answer row is still queued/running.
 */
export function settledAnswer(turns: Turn[], task: string, before: number): Settled | null {
  const want = task.trim()
  let seen = 0
  let at = -1
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]
    if (t.role === 'user' && t.text.trim() === want) {
      seen++
      if (seen === before + 1) { at = i; break }
    }
  }
  if (at < 0) return null
  const answer = turns[at + 1]
  if (!answer || answer.role !== 'assistant') return null
  if (answer.status === 'queued' || answer.status === 'running') return null
  return { text: answer.text, error: answer.error?.message ?? (answer.aborted ? 'stopped' : null) }
}

/** Has the user turn for this dispatch appeared yet? */
export function dispatched(turns: Turn[], task: string, before: number): boolean {
  return countUserTurns(turns, task) > before
}

/** What the voice model is told when the turn settles. Short, speakable. */
export function resultToSpeak(s: Settled): string {
  // A dash reads as nothing aloud and the voice model echoes it into captions.
  const body = speakableText(s.text).replace(/\s*\u2014\s*/g, ', ')
  if (s.error) return body ? `It stopped with an error (${s.error}). What it had: ${body}` : `It failed: ${s.error}.`
  return body || 'It finished but wrote no text answer. The details are in the chat.'
}
