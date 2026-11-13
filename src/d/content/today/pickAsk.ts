import { useEffect, useRef, useState } from 'react'
import { answerCard, rebaseCard, weaveCard, type CardQuestion } from '../../../lib/contentCard'
import { useToast } from '../../ui/toast'
import { refreshTodayCard, type LiveCard } from './store'

// The pick's row in Ivan's Review list (ReviewDesk): the card's one question and its in-place edit kept in step with
// the card (TodayCard.tsx says what the row shows).

/** The pick's question and the card kept in step with the row's edit. Runs on every row (hooks run either way); with
 *  no `card` it shows nothing and its save does nothing. `open` opens the row's in-place edit on `text` over `base`. */
export function usePickAsk(card: LiveCard | null | undefined, body: string, justSaved: boolean, open: (text: string, base: string) => void) {
  const toast = useToast()
  // The edit was opened by Add: saving it answers the question (the answer itself is kept at Add).
  const fromAsk = useRef<string | null>(null)
  const [asking, setAsking] = useState(false)
  // Only on the text the card holds and the row shows; gone the moment he saves (the card re-reads the new text).
  const q = card && !justSaved && (card.draft.post_body ?? '') === body ? card.question ?? null : null
  // What is on screen now, for a weave that answers after a refresh (another device may have changed the card).
  const onScreen = useRef({ day: card?.day, id: card?.draft.id, body, q })
  useEffect(() => { onScreen.current = { day: card?.day, id: card?.draft.id, body, q } })

  const add = async (question: CardQuestion, answer: string, busy: boolean) => {
    if (!card || asking || busy) return
    setAsking(true)
    const id = card.draft.id
    void answerCard(card.day, id, answer).catch(() => false)
    const shown = body
    let text = shown
    const failed = () => toast.show({ tone: 'failed', message: 'Could not add it. Edit the post yourself.' })
    try { text = await weaveCard(card.day, id, question.sha, answer) }
    catch { failed() }
    finally { setAsking(false) }
    // A completion for a card, text or question no longer on screen is dropped: never a proposal on old text.
    const now = onScreen.current
    if (now.day !== card.day || now.id !== id || now.body !== shown || now.q?.sha !== question.sha || now.q?.text !== question.text) {
      if (text !== shown) failed()
      return
    }
    fromAsk.current = answer
    open(text, shown)
  }
  /** The row's edit opened by hand: its save moves the card but answers nothing. */
  const manual = () => { fromAsk.current = null }
  const saved = (text: string) => {
    if (!card) return
    const answer = fromAsk.current
    fromAsk.current = null
    // The card follows the saved text, so Post posts what he just fixed; then one read confirms it.
    void rebaseCard(card.day, card.draft.id, text).catch(() => false)
      .then(() => answer ? answerCard(card.day, card.draft.id, answer, true).catch(() => false) : false)
      .then(() => refreshTodayCard())
  }
  return { q, asking, add, manual, saved }
}
