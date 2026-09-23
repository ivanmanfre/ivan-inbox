export type SynthesisMessage = { role: string; content: string }
export type SynthesisReply = { raw: string; model: string; usage?: unknown; response_id?: string }
export type SynthesisAttempt = {
  attempt: number; messages: SynthesisMessage[]; reply: SynthesisReply | null; validation_error: string | null
}
export class SynthesisAttemptsFailed extends Error {
  readonly attempts: SynthesisAttempt[]
  constructor(message: string, attempts: SynthesisAttempt[]) { super(message); this.attempts = attempts }
}

/** Strip ONE leading/trailing markdown code fence before parsing. This is a PARSER
 * repair, not a judging gate: nothing about the payload is rewritten, no content rule is
 * relaxed, and the unchanged validator still decides. The raw reply is retained verbatim
 * by the caller either way. A fenced reply is an artifact of the local Claude proxy
 * substitution used for replay; production runs OpenAI gpt-4.1-mini under JSON mode. */
export function parseReplyPayload(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed)
  return JSON.parse(fenced ? fenced[1] : trimmed)
}

/** The exact correction directive. One definition, so a compact correction turn and the
 * full-thread fallback can never drift apart. */
export function correctionDirective(validationError: string, correctionContext: string) {
  return `The complete batch was rejected: ${validationError}. Return the entire corrected JSON suggestions array; do not drop failed proposals or add unsupported claims. Preserve every required JSON type. Machine metric names must equal an exact allowed key/metric_id with no parenthetical label. Retain exact values, formulas, capture dates, ownership and uncertainty. Remove unsupported audience, cadence, personal behavior and causal claims. Review every proposal, not only the first failing field. Impressions are not unique people; zero recorded public comments is not zero DMs or all feedback. A weighted likes/reposts score is a proxy, not measured reach; keep its definition where citing the lift. Preserve not-just qualifications rather than turning them into exclusions. Where two proposals use identical evidence, label them mutually exclusive alternative treatments, not separate-week variety. Cross-account metrics are not comparable; subjective risk/safety labels are not measured facts. ${correctionContext}`
}

/** Two TOTAL provider attempts, including transport and content failures. No partial batch. */
export async function runSynthesis<T>(input: {
  messages: SynthesisMessage[]
  correctionContext: string
  provider: (messages: SynthesisMessage[], attempt: number) => Promise<SynthesisReply>
  validate: (parsed: unknown) => Promise<T>
  buildCorrection?: (failed: { raw: string; validationError: string; directive: string }) => SynthesisMessage[]
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
      const parsed = parseReplyPayload(reply.raw)
      const value = await input.validate(parsed)
      return { value, reply, attempts }
    } catch (error) {
      trace.validation_error = error instanceof Error ? error.message : String(error)
      if (attempt === 2) throw new SynthesisAttemptsFailed(trace.validation_error, attempts)
      // A transport failure retries the same input; invalid content receives the
      // actual validation error. Never repair or omit a proposal in application code.
      const directive = correctionDirective(trace.validation_error, input.correctionContext)
      messages = trace.reply
        ? (input.buildCorrection
          // A custom correction carries both evidence and canonical instructions.
          // The guard above still decides whether attempt 2 fits before dispatch.
          ? input.buildCorrection({ raw: trace.reply.raw, validationError: trace.validation_error, directive })
          : [...input.messages,
            { role: 'assistant', content: trace.reply.raw },
            { role: 'user', content: directive }])
        : input.messages
    }
  }
  throw new SynthesisAttemptsFailed('No synthesis attempt completed', attempts)
}
