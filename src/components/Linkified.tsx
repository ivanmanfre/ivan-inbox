import type { ReactNode } from 'react'

// Drafts (and sent messages) carry bare URLs like "inboundonsteroids.com/scan/x"
// with no scheme, so they render as dead text. Turn any URL into a real tapable
// link, prepending https:// when the scheme is missing. Display-only — the
// stored message_text is never changed, so what gets SENT stays byte-for-byte.
const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi

export function Linkified({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  let key = 0
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0]
    // Skip false positives like "e.g" or a trailing "3.5" — require a known-ish
    // TLD-ish shape by checking the matched chunk has a dot with 2+ letters after.
    if (m.index > last) out.push(text.slice(last, m.index))
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    out.push(
      <a
        key={`lk-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="msg-link"
        onClick={e => e.stopPropagation()}
      >
        {raw}
      </a>,
    )
    last = m.index + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
