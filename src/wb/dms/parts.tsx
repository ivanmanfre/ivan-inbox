/* ==========================================================================
   src/wb/dms/parts.tsx — the small pieces S02 and S14 share.

   View only. Every helper that touches data is imported from its existing
   module; nothing here fetches, writes or holds a decision.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Avatar, Chip, Icon } from '../../ds'
import { chatLink } from '../../components/CopyChatLink'
import type { Thread } from '../../lib/inbox'
import './dms.css'

/* The identity tint. The old avatar hashed the name into one of six gradients;
   the system offers four low-alpha tints, so the same hash picks one of four.
   Identity, never a category mark. */
function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Face({ name, size = 'md', live }: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  live?: boolean
}) {
  const tint = ((hashName(name) % 4) + 1) as 1 | 2 | 3 | 4
  return <Avatar name={name} initials={initials(name)} tint={tint} size={size} live={live} />
}

/** The relative age, unchanged from InboxScreen. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

/* THE HAND-OFF LINK (S02-24, S14-7). Still an anchor, because that is
   load-bearing: when the clipboard write fails closed the browser's own
   right-click / long-press "copy link" is the fallback. The resolver, the
   two labels and every title string come over untouched; only the box is new. */
export function ChatLink({ chatProviderId, url, name, quiet }: {
  chatProviderId: string | null | undefined
  url: string | null | undefined
  name: string
  quiet?: boolean
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
      className={`a-dms-link${quiet ? ' a-dms-link-q' : ''}`}
      data-fallback={link.isChat ? undefined : ''}
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
      <Icon name="copy" size={16} />
      {state === 'done' ? 'copied' : state === 'fail' ? 'copy failed' : label}
    </a>
  )
}

/* The pull-to-refresh mark. Same three states the old indicator had, drawn with
   named glyphs instead of arrows typed as text. */
export function PullMark({ pull, refreshing, trigger }: {
  pull: number; refreshing: boolean; trigger: number
}) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="a-dms-ptr" style={{ height: pull }} aria-hidden>
      <span
        className="a-dms-ptr-m"
        data-spin={refreshing ? '' : undefined}
        style={{
          opacity: refreshing ? 1 : Math.min(1, pull / trigger),
          transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
        }}
      >
        <Icon name={refreshing ? 'refresh' : ready ? 'up' : 'down'} size={20} />
      </span>
    </div>
  )
}

/** A neutral status pill. A lane and a channel are categories, so neither takes
    a colour: the system offers no categorical palette. */
export function Pill({ children }: { children: React.ReactNode }) {
  return <Chip>{children}</Chip>
}

export type { Thread }
