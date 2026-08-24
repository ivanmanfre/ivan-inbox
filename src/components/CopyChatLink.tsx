import { useEffect, useRef, useState } from 'react'

// The link Ivan hands to Mattan when a conversation needs something done by hand on
// LinkedIn. Ivan, 2026-08-24, on Evan T. — the reply that needs a calendar invite sent
// manually: "so I can copy and send to Mattan when the chat requires him to do something
// manual".
//
// 🔴 IT IS THE PROFILE URL, ON PURPOSE. `unipile_chat_id` is a Unipile id (Evan's is
// `j6k84xrlXBGSk4vs4Kcxkw`), not a LinkedIn conversation id, so no
// linkedin.com/messaging/thread/… address is derivable from anything we store — the same
// fact lib/inbox.ts records where the context-gap escalation builds its chat_url. Message
// from the profile and LinkedIn opens the EXISTING thread, so this still lands him in the
// chat. Every one of the 12,482 prospect rows carries a linkedin_url, so no row shows a
// dead chip.
export function chatLink(url: string | null | undefined): string | null {
  const t = (url ?? '').trim()
  if (!t) return null
  // Older rows were imported as http://; a link pasted into WhatsApp should be the https one.
  return t.startsWith('http://') ? `https://${t.slice(7)}` : t
}

// An anchor, not a button, and that is load-bearing: clipboard writes fail closed in a few
// places (an insecure origin, a locked-down mobile webview), and when this one does, the
// right-click / long-press "copy link" the browser already offers is the fallback. Cmd-click
// still opens the profile.
export function CopyChatLink({ url, name, className = 'copylink' }: {
  url: string | null | undefined
  name: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  const href = chatLink(url)
  if (!href) return null

  async function copy(e: React.MouseEvent) {
    // The chip sits inside a row whose own click opens the thread.
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(href!)
      setState('done')
    } catch {
      setState('fail')
    }
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={copy}
      title={state === 'fail'
        ? `Copy failed — right-click to copy this link: ${href}`
        : `Copy ${name}'s LinkedIn link, to hand this chat over\n${href}`}
    >
      {state === 'done' ? 'copied' : state === 'fail' ? 'copy failed' : 'copy link'}
    </a>
  )
}
