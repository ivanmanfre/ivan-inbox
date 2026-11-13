import { useEffect, useState } from 'react'
import { dHash } from '../../route'
import { useFrame } from '../../shell/frame'
import { useToast } from '../../ui/toast'
import { CardPeek, useCardKeys } from './keys'
import { cardRoute, useCardBlockShown, useTodayCard, type LiveCard } from './store'
import './today.css'

// THE SLIDING POST CARD (Ivan 2026-11-12: "a sliding notif" inside the app, not only on the phone). When today's
// card is waiting it slides in on any screen, phone and desktop: on opening the app, or when the 11:00 card lands
// while the app is open (the store re-reads on the push). The post's first two lines, "Post · <day HH:MM>" (the
// Review desk's one-tap key) and Open (Ivan's Review list, the pick first). No timer: it leaves on Post, Open, the
// close mark or a sideways swipe. Closing writes nothing (the card is not skipped). Once per app open: never again on
// a route change, and not at all when the card is already on screen (the pick's row in Review, Home's card block). Loaded only while a card waits
// (Shell), so the shell stays light.

export const CARD_TOAST_ID = 'content-card'
/** The days whose card already slid in since the app opened (module memory: a reload is a new open). */
const slid = new Set<string>()
/** Tests only. */
export function resetSlidForTest(): void { slid.clear() }

export default function CardToast() {
  const t = useTodayCard()
  const { dismiss } = useToast()
  useEffect(() => () => dismiss(CARD_TOAST_ID), [dismiss])
  return t.active && t.card?.draft ? <Live key={`${t.card.day}:${t.card.draft.id}`} card={t.card as LiveCard} version={t.version} /> : null
}

function Live({ card, version }: { card: LiveCard; version: number }) {
  const f = useFrame()
  const { show, dismiss } = useToast()
  const body = card.draft.post_body ?? ''
  const keys = useCardKeys(card, body, version)
  // The card is already on screen (the pick's row in Ivan's Review list, Home's card block) or about to be (the route
  // that lands on it, before the list has read its rows).
  const shown = useCardBlockShown()
  const here = cardRoute(f.route, card.draft.id) || shown
  const [open, setOpen] = useState(false)
  const ready = !!keys.slot && keys.ready

  useEffect(() => {
    if (slid.has(card.day) || !ready) return
    slid.add(card.day)
    if (!here) setOpen(true)
  }, [ready, here, card.day])
  // The card opened some other way (the Content key, the push): the toast leaves.
  useEffect(() => { if (open && here) { dismiss(CARD_TOAST_ID); setOpen(false) } }, [open, here, dismiss])
  // When the card leaves (posted, skipped, changed), the component unmounts: the toast goes with it.
  useEffect(() => () => dismiss(CARD_TOAST_ID), [dismiss])

  const slotAt = keys.slot?.at.getTime() ?? null
  useEffect(() => {
    if (!open) return
    const leave = () => { dismiss(CARD_TOAST_ID); setOpen(false) }
    show({
      id: CARD_TOAST_ID, incoming: true, onClose: () => setOpen(false),
      message: <CardPeek body={body} keys={{ ...keys, post: () => { leave(); keys.post() } }}
        onOpen={() => { leave(); f.navigate(dHash('content', 'now', { focus: card.draft.id })) }}
        onCheck={() => { leave(); f.navigate(dHash('content', 'now', { focus: card.draft.id })) }} />,
    })
  }, [open, slotAt, keys.check, keys.ready, body]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
