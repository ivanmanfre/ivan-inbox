// The thread pre-read: one line before he opens a conversation.
//
// WHY IT EXISTS, measured. 58 threads are waiting on a reply, the median has
// been waiting 22.9 days, and 36 of them have never been opened in this app at
// all (usage-evidence.md 2.7). The list gives him a name, a company and the
// first few words of the newest message, which is not enough to decide which
// one to open, so the oldest ones stay unopened.
//
// 🔴 WHAT IT IS NOT, and the two rules that keep it that way:
//
//   1. IT NEVER RUNS BY ITSELF. A list of 58 rows that each fire a model call
//      as they scroll into view is a spending bug wearing a feature's clothes.
//      There is no effect that calls this, no prefetch, no warm-up. One click,
//      one line, cached for the session so a second click is free.
//   2. IT IS READ ONLY, AND IT DRAFTS NOTHING. The output is a sentence
//      rendered where the message preview already sits. It is never written to
//      a row, never offered as a reply, and there is no path from here to
//      outreach_messages. The send boundary is untouched because this feature
//      does not reach it.
//
// It rides the EXISTING inbox-fast function exactly as deployed: no new edge
// function, no change to the deployed contract, no new dependency. That
// function's system prompt is the voice loop's, so the user message below
// overrides the register and the escapes are stripped on the way out.

export type PreReadThread = {
  prospect_id: string
  prospect_name: string
  prospect_company?: string | null
  messages: { direction?: string | null; created_at?: string | null; message_text?: string | null }[]
}

// How much conversation travels. The function caps a message at 4,000
// characters of its own accord; this keeps the prompt near a thousand tokens so
// the line costs about a tenth of a cent on the Haiku tier it runs on.
const MSGS = 10
const MSG_CHARS = 500

export const PREREAD_MAX = 200

const ASK = [
  'Read the conversation below and write ONE line for Ivan, who has not opened it yet.',
  '',
  'Exactly three parts, separated by " · ", in this order:',
  'what they want · what is blocking · what was promised',
  '',
  'Rules:',
  '- Write "not stated" for any part the conversation does not actually say. Never guess, never infer a motive.',
  '- Under 140 characters in total.',
  '- No greeting, no preamble, no markdown, no quotes around it, no closing remark.',
  '- Do not escalate and do not offer to do anything. One line, nothing else.',
].join('\n')

/** The message array for inbox-fast. Pure: builds a prompt, opens no request. */
export function buildPreReadMessages(t: PreReadThread): { role: 'user'; content: string }[] {
  const who = t.prospect_company ? `${t.prospect_name} at ${t.prospect_company}` : t.prospect_name
  const body = t.messages.slice(-MSGS).map(m => {
    const speaker = m.direction === 'inbound' ? t.prospect_name : 'Ivan'
    const when = m.created_at ? m.created_at.slice(0, 10) : 'undated'
    const text = (m.message_text ?? '').replace(/\s+/g, ' ').trim()
    return `${when} ${speaker}: ${text.length > MSG_CHARS ? `${text.slice(0, MSG_CHARS)}…` : text}`
  }).filter(l => !/: $/.test(l)).join('\n')
  return [{ role: 'user', content: `${ASK}\n\nConversation with ${who}:\n${body}` }]
}

/**
 * The reply, made safe to print. The fast lane's system prompt can emit a
 * `<<ESCALATE: …>>` line that is machine-read and must never be rendered, and
 * a model asked for one line will sometimes deliver a paragraph.
 */
export function parsePreRead(raw: string): string {
  const clean = raw
    .replace(/<<ESCALATE:[\s\S]*?>>/g, ' ')
    .replace(/<<[\s\S]*?>>/g, ' ')
    .replace(/[*_`#]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)[0] ?? ''
  const one = clean.replace(/^["'“”]|["'“”]$/g, '').replace(/\s+/g, ' ').trim()
  return one.length > PREREAD_MAX ? `${one.slice(0, PREREAD_MAX - 1)}…` : one
}

// ---------------------------------------------------------------------------
// THE LINE, TAKEN APART. Ivan, 2026-08-22: "when you add this sum up … I cannot
// see what is summing up."
//
// He was right and the cause is arithmetic, not the model. `ASK` above buys a
// line of up to 140 characters and `.snip` is one nowrap row inside a list, so
// what reaches him is the first few words and an ellipsis. The content was
// always there; it never fit.
//
// So the row keeps its one line (its height is what the windowed list measures
// against) and the WHOLE line is readable in a bubble, split back into the
// three parts the prompt asked for. Nothing here fetches anything: this is the
// text that was already paid for, rearranged.
// ---------------------------------------------------------------------------

/** The separator `ASK` names. Split tolerantly: a model that drops a space
 *  around the middot has still answered in three parts. */
const PART_SEP = /\s*·\s*/

export const PREREAD_LABELS = ['What they want', 'What is blocking', 'What was promised'] as const

export type PreReadPart = {
  label: string
  text: string
  /** False when the conversation did not say. The prompt asks for the literal
   *  words "not stated", and a blank part means the same thing. Rendered quiet
   *  rather than as content, because "not stated" is the absence of a finding
   *  and printing it in the same weight as a finding is how a gap reads as a
   *  fact. */
  stated: boolean
}

/**
 * The one line, back in three labelled parts, or NULL when it did not come
 * back in three.
 *
 * Null is a real answer and the caller must print the raw line when it gets
 * one. A model that returned two parts, or a sentence with no middot in it,
 * still said something; dropping it to keep the layout tidy would lose the
 * only thing the call bought. Pure, so the shapes are tested without a browser.
 */
export function splitPreRead(line: string): PreReadPart[] | null {
  const raw = line.trim()
  if (!raw) return null
  const parts = raw.split(PART_SEP).map(s => s.trim())
  if (parts.length !== PREREAD_LABELS.length) return null
  return parts.map((text, i) => {
    const stated = text !== '' && !/^not\s+stated\b[.·]?$/i.test(text)
    return { label: PREREAD_LABELS[i], text: stated ? text : 'not stated', stated }
  })
}

/**
 * Whether a thread is worth a pre-read at all. Only the ones the measurement
 * is about: their message is the newest, so the ball is with Ivan. A thread he
 * answered last needs no summary of what they want, and offering the control
 * on all 139 rows would be inviting 139 calls.
 */
export function preReadWorthwhile(t: PreReadThread): boolean {
  const last = t.messages[t.messages.length - 1]
  return !!last && last.direction === 'inbound' && t.messages.length > 0
}

/** Days a thread has been waiting on Ivan, or null when it is not waiting. */
export function waitingDays(t: PreReadThread, now = Date.now()): number | null {
  if (!preReadWorthwhile(t)) return null
  const at = t.messages[t.messages.length - 1].created_at
  if (!at) return null
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((now - ms) / 86_400_000))
}
