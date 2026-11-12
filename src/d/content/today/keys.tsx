import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchIvanArmedDays, type ArmedDays, type ContentDraft } from '../../../lib/content'
import { CardRefused, fetchIvanSlotRows, postCard, readTodayCard, type SlotRow, type TodayCard } from '../../../lib/contentCard'
import { bodySha, lineFlagsOf, needsKeep } from '../../../lib/lineFlags'
import { dHash } from '../../route'
import { useFrame } from '../../shell/frame'
import { isBrainPost } from '../../../lib/brainDraft'
import { Btn } from '../../ui/Key'
import { warsawDow, warsawHm } from '../../ui/time'
import { seatSlotOf, type Slot } from '../model'
import { useLiveNow } from '../useLiveNow'
import { markShown, shownForMs } from '../verdictStore'
import { oneTapSlot, slotWords, useApproveSchedule, useReservedSlots } from '../weekVerbs'
import { useLineFlags } from '../v2/LineFlags'
import { refreshTodayCard, type LiveCard } from './store'

// THE CARD'S KEYS, shared by the sliding toast, Home and the card on Content. Post is the Review desk's own one-tap
// key (weekVerbs.useApproveSchedule: held 8 s with Undo, the same slot, the same receipt; no Undo after the write,
// as on that key). When the hold ends the card is read again (the text must be exactly the one shown; flagged lines
// that need his answer send him to Review), then ONE database call, content_card_post, rechecks everything under a
// lock and does the existing approve (cb39 keep / approveReviewDraft's update) and scheduleGuarded's update and marks
// the card posted, or writes nothing. A draft with flagged lines to check goes to Review instead, where Approve asks.

/** The one-tap slot for Ivan's seat, from the same reads as the Review desk. Null until both reads answered. */
export function useOneTapSlot(version: number): Slot | null {
  const now = useLiveNow()
  const reserved = useReservedSlots()
  const [armed, setArmed] = useState<ArmedDays | null>(null)
  const [armedFailed, setArmedFailed] = useState(false)
  const [rows, setRows] = useState<SlotRow[] | null>(null)
  useEffect(() => {
    let live = true
    fetchIvanArmedDays().then(a => { if (live) { setArmed(a); setArmedFailed(false) } }, () => { if (live) setArmedFailed(true) })
    fetchIvanSlotRows().then(r => { if (live) setRows(r) }, () => { if (live) setRows(prev => prev ?? []) })
    return () => { live = false }
  }, [version])
  const hm = useMemo(() => seatSlotOf(rows ?? [], now), [rows, now])
  return useMemo(() => rows == null ? null : oneTapSlot(armed, armedFailed, [...reserved.values()].map(r => r.at), now, hm),
    [rows, armed, armedFailed, reserved, now, hm])
}

const NOT_POSTED = 'Not posted:'
function refusal(now: TodayCard | null, day: string, id: string, shown: string): string | null {
  if (!now || now.day !== day || now.draft?.id !== id) return `${NOT_POSTED} today’s card changed.`
  if (now.state === 'skipped') return `${NOT_POSTED} the card was skipped.`
  if (now.state !== 'shown') return `${NOT_POSTED} the card was already used.`
  // The text this device showed, exactly: another device's Fix keeps the card 'ok' with a body this one never showed.
  if ((now.draft.post_body ?? '') !== shown) return `${NOT_POSTED} the text changed.`
  if (now.live === 'changed') return `${NOT_POSTED} the text changed.`
  if (now.live === 'decided') return `${NOT_POSTED} it was already decided in Review.`
  if (now.live === 'gone') return `${NOT_POSTED} it is no longer in Review.`
  return null
}

export type CardKeys = {
  slot: Slot | null
  /** Lines to check before it can post (post-quality line flags): null when there is nothing to check. */
  check: number | null
  /** False while the line check is still being worked out (the keys would change under the finger). */
  ready: boolean
  post: () => void
}

export function useCardKeys(card: LiveCard, body: string, version: number): CardKeys {
  const d = card.draft
  const f = useFrame()
  const slot = useOneTapSlot(version)
  const refresh = useCallback(() => { void refreshTodayCard() }, [])
  const oneTap = useApproveSchedule(refresh)
  const lf = useLineFlags(d as ContentDraft, body)
  useEffect(() => { markShown(d.id) }, [d.id])
  const post = useCallback(() => {
    if (!slot) return
    const shown = body
    const viaVerdict = isBrainPost(d) && (d.status === 'review' || d.status === 'error')
    const toReview = () => f.navigate(dHash('content', 'now', { focus: d.id }))
    void oneTap({
      id: d.id, status: d.status, poland: card.why === 'poland', viaVerdict,
      write: async () => {
        const fresh = await readTodayCard()
        const why = refusal(fresh, card.day, d.id, shown)
        if (why) throw new Error(why)
        const sha = await bodySha(shown)
        // Lines flagged during the hold that need his answer: Review asks, the card does not post.
        if (needsKeep(lineFlagsOf(fresh?.draft?.line_flags, shown), sha)) { toReview(); throw new Error(`${NOT_POSTED} it has lines to check in Review.`) }
        try { return await postCard(card.day, d.id, sha, slot.at.toISOString(), viaVerdict, shownForMs(d.id)) }
        catch (e) { if (e instanceof CardRefused && e.review) toReview(); throw e }
      },
    }, slot.at)
  }, [slot, oneTap, d, card.day, card.why, body, f])
  // While the body is still being hashed, flagged text counts as asking (useLineFlags); the keys wait for the answer.
  const ready = !lf.flags || !lf.ask || lf.sha !== null
  return { slot, check: lf.ask ? lf.flags?.lines.length ?? 0 : null, ready, post }
}

/** The first two lines of the post, as the feed opens it. */
export function firstLines(body: string): [string, string | null] {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  return [lines[0] ?? '', lines[1] ?? null]
}

export const postWords = (at: Date) => `Post · ${warsawDow(at)} ${warsawHm(at)}`
export const checkWords = (n: number) => n > 0 ? `Check ${n} line${n === 1 ? '' : 's'}` : 'Check it'

/** Two lines and two keys: the toast and Home. Plain props only (the toast draws it outside the confirm provider). */
export function CardPeek({ body, keys, onOpen, onCheck, label }: {
  body: string; keys: CardKeys; onOpen: () => void; onCheck: () => void
  /** Home names the block; the toast does not need to. */
  label?: string
}) {
  const [l1, l2] = firstLines(body)
  return (
    <div className="ct-peek" data-card-peek>
      {label && <b className="ct-peek-l">{label}</b>}
      <p className="ct-peek-t"><span className="ct-peek-1">{l1}</span>{l2 && <span className="ct-peek-2">{l2}</span>}</p>
      <div className="ct-peek-k">
        {keys.check != null
          ? <Btn primary verb="card-check" onClick={onCheck}>{checkWords(keys.check)}</Btn>
          : <Btn primary verb="card-post" disabled={!keys.slot || !keys.ready} onClick={keys.post}
            aria-label={keys.slot ? `Post: approve and schedule ${slotWords(keys.slot.at)}` : 'Post'}>
            {keys.slot ? postWords(keys.slot.at) : 'Post'}</Btn>}
        <Btn verb="card-open" onClick={onOpen}>Open</Btn>
      </div>
    </div>
  )
}
