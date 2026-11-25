import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
type Result = { text: string; source?: { kind: string; path: string }; failed?: boolean }
export function persistedAnswer(args: {
  db: SupabaseClient; turnId: string; threadId: string; headers: Record<string, string>; run: () => Promise<Result>;
}) {
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (data: unknown) => {
        if (!closed) controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(data) + '\n\n'))
      }
      const save = async () => {
        let answer: Result
        try { answer = await args.run() }
        catch { answer = { text: 'I could not verify the result. Check the original record before trying a change again.', failed: true } }
        const finished = new Date().toISOString()
        const { data, error } = await args.db.from('inbox_turns').update({
          answer: answer.text, status: answer.failed ? 'error' : 'done', finished_at: finished,
          error_code: answer.failed ? 'source_unavailable' : null,
          sources: answer.source ? [{ ...answer.source, at: finished }] : [],
        }).eq('id', args.turnId).eq('thread_id', args.threadId).eq('status', 'running').select('id').maybeSingle()
        if (error) throw new Error('turn_update_failed')
        if (data) {
          // These answers never establish or advance the worker's CLI session.
          await args.db.from('inbox_threads').update({ last_turn_at: finished }).eq('id', args.threadId)
          emit({ type: 'assistant', message: { content: [{ type: 'text', text: answer.text }] } })
        }
        emit({ type: 'result' })
      }
      const task = save().catch(() => {
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'The answer could not be saved. Check this chat again.' }] } })
      }).finally(() => { if (!closed) controller.close() })
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task)
    },
    cancel() { closed = true },
  })
  return new Response(stream, { headers: {
    ...args.headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
    'X-Broker-Turn-Id': args.turnId, 'X-Broker-Thread-Id': args.threadId,
  } })
}
