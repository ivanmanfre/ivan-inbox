import { useEffect, useRef, useState } from 'react'

// The link Ivan hands to Mattan when a conversation needs something done by hand on
// LinkedIn. Ivan, 2026-08-24, on Evan T. — the reply that needs a calendar invite sent
// manually: "I ask you for the chat URL, the chat URL, so Mattan can directly open the
// chat."
//
// It IS the chat. `outreach_messages.unipile_chat_id` is a Unipile id
// (`j6k84xrlXBGSk4vs4Kcxkw`) and resolves to nothing on linkedin.com — but the Unipile
// chat object also carries `provider_id`, which is LinkedIn's own conversation id
// (`2-YjU4NGNhZmYt…XzEwMA==`), and that is the last segment of a messaging thread URL.
// db/044 mirrors that map into `unipile_chats` and the inbox view resolves it per row,
// so the app never holds an API key and never waits on a network call to build the link.
//
// THE PROFILE IS THE FALLBACK, AND IT SAYS SO. 873 of the 908 threads that have a real
// conversation resolve to a thread URL; the other 1,647 rows in the inbox are
// invite-only, where no LinkedIn chat exists yet to link to. Those copy the profile and
// the chip reads "copy profile", because a profile link pasted to Mattan while it looks
// like a chat link is exactly the failure this replaces.
const THREAD_BASE = 'https://www.linkedin.com/messaging/thread/'

export type ChatLink = { href: string; isChat: boolean }

export function chatLink(
  chatProviderId: string | null | undefined,
  profileUrl: string | null | undefined,
): ChatLink | null {
  const chat = (chatProviderId ?? '').trim()
  if (chat) return { href: `${THREAD_BASE}${chat}/`, isChat: true }
  const profile = (profileUrl ?? '').trim()
  if (!profile) return null
  // Older rows were imported as http://; a link pasted into a message should be https.
  const href = profile.startsWith('http://') ? `https://${profile.slice(7)}` : profile
  return { href, isChat: false }
}

// An anchor, not a button, and that is load-bearing: clipboard writes fail closed in a
// few places (an insecure origin, a locked-down mobile webview), and when this one does,
// the right-click / long-press "copy link" the browser already offers is the fallback.
export function CopyChatLink({ chatProviderId, url, name, className = 'copylink' }: {
  chatProviderId: string | null | undefined
  url: string | null | undefined
  name: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  const link = chatLink(chatProviderId, url)
  if (!link) return null
  const label = link.isChat ? 'copy chat' : 'copy profile'

  async function copy(e: React.MouseEvent) {
    // The chip sits inside a row whose own click opens the thread.
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(link!.href)
      setState('done')
    } catch {
      setState('fail')
    }
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <a
      className={`${className}${link.isChat ? '' : ' fallback'}`}
      href={link.href}
      target="_blank"
      rel="noreferrer"
      onClick={copy}
      title={state === 'fail'
        ? `Copy failed — right-click to copy this link: ${link.href}`
        : link.isChat
          ? `Copy the LinkedIn chat with ${name}, to hand it over\n${link.href}`
          : `No LinkedIn chat with ${name} yet — this is their profile\n${link.href}`}
    >
      {state === 'done' ? 'copied' : state === 'fail' ? 'copy failed' : label}
    </a>
  )
}
