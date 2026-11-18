// Parse the desk model's tagged answer. Pure and forgiving about whitespace,
// strict about content: anything that is not valid JSON is dropped, never
// guessed at.

export type Act = Record<string, unknown> & { kind: string }
export type Chip = { label: string; send: string }
export type Parsed = { reply: string; actions: Act[]; reads: Act[]; chips: Chip[] }

function block(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function jsonArray(raw: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    const arr = Array.isArray(v) ? v : [v]
    return arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x))
  } catch {
    return []
  }
}

/** Plain-prose guard: no em/en dashes reach Ivan, whatever the model did. */
export function plain(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, (m, off, str) => {
      // "word — word" -> "word, word"; a dash between digits (ranges) -> "-"
      const prev = str[off - 1] ?? '', next = str[off + m.length] ?? ''
      return /\d/.test(prev) && /\d/.test(next) ? '-' : ', '
    })
    .replace(/,\s*,/g, ',')
    .trim()
}

export function parse(text: string): Parsed {
  let reply = block(text, 'reply')
  if (!reply) {
    // No (or an empty, or an unclosed) reply tag: take everything outside the other blocks.
    reply = text.replace(/<(actions|reads|chips)>[\s\S]*?<\/\1>/gi, '').replace(/<\/?reply>/gi, '').trim()
  }
  const actions = jsonArray(block(text, 'actions'))
    .filter((a) => typeof a.kind === 'string') as Act[]
  const reads = jsonArray(block(text, 'reads'))
    .filter((a) => typeof a.kind === 'string' && /^read_/.test(a.kind as string)) as Act[]
  const chips = jsonArray(block(text, 'chips'))
    .filter((c) => typeof c.label === 'string' && typeof c.send === 'string' && c.label.trim() && c.send.trim())
    .slice(0, 3)
    .map((c) => ({ label: plain(String(c.label)).slice(0, 60), send: String(c.send).slice(0, 400) }))
  return { reply: plain(reply), actions, reads, chips }
}
