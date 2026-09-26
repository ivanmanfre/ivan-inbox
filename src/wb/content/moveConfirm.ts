import { LANE_OWNER, type ContentDraft, type ContentLane } from '../../lib/content'

// ---------------------------------------------------------------------------
// WHAT A CALENDAR MOVE REALLY DOES, said in the confirm.
//
// The move writes the date and nothing else. On Ivan's lane that is all it
// is. On a client lane it is not: both client publishers (RISE and ARCH) post
// any board-visible, unpublished row at review or scheduled once it has a
// date (clientScheduleArmed). So dating a post that is already on the client's
// board schedules it to go out, and the old confirm ("Status and board
// visibility stay as they are") hid that. The write is unchanged; only the
// words are.
// ---------------------------------------------------------------------------

export type MoveConfirm = { title: string; message: string; confirmText: string }

type MoveRow = Pick<ContentDraft, 'client_id' | 'board_visible' | 'status' | 'published_at'>

/** True when a date on this row makes the client's publisher post it. */
export function movePublishesForClient(r: MoveRow | null | undefined): boolean {
  return !!r
    && !!r.client_id
    && r.board_visible === true
    && !r.published_at
    && (r.status === 'review' || r.status === 'scheduled')
}

/**
 * The confirm for moving `r` to `day` at `time` (both already formatted for a
 * reader). A client post on the board gets the honest version; everything else
 * keeps the plain move.
 */
export function moveConfirmCopy(r: MoveRow | null | undefined, day: string, time: string): MoveConfirm {
  if (movePublishesForClient(r)) {
    const owner = LANE_OWNER[r!.client_id as ContentLane] || 'the client'
    return {
      title: 'Schedule this to post?',
      message:
        `This post is on ${owner}’s board, so a date means it goes out. `
        + `His publisher will post it on ${day} at ${time}. `
        + 'A weekend or a day that already has a post moves it to the next free weekday.',
      confirmText: 'Schedule to post',
    }
  }
  return {
    title: 'Move this post?',
    message: `Moves to ${day}. Status and board visibility stay as they are.`,
    confirmText: 'Move it',
  }
}
