import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cardStateOf, dispatchCommentGate, fetchCommentFeedStates, outboundApproveUrl, outboundFeedId,
  type FeedState, type GateVerdict, type OpsDraft,
} from '../lib/ops'

// The comment lane's queue — the app's, because the poster does not have one.
//
// Ivan: "wtf 'another comment is already queued to post. wait for its
// confirmation first.' they should be able to queue not make me wait for every
// single one".
//
// PROBED BEFORE DESIGNED (n8n `lwuWECwQRbhzK5Bt`, node "Validate + Approve"):
// the poster REJECTS, it does not defer. It allows exactly ONE row in
// `approved|posting` globally, enforces ~10 minutes between posts, and caps the
// day at 3. A refused approve leaves `comment_feed.status = 'pending'` with
// NOTHING scheduled to retry it — so "fire all of them and let the poster sort
// it out" would silently lose every one after the first.
//
// Hence: Ivan queues, and THIS holds the line and re-fires as the window opens.
// Three properties it has to have, all of which come from the probe:
//
//  1. NOTHING DIES SILENTLY. A queued card is either accepted (and then its
//     state is read from comment_feed, the table the poster actually writes),
//     refused on the merits (and says so), or still waiting (and says what for).
//  2. IDEMPOTENT. The gate answers "already <status>" to a replay because the
//     row has left `pending`, so an over-eager retry cannot double-post. That is
//     what makes a blind timer safe.
//  3. DURABLE WHERE IT MATTERS. Accepted state lives in comment_feed and is
//     re-read on every load, so a refresh cannot invent a "Queued" badge. The
//     WAITING line itself is in-memory and says so on the card — a card that is
//     merely waiting is still `pending` server-side, i.e. still fully actionable,
//     so losing the line on a reload loses nothing except the automatic retry.

// Faster than the poster's 10-minute spacing on purpose: the point is to catch
// the window the moment it opens, and a replay is a no-op.
const RETRY_MS = 90_000
// A cap refusal does not clear until tomorrow in Buenos Aires. Retrying it every
// 90 seconds for the rest of the day would be pure noise against the webhook.
const CAP_RE = /daily auto-post cap reached/i

export type QueueEntry = { id: string; url: string; verdict: GateVerdict }

export function useCommentQueue(drafts: OpsDraft[], refresh: () => void) {
  const [feed, setFeed] = useState<Map<string, FeedState>>(new Map())
  const [waiting, setWaiting] = useState<QueueEntry[]>([])
  const [cappedToday, setCappedToday] = useState(false)
  const firing = useRef(false)

  // Durable state: what the poster says about every outbound card on screen.
  const ids = drafts.map(outboundFeedId).filter((x): x is string => !!x)
  const key = ids.join(',')
  const loadFeed = useCallback(() => {
    if (ids.length === 0) { setFeed(new Map()); return }
    fetchCommentFeedStates(ids).then(setFeed).catch(() => { /* keep the last read */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => { loadFeed() }, [loadFeed])

  // A card that reached a real state at the poster is off the line, whatever the
  // line thought.
  useEffect(() => {
    setWaiting(cur => cur.filter(e => {
      const d = drafts.find(x => x.id === e.id)
      const f = d ? feed.get(outboundFeedId(d) ?? '') : undefined
      return cardStateOf(f) === null
    }))
  }, [feed, drafts])

  const record = useCallback((id: string, v: GateVerdict) => {
    if (CAP_RE.test(v.message)) setCappedToday(true)
    setWaiting(cur => {
      const rest = cur.filter(e => e.id !== id)
      if (v.outcome !== 'timing') return rest
      const d = drafts.find(x => x.id === id)
      const url = d ? outboundApproveUrl(d) : null
      if (!url) return rest
      // Keep the original position: first approved is first to go out.
      return cur.some(e => e.id === id)
        ? cur.map(e => (e.id === id ? { ...e, verdict: v } : e))
        : [...rest, { id, url, verdict: v }]
    })
  }, [drafts])

  // One in flight at a time, matching the poster's own shape. Firing the whole
  // line at once would just collect N refusals.
  useEffect(() => {
    if (waiting.length === 0 || cappedToday) return
    const t = setInterval(async () => {
      if (firing.current) return
      const head = waiting[0]
      if (!head) return
      firing.current = true
      try {
        const v = await dispatchCommentGate(head.url)
        if (CAP_RE.test(v.message)) setCappedToday(true)
        if (v.outcome === 'accepted' || v.outcome === 'already') {
          setWaiting(cur => cur.filter(e => e.id !== head.id))
          refresh()
          loadFeed()
        } else {
          setWaiting(cur => cur.map(e => (e.id === head.id ? { ...e, verdict: v } : e)))
          // Refused on the merits: it will never clear by waiting, so it leaves
          // the line and stays on screen with the reason.
          if (v.outcome === 'refused') {
            setWaiting(cur => cur.filter(e => e.id !== head.id))
          }
        }
      } finally {
        firing.current = false
      }
    }, RETRY_MS)
    return () => clearInterval(t)
  }, [waiting, cappedToday, refresh, loadFeed])

  return {
    feed,
    waiting,
    cappedToday,
    record,
    reloadFeed: loadFeed,
    positionOf: (id: string) => waiting.findIndex(e => e.id === id),
  }
}
