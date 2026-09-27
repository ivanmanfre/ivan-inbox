import type { ReactNode } from 'react'

// Bare URLs in a message ("inboundonsteroids.com/scan/x") as real links, https:// added when the
// scheme is missing. The regex, the scheme repair and the display-only contract are today's
// (src/wb/chrome/Linkified.tsx), byte for byte; only the class is D's. The stored text is never
// changed, so what gets SENT stays byte for byte.
const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi

export function Linkified({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  let key = 0
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0]
    if (m.index > last) out.push(text.slice(last, m.index))
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    out.push(<a key={`lk-${key++}`} href={href} target="_blank" rel="noopener noreferrer" className="d-link" onClick={e => e.stopPropagation()}>{raw}</a>)
    last = m.index + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
