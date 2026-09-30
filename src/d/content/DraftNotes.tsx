import {
  STAGE_LABEL, normalizeImageUrls, normalizeSourceDetail, taxonomyValue,
  type ContentDraftDetail, type ContentStage,
} from '../../lib/content'
import { absTime, postTime, relOrAhead } from '../../exp/v2c/fmt'
import { POSS, type Lane } from './model'

// What today's draft window says ABOVE and BELOW the post, in today's words
// (wb/draft/index.tsx): the internal-only hold, every editorial hold, the
// topic subline, the error banner with its flipped-at (or "errored once and
// recovered"), the client "No image yet" note, and why a client row has no
// board or edit key. Nothing here writes.

/** "Posts 10:45 Thu · in 2d" (or "Post time …" once the slot has passed), any lane with a date. */
export function postsChip(d: Pick<ContentDraftDetail, 'scheduled_at'>, now: number = Date.now()): string | null {
  if (!d.scheduled_at) return null
  return `${Date.parse(d.scheduled_at) > now ? 'Posts ' : 'Post time '}${postTime(d.scheduled_at)} · ${relOrAhead(d.scheduled_at)}`
}

export function internalOnly(d: ContentDraftDetail, stage: ContentStage): boolean {
  const src = normalizeSourceDetail(d.source_detail)
  return !!src?.internalOnly && stage !== 'approved' && stage !== 'scheduled' && stage !== 'published'
}

export function AboveThePost({ d, stage, lane }: { d: ContentDraftDetail; stage: ContentStage; lane: Lane }) {
  const src = normalizeSourceDetail(d.source_detail)
  const holds = src?.holds ?? []
  const errMsg = taxonomyValue(d.taxonomy, 'error_message')
  const errAt = taxonomyValue(d.taxonomy, 'error_flipped_at')
  const noImage = lane !== 'ivan' && normalizeImageUrls(d.image_urls).length === 0 && d.status === 'review'
  const bad = stage === 'error' || stage === 'stuck'
  if (!holds.length && !(d.title && d.topic && d.title !== d.topic) && !errMsg && !noImage) return null
  return (
    <div className="cn-above">
      {holds.length > 0 && (
        <ul className="cn-holds" aria-label="Holds">{holds.map((h, i) => <li key={i}>{h}</li>)}</ul>
      )}
      {d.title && d.topic && d.title !== d.topic && <p className="cn-topic">{d.topic}</p>}
      {errMsg && (bad ? (
        <p className="cn-banner" role="alert">{errMsg}{errAt && <small> · flipped {absTime(errAt)}</small>}</p>
      ) : (
        <p className="cn-dim">Errored once{errAt ? ` on ${absTime(errAt)}` : ''} and recovered: {errMsg}</p>
      ))}
      {noImage && (
        <p className="cn-dim">
          No image yet. This does not stop it going on the board — it stops the SCHEDULE later, which refuses a draft
          with no media. A regeneration clears the pinned image, so the photo has to be re-pinned before a date will take.
        </p>
      )}
    </div>
  )
}

/** Why a client row has no Put-on-board key, and why its copy cannot be edited (today's two notes). */
export function clientWhyNot(d: ContentDraftDetail, lane: Lane, stage: ContentStage, o: { promotable: boolean; unpromotable: boolean; editable: boolean }): string[] {
  if (lane === 'ivan') return []
  const out: string[] = []
  if (!o.promotable && !o.unpromotable) {
    out.push(d.status === 'error'
      ? `This one errored, and only a draft at Needs review can go on ${POSS[lane]} board. Fix or regenerate it on our side first, nothing here reaches him.`
      : `Not promotable at ${STAGE_LABEL[stage].toLowerCase()}, the database only promotes a draft that is still at Needs review.`)
  }
  if (!o.editable) {
    out.push(d.board_visible === true
      ? `${POSS[lane]} copy is only editable here at Needs review or Scheduled. Open his board to manage this visible copy.`
      : `This internal draft is ${STAGE_LABEL[stage].toLowerCase()}. Editing is available at Needs review or Scheduled; recover the generation here first.`)
  }
  return out
}
