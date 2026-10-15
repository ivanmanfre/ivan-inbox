import { useEffect, useState } from 'react'
import { fetchBoards, type Board } from '../settings/reads'
import type { Lane } from './model'

// THE CLIENT PANEL, ONE TAP AWAY (Ivan 2026-10-15: "make my experience inbox to client's content panel
// smoother, maybe link to panel"). Each client lane has one live board (client_boards, one row per
// client_id), and its queue ids ARE carousel_drafts ids, so a post opens straight in the panel with
// ?post=<id> (ClientBoardPage's deep link; an unknown id simply opens the board). Ivan's lane has no
// panel. The token only ever sits inside the href, as in Settings.

let boards: Promise<Board[]> | null = null
const read = () => (boards ??= fetchBoards().catch(e => { boards = null; throw e }))

/** The panel URL for a lane, or for one post on it. Pure. */
export function panelUrl(b: Pick<Board, 'slug' | 'token'> | null | undefined, postId?: string | null): string | undefined {
  if (!b) return undefined
  const q = new URLSearchParams({ k: b.token })
  if (postId) q.set('post', postId)
  return `https://ivanmanfredi.com/client/${b.slug}?${q.toString()}`
}

/** `link(lane, postId?)`: the client's panel (or the post on it); undefined for Ivan or before the boards load. */
export function usePanelLink(): (lane: Lane, postId?: string | null) => string | undefined {
  const [list, setList] = useState<Board[] | null>(null)
  useEffect(() => {
    let live = true
    read().then(b => { if (live) setList(b) }, () => {})
    return () => { live = false }
  }, [])
  return (lane, postId) => lane === 'ivan' ? undefined : panelUrl(list?.find(b => b.client_id === lane), postId)
}
