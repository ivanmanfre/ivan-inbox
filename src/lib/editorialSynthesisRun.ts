export type SynthesisMessage = { role: string; content: string }
export type SynthesisReply = { raw: string; model: string; usage?: unknown; response_id?: string }
export type SynthesisAttempt = {
  attempt: number; messages: SynthesisMessage[]; reply: SynthesisReply | null; validation_error: string | null
}
export class SynthesisAttemptsFailed extends Error {
  constructor(message: string, readonly attempts: SynthesisAttempt[]) { super(message) }
}

/** Two TOTAL provider attempts, including transport and content failures. No partial batch. */
export async function runSynthesis<T>(input: {
  messages: SynthesisMessage[]
  correctionContext: string
  provider: (messages: SynthesisMessage[], attempt: number) => Promise<SynthesisReply>
  validate: (parsed: unknown) => Promise<T>
}): Promise<{ value: T; reply: SynthesisReply; attempts: SynthesisAttempt[] }> {
  const attempts: SynthesisAttempt[] = []
  let messages = input.messages
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (JSON.stringify(messages).length > 200_000) {
      throw new SynthesisAttemptsFailed('Synthesis input exceeds 200000 characters; last usable batch retained', attempts)
    }
    const trace: SynthesisAttempt = { attempt, messages: structuredClone(messages), reply: null, validation_error: null }
    attempts.push(trace)
    try {
      const reply = await input.provider(messages, attempt)
      trace.reply = reply
      const parsed = JSON.parse(reply.raw)
      const value = await input.validate(parsed)
      return { value, reply, attempts }
    } catch (error) {
      trace.validation_error = error instanceof Error ? error.message : String(error)
      if (attempt === 2) throw new SynthesisAttemptsFailed(trace.validation_error, attempts)
      // A transport failure retries the same input; invalid content receives the
      // actual validation error. Never repair or omit a proposal in application code.
      messages = trace.reply ? [...input.messages,
        { role: 'assistant', content: trace.reply.raw },
        { role: 'user', content: `The complete batch was rejected: ${trace.validation_error}. Return the entire corrected JSON suggestions array; do not drop failed proposals or add unsupported claims. Preserve every required JSON type. Machine metric names must equal an exact allowed key/metric_id with no parenthetical label. Retain exact values, formulas, capture dates, ownership and uncertainty. ${input.correctionContext}` },
      ] : input.messages
    }
  }
  throw new SynthesisAttemptsFailed('No synthesis attempt completed', attempts)
}
