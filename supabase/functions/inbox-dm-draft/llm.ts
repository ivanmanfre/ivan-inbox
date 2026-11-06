// Text generation goes through the Railway Claude proxy (the same pair inbox-fast uses).
// OpenAI is embeddings-only (Ivan 09-23) and its key here was dead (401) by 2026-11-02.
// The proxy refuses a `system` field, so instructions ride inside the single user turn.
// Read through globalThis so the app's tsc (which reaches this file via tests) type-checks it too.
const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k)
export const DRAFT_MODEL = env('INBOX_DM_DRAFT_MODEL') || 'claude-sonnet-5-5'

export async function askClaude(prompt: string, maxTokens: number, timeoutMs = 60_000): Promise<string> {
  const base = (env('RAILWAY_CLAUDE_URL') ?? '').replace(/\/$/, '')
  const key = env('RAILWAY_CLAUDE_API_KEY')
  if (!base || !key) throw new Error('Drafting is not configured.')
  const r = await fetch(`${base}/v1/messages`, {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) throw new Error(`The drafting service is unavailable (${r.status}). Try again.`)
  const body = await r.json() as { content?: { type?: string; text?: string }[] }
  // Only text blocks: a thinking block ahead of the answer is not the answer.
  const text = (body.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('').trim()
  // A capped proxy answers 200 with its limit notice as the "reply"; that is an outage, never an answer.
  if (!text || /\b(usage|session|rate|weekly) limit\b|limit reached|try again later/i.test(text)) throw new Error('The drafting service is unavailable. Try again.')
  return text
}

/** The first JSON object in a model answer, with or without a code fence. Throws when there is none. */
export function jsonFrom(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  return parsed
}
