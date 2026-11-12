import { useEffect, useRef, useState } from 'react'
import type { ContentDraft } from '../../../lib/content'
import { rebaseCard, setCardState, type TodayCard } from '../../../lib/contentCard'
import { dHash } from '../../route'
import { useFrame } from '../../shell/frame'
import { useToast } from '../../ui/toast'
import { warsawDayTime } from '../../ui/time'
import { usePendingDecisions } from '../decisions'
import { LinkedInCard } from '../v2/LinkedInCard'
import { GridPost } from '../v2/ReviewDesk'
import { checkWords, postWords, useCardKeys } from './keys'
import { isWaiting, patchTodayCard, refreshTodayCard, useTodayCard, type LiveCard } from './store'
import './today.css'

// CONTENT'S LANDING WHILE TODAY'S CARD WAITS (Ivan 2026-11-12). The whole post at reading size with its picture, and
// three keys: Post (the Review desk's one-tap key), Skip (asks nothing, marks the card skipped, the draft stays in
// Review untouched; Undo) and Fix (the Review grid's own in-place edit, compare-and-swap; Post then posts the fixed
// text). With no card, or once it is posted or skipped, Content lands on Plan as before (index.tsx).

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
  const startFix = () => { base.current = body; setFix(body) }
  const onSaved = (text: string) => {
    setSaved(text)
    // The card follows the saved text, so Post posts what he just fixed; then one read confirms it.
    void rebaseCard(card.day, r.id, text).catch(() => false).then(() => refreshTodayCard())
  }

  return (
    <article className="ct-card" data-card-id={r.id} data-today-card aria-label="Post for today">
      {editing
        ? <GridPost c={{ r, lane: 'ivan', title: r.title ?? '' }} body={body} text={fix} setText={setFix} base={base.current} canEdit
            onStart={startFix} onSaved={onSaved} onChanged={() => {}} />
        : <div className="ct-post"><LinkedInCard lane="ivan" body={body} images={r.image_urls} type={r.type} videoUrl={r.video_url ?? null} bare open expandable={false} /></div>}
      <div className="ct-keys">
        {keys.check != null
          ? <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-check" disabled={busy} onClick={() => f.navigate(dHash('content', 'now', { focus: r.id }))}>{checkWords(keys.check)}</button>
          : <button type="button" className="cv2-k cv2-k-p" data-key-main data-verb="card-post" disabled={busy || !keys.slot || !keys.ready} onClick={keys.post}
              title={editing ? 'Save or cancel your edit first' : undefined}>{keys.slot ? postWords(keys.slot.at) : 'Post'}</button>}
        <button type="button" className="cv2-k cv2-k-q" data-verb="card-skip" disabled={busy} title={editing ? 'Save or cancel your edit first' : undefined} onClick={skip}>Skip</button>
        <button type="button" className="cv2-k cv2-k-q" data-verb="card-fix" disabled={busy} onClick={startFix}>Fix</button>
      </div>
    </article>
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
