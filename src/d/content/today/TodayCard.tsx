import { useState, type FormEvent } from 'react'
import type { CardQuestion, TodayCard } from '../../../lib/contentCard'
import { dHash } from '../../route'
import { warsawDayTime } from '../../ui/time'
import { useCardBlockMounted } from './store'
import './today.css'

// TODAY'S PICK IS THE FIRST ROW OF IVAN'S REVIEW LIST (Ivan 2026-11-13: one card alone "is worse than prev table list
// view"). While the card waits, Content and content/today land on Review, Ivan's seat, the pick first with a Today
// tag and its preview open (index.tsx, ReviewDesk). Its keys are the row's own. With no card, or once it is posted or
// skipped, Content lands on Plan as before.
// The one guided question (db/20261112b_content_card_question), when the card has one on the text the row shows: the
// question, a one-line input and Add, above the post. Add keeps his answer, asks content-card-weave for the post with
// it worked in, and opens the row's own in-place edit on that text; he reads it and saves it himself (the weave never
// writes the draft). A failed weave says so and opens the edit on the unchanged text, his answer still in the input.
// Any save of the pick's text (Add's or his own edit) moves the card to it, so the toast's Post posts what he fixed
// (pickAsk.ts).

/** The pick's row on screen: the toast does not slide in over it (store.useCardBlockMounted, as Home's block). */
export function PickMark() {
  useCardBlockMounted()
  return null
}

/** The question, a one-line input (plain text, so the phone keyboard's dictation works) and Add. Nothing else. */
export function Ask({ q, busy, adding, onAdd }: { q: CardQuestion; busy: boolean; adding: boolean; onAdd: (answer: string) => void }) {
  const [text, setText] = useState(q.answer ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const a = text.trim()
    if (a && !adding && !busy) onAdd(a)
  }
  return (
    <form className="ct-ask" data-card-ask onSubmit={submit}>
      <p className="ct-ask-q" id={`ct-ask-${q.sha.slice(0, 12)}`}>{q.text}</p>
      <div className="ct-ask-row">
        <input type="text" value={text} maxLength={1000} autoComplete="off" enterKeyHint="done" disabled={adding}
          aria-labelledby={`ct-ask-${q.sha.slice(0, 12)}`} onChange={e => setText(e.target.value)} />
        <button type="submit" className="cv2-k cv2-k-q" data-verb="card-ask-add" disabled={busy || adding || !text.trim()}>{adding ? 'Adding…' : 'Add'}</button>
      </div>
    </form>
  )
}

/** Content > today once the card is no longer waiting: one plain line over the Plan, so the push never lands on nothing. */
export function CardDoneLine({ card }: { card: TodayCard | null }) {
  if (!card) return null
  const d = card.draft
  const review = d ? dHash('content', 'now', { focus: d.id }) : dHash('content', 'now')
  const [text, href, link] =
    card.state === 'posted' ? [d?.scheduled_at ? `Scheduled for ${warsawDayTime(d.scheduled_at)}.` : 'Approved.', dHash('content', 'calendar'), 'Calendar']
      : card.state === 'skipped' ? ['Skipped for today. It stays in Review.', review, 'Review']
        : card.live === 'changed' ? ['This post changed after it was picked. It waits in Review.', review, 'Review']
          : card.live === 'decided' ? ['This post was already decided in Review.', dHash('content', 'calendar'), 'Calendar']
            : card.live === 'gone' ? ['This post is no longer in Review.', null, null]
              : [null, null, null]
  if (!text) return null
  return <p className="ct-done" role="status">{text}{href && <> <a href={href}>{link} →</a></>}</p>
}
