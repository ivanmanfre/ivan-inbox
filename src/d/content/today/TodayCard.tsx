import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ContentDraft } from '../../../lib/content'
import { answerCard, rebaseCard, setCardState, weaveCard, type CardQuestion, type TodayCard } from '../../../lib/contentCard'
import { dHash } from '../../route'
import { useFrame } from '../../shell/frame'
import { useToast } from '../../ui/toast'
import { warsawDayTime } from '../../ui/time'
import { usePendingDecisions } from '../decisions'
import { LinkedInCard } from '../v2/LinkedInCard'
import { GridPost } from '../v2/ReviewDesk'
import { checkWords, postLabel, postWords, useCardKeys } from './keys'
import { isWaiting, patchTodayCard, refreshTodayCard, useTodayCard, type LiveCard } from './store'
import './today.css'

// CONTENT'S LANDING WHILE TODAY'S CARD WAITS (Ivan 2026-11-12). The whole post at reading size with its picture, and
// three keys: Post (the Review desk's one-tap key), Skip (asks nothing, marks the card skipped, the draft stays in
// Review untouched; Undo) and Fix (the Review grid's own in-place edit, compare-and-swap; Post then posts the fixed
// text). With no card, or once it is posted or skipped, Content lands on Plan as before (index.tsx).
// The one guided question (db/20261112b_content_card_question), when the card has one on its current text: one line
// above the post (beside it on a wide screen), a one-line input and Add. Add keeps his answer, asks content-card-weave for the post with it worked
// in, and opens Fix on that text; he reads it and saves it himself (the weave never writes the draft). A failed weave
// says so and opens Fix on the unchanged text, his answer still in the input. Post and Skip never wait on it.

/** The card on the page. Only drawn while the card waits (index.tsx checks isWaiting first). */
export function TodayCardView() {
  const t = useTodayCard()
  return isWaiting(t.card) ? <Live key={`${t.card.day}:${t.card.draft.id}`} card={t.card} version={t.version} /> : null
}

function Live({ card, version }: { card: LiveCard; version: number }) {
  const f = useFrame()
  const toast = useToast()
  const pending = usePendingDecisions()
  const r = card.draft as ContentDraft
  const [fix, setFix] = useState<string | null>(null)
  const base = useRef('')
  // The body just saved, shown until the next read carries it (the Review row's rule).
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => { setSaved(null) }, [r.post_body, r.updated_at])
  const body = saved ?? r.post_body ?? ''
  const keys = useCardKeys(card, body, version)
  const held = pending.has(r.id)
  const editing = fix !== null
  const busy = held || editing
  // The editor was opened by Add: saving it answers the question (the answer itself is kept at Add).
  const fromAsk = useRef<string | null>(null)
  const [asking, setAsking] = useState(false)
  const q = saved === null ? card.question ?? null : null
  // What is on screen now, for a weave that answers after a refresh (another device may have changed the card).
  const onScreen = useRef({ day: card.day, id: r.id, body, q })
  useEffect(() => { onScreen.current = { day: card.day, id: r.id, body, q } })

  const skip = () => {
    const before: TodayCard = card
    patchTodayCard({ ...card, state: 'skipped' })
    void setCardState(card.day, r.id, 'skipped').then(ok => {
      if (!ok) { patchTodayCard(before); toast.show({ tone: 'failed', message: 'Not skipped: the card changed. Nothing was written.' }); void refreshTodayCard(); return }
      toast.show({
        id: `card-skip-${card.day}`, message: 'Skipped for today. It stays in Review.',
        action: { label: 'Undo', verb: 'undo-card-skip', run: () => {
          void setCardState(card.day, r.id, 'shown').then(back => {
            if (!back) toast.show({ tone: 'failed', message: 'Could not bring the card back.' })
            void refreshTodayCard()
          }, () => { toast.show({ tone: 'failed', message: 'Could not bring the card back.' }); void refreshTodayCard() })
        } },
      })
    }, e => {
      patchTodayCard(before)
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'Not skipped.', action: { label: 'Retry', verb: 'retry', run: skip } })
    })
  }
  const startFix = () => { fromAsk.current = null; base.current = body; setFix(body) }
  const onSaved = (text: string) => {
    setSaved(text)
    const answer = fromAsk.current
    fromAsk.current = null
    // The card follows the saved text, so Post posts what he just fixed; then one read confirms it.
    void rebaseCard(card.day, r.id, text).catch(() => false)
      .then(() => answer ? answerCard(card.day, r.id, answer, true).catch(() => false) : false)
      .then(() => refreshTodayCard())
  }
  const add = async (question: CardQuestion, answer: string) => {
    if (asking || busy) return
    setAsking(true)
    void answerCard(card.day, r.id, answer).catch(() => false)
    const shown = body
    let text = shown
    const failed = () => toast.show({ tone: 'failed', message: 'Could not add it. Edit the post yourself.' })
    try { text = await weaveCard(card.day, r.id, question.sha, answer) }
    catch { failed() }
    finally { setAsking(false) }
    // A completion for a card, text or question no longer on screen is dropped: never a proposal on old text.
    const now = onScreen.current
    if (now.day !== card.day || now.id !== r.id || now.body !== shown || now.q?.sha !== question.sha || now.q?.text !== question.text) {
      if (text !== shown) failed()
      return
    }
    fromAsk.current = answer; base.current = shown; setFix(text)
  }

  return (
    <article className="ct-card" data-card-id={r.id} data-today-card data-editing={editing ? '' : undefined} aria-label="Post for today">
      <div className="ct-lay">
        {editing
          ? <GridPost c={{ r, lane: 'ivan', title: r.title ?? '' }} body={body} text={fix} setText={setFix} base={base.current} canEdit
              onStart={startFix} onSaved={onSaved} onChanged={() => {}} />
          : <div className="ct-post"><LinkedInCard lane="ivan" body={body} images={r.image_urls} type={r.type} videoUrl={r.video_url ?? null} bare open expandable={false} /></div>}
        {/* Keys in reach without scrolling: a column right of the post on a wide screen, else the question above the
            post and the keys pinned at the bottom (today.css). */}
        <div className="ct-side">
          {q && <Ask key={q.sha} q={q} busy={busy} adding={asking} onAdd={a => void add(q, a)} />}
          <div className="ct-keys">
            {keys.check != null
              ? <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-check" disabled={busy} onClick={() => f.navigate(dHash('content', 'now', { focus: r.id }))}>{checkWords(keys.check)}</button>
              : <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-post" disabled={busy || !keys.slot || !keys.ready} onClick={keys.post}
                  aria-label={keys.slot ? postLabel(keys.slot.at) : undefined} title={editing ? 'Save or cancel your edit first' : undefined}>{keys.slot ? postWords(keys.slot.at) : 'Post'}</button>}
            <button type="button" className="cv2-k cv2-k-q" data-verb="card-skip" disabled={busy} title={editing ? 'Save or cancel your edit first' : undefined} onClick={skip}>Skip</button>
            <button type="button" className="cv2-k cv2-k-q" data-verb="card-fix" disabled={busy || asking} onClick={startFix}>Fix</button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** The question, a one-line input (plain text, so the phone keyboard's dictation works) and Add. Nothing else. */
function Ask({ q, busy, adding, onAdd }: { q: CardQuestion; busy: boolean; adding: boolean; onAdd: (answer: string) => void }) {
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
