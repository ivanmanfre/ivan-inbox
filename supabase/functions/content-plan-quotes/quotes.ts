// Pure prompt/parse for content-plan-quotes: no I/O, so it is unit-tested alone.
//
// The Railway proxy refuses a `system` field (it reads as an injected
// instruction block), so the instruction leads the one user turn. Only
// `type === "text"` blocks are the answer; a thinking block is not.

// The id the n8n proxy callers send (CLIENT ARCH - Idea -> Generation Kickoff and others);
// the proxy's MODEL_MAP carries it as a full id.
export const MODEL = 'claude-sonnet-5-5'

export function buildBody(quote: string) {
  return {
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user' as const,
      content:
        'Below is a short quote from a business call. If it is already in English, return it exactly as it is. ' +
        'If it is in another language, translate it into plain, natural English. Keep the speaker\'s meaning and tone. ' +
        'Return only the quote text, with no quotation marks and no notes.\n\nQuote:\n' + quote,
    }],
  }
}

const REFUSAL = /^(i can'?t|i cannot|i'm sorry|sorry,|i am unable)/i
// A capped proxy answers 200 with its limit notice as the "reply" (same guard as inbox-fast).
const LIMIT_NOTICE = /\b(usage|session|rate) limit\b|limit reached|try again later/i

// `src` is the source quote sent. An answer identical to it (an English quote returned as is)
// is always kept, even when it reads like a refusal or a limit notice ("Sorry, we ...").
export function readAnswer(json: { content?: { type: string; text?: string; [k: string]: unknown }[] }, src: string): string | null {
  const raw = (json.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim()
  const source = (src ?? '').trim()
  if (raw && raw === source) return source
  const text = raw.replace(/^["“]|["”]$/g, '').trim()
  if (text && text === source) return source
  if (!text || REFUSAL.test(text) || LIMIT_NOTICE.test(text) || text.length > 1200) return null
  return text
}
