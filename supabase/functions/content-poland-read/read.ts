// Pure prompt/parse for content-poland-read: no I/O, so it is unit-tested alone.
//
// "Is this post about Poland?" is a reasoned read, never a keyword list (Ivan's rule: gates are reasoned). The
// definition starts from the content-brain invention check's own "poland" field and adds one case (11-06, Ivan):
// a take made from a Polish point of view ("I am Polish. ...") is a Poland post even when Poland is named once.
// The Railway proxy refuses a `system` field, so the instruction leads the one user turn. Only
// `type === "text"` blocks are the answer; a thinking block is not.

export const MODEL = 'claude-sonnet-5-5'

export function buildBody(post: string) {
  return {
    model: MODEL,
    max_tokens: 300,
    messages: [{
      role: 'user' as const,
      content:
        'Read the LinkedIn post below and decide one thing: is it a Poland post?\n' +
        'Answer true when the post is about Poland, a Polish city or place, Polish people, living in or moving to Poland, ' +
        'or doing business in or with Poland. Politics, migration and strong opinions about Poland count as Poland too.\n' +
        'Answer true also when the author speaks as a Pole, or from life in Poland, and that standpoint frames the take: a ' +
        'political, cultural, civilizational, religious, historical or migration view given from a Polish point of view. ' +
        'Such a post can be very short and name Poland only once. The Polish identity is the ground the take stands on, ' +
        'so it is not a passing mention.\n' +
        'Answer false when Poland is not the subject and no Polish point of view frames the post: another country or city, ' +
        'a business topic, or Poland only named in passing.\n' +
        'Do not judge whether the post is good, true or polite. Only the subject and the standpoint.\n' +
        'Return only JSON, nothing else: {"poland": true or false, "why": "one short plain sentence"}\n\n' +
        'Post:\n<<<\n' + post.slice(0, 6000) + '\n>>>',
    }],
  }
}

export type Read = { poland: boolean; why: string }

// A capped proxy answers 200 with its limit notice as the "reply" (same guard as content-plan-quotes).
const LIMIT_NOTICE = /\b(usage|session|rate) limit\b|limit reached|try again later/i

/** The verdict, or null for anything that is not one clean JSON verdict (refusal, limit notice, prose). */
export function readAnswer(json: { content?: { type: string; text?: string; [k: string]: unknown }[] }): Read | null {
  const raw = (json.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim()
  if (!raw || LIMIT_NOTICE.test(raw)) return null
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as { poland?: unknown; why?: unknown }
    if (typeof o.poland !== 'boolean') return null
    const why = typeof o.why === 'string' ? o.why.trim().slice(0, 300) : ''
    return { poland: o.poland, why }
  } catch {
    return null
  }
}
