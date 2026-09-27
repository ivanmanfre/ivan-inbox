/* The booking card as Slack will show it (Ivan 2026-09-27: "I want to see it formatted").

   slackFormat.js is a COPY of the function of the same name in the n8n
   workflow "Ops Drafts → Slack" (4B3D9O9gvAaAWBe2), the one that turns a booking
   card's stored body into Slack mrkdwn at post time. CHANGE ONE, CHANGE BOTH:
   if they drift, the card previews one message and Slack gets another.
   renderMrkdwn draws the three things that function emits: *bold*,
   <url|label> links and &amp;/&lt;/&gt; escapes. */
import type { ReactNode } from 'react'

function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  text.split(/(<[^>|]+\|[^>]*>|<https?:\/\/[^>]+>)/).forEach((part, i) => {
    if (!part) return
    if (i % 2 === 1) {
      const inner = part.slice(1, -1)
      const bar = inner.indexOf('|')
      const href = bar >= 0 ? inner.slice(0, bar) : inner
      const label = bar >= 0 ? inner.slice(bar + 1) : inner
      out.push(<a key={`${key}-${i}`} className="a-link" href={href} target="_blank" rel="noreferrer">{unescape(label)}</a>)
      return
    }
    part.split(/(\*[^*\n]+\*)/).forEach((seg, j) => {
      if (!seg) return
      if (j % 2 === 1) out.push(<strong key={`${key}-${i}-${j}`}>{unescape(seg.slice(1, -1))}</strong>)
      else out.push(unescape(seg))
    })
  })
  return out
}

export function renderMrkdwn(mrkdwn: string): ReactNode {
  return mrkdwn.split('\n').map((line, i) => (
    <div key={i} className="a-slack-line">{line ? inline(line, String(i)) : '\u00a0'}</div>
  ))
}
