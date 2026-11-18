// Authorization of desk writes (Sol desk-backend r1 #1). The chat model proposes actions; before
// any of them runs, one reasoned check sees ONLY Ivan's current message and the proposed actions
// in plain words, and answers per action whether he explicitly asked for exactly that. A gate is a
// reasoned call, never a keyword list (Ivan's ruling). It fails closed: an unreadable or refused
// answer authorizes nothing.

import { askDesk } from './llm.ts'

export function authPrompt(message: string, actions: string[]): string {
  return `You check whether a chat assistant may carry out actions for Ivan, a solo founder, on his LinkedIn content.

Rule: an action is allowed only if Ivan's message below explicitly asks for exactly that action, on exactly that post, with those details (date, reason). A question, a wish, an opinion or a "maybe" is not a request. A request for something else is not a request for this. If his message is a tapped button that spells out the command, that counts as asking.
Two kinds of action need less: filing something he sent (a link, a photo, a voice note or thought he shares as a possible post) into his Ideas or photo library is allowed when he sent that item and did not say not to file it. Approving a post that FAILED its quality check needs him to say so outright (for example "anyway" or "even though it failed").

Ivan's message:
<message>
${message}
</message>

Proposed actions:
${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Answer with ONLY a JSON array, nothing before or after it, one entry per action: [{"n":1,"ok":true,"why":"..."}]`
}

/** Strict: the whole answer must be the JSON array (an optional code fence is allowed), else all false. */
export function parseAuth(text: string, n: number): boolean[] {
  const out = new Array(n).fill(false)
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!body.startsWith('[') || !body.endsWith(']')) return out
  try {
    const arr = JSON.parse(body)
    if (!Array.isArray(arr) || arr.length !== n) return out
    const seen = new Set<number>()
    for (const x of arr) {
      if (typeof x?.n !== 'number' || !Number.isInteger(x.n)) return new Array(n).fill(false)
      const i = x.n - 1
      if (i < 0 || i >= n || seen.has(i) || typeof x?.ok !== 'boolean') return new Array(n).fill(false)
      seen.add(i)
      out[i] = x.ok === true
    }
  } catch { return new Array(n).fill(false) }
  return out
}

export async function authorize(message: string, actions: string[], ask: typeof askDesk = askDesk): Promise<boolean[]> {
  if (!actions.length) return []
  try {
    const r = await ask(authPrompt(message, actions), { maxTokens: 400, hedgeMs: 0 })
    return parseAuth(r.text, actions.length)
  } catch {
    return new Array(actions.length).fill(false)
  }
}
