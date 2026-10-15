import { LANE_OWNER, taxonomyValue, type ContentDraft } from '../../lib/content'
import { boardStateOf } from '../../lib/clientBoardState'
import { label, typeLabel } from '../../lib/labels'
import type { Lane } from './model'

// THE CALENDAR'S TAGS (Ivan 2026-10-15: "I don't see the tags here, like what type of content it is",
// "Different content strategy: I don't see it", "have a tag that says 'On board', or if not on the
// board, no tag"). One read per post, off the same row fields the rest of the app shows:
//   · format   carousel_drafts.type through typeLabel (Text, Image, Carousel, Video), LM for a
//              lead-magnet post (calModel.isMagnetPost)
//   · aim      funnel_stage, the "Aim: Trust" the draft window prints
//   · pillar   taxonomy.pillar (Teardown, Authority, Case study ...)
//   · board    client lanes only: board_visible, the field every "On board" in the app reads
//              (weekModel, DraftWindow "On Mattan's board"); a post the client took off his panel
//              (operator_client_board_state veto) says so instead. Not on the board = no tag.
// Pure, cheap, read at render so a board-state refresh (every 2 min, on focus) shows at once.

export type BoardTag = 'on' | 'removed' | null
export type PostTags = { format: string; lm: boolean; aim: string | null; pillar: string | null; board: BoardTag; boardWord: string; boardTitle: string }

type TagRow = Pick<ContentDraft, 'id' | 'type' | 'taxonomy' | 'board_visible' | 'client_id' | 'published_at'> & { funnel_stage?: string | null }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The board tag for a client post. Ivan's own lane has no client board: always null. */
export function boardTagOf(r: Pick<TagRow, 'id' | 'board_visible'> | null | undefined, lane: Lane): BoardTag {
  if (!r || lane === 'ivan') return null
  const veto = boardStateOf(r.id)?.veto
  if (veto === 'post_removed' || veto === 'angle_swap') return 'removed'
  return r.board_visible === true ? 'on' : null
}

export function postTagsOf(r: TagRow | null | undefined, lane: Lane, lm = false): PostTags | null {
  if (!r) return null
  const aim = (r.funnel_stage ?? '').trim()
  const pillar = taxonomyValue(r.taxonomy, 'pillar')
  const board = boardTagOf(r, lane)
  // A pillar that reads the same as the aim ("Reach" twice) is one tag, not two.
  const pillarWord = pillar ? label(pillar) : null
  const aimWord = aim ? cap(aim) : null
  const owner = LANE_OWNER[lane] || 'the client'
  return {
    format: typeLabel(r.type),
    lm,
    aim: aimWord,
    pillar: pillarWord && pillarWord.toLowerCase() !== aimWord?.toLowerCase() ? pillarWord : null,
    board,
    boardWord: board === 'on' ? 'On board' : board === 'removed' ? `Removed by ${owner}` : '',
    boardTitle: board === 'on' ? `On ${owner}’s board: ${owner} can see it on his panel` : board === 'removed' ? `${owner} took this post off his board, so it will not publish` : '',
  }
}

/** One line for a title attribute / screen reader: "Text · Aim: Trust · Teardown · On board". */
export function tagsLine(t: PostTags | null): string {
  if (!t) return ''
  return [t.lm ? 'Lead magnet' : null, t.format, t.aim ? `Aim: ${t.aim}` : null, t.pillar, t.boardWord || null].filter(Boolean).join(' · ')
}
