import type { PendingCardState } from '../../wb/ops/usePendingCard'
import { Sheet } from '../ui/Sheet'

// A comment reply's secondary verbs, behind the card's ONE "More" key: emoji
// into the draft (one scrolling row, never a wrapped block), like their
// comment, the @ tag, and on Arch: Needs Davor and Mark handled (these two
// need no comment_id; the drafter's why sits on the card, ArchWhy.tsx). Desktop: a panel under the
// card. Phone: a bottom sheet.

const EMOJI = ['🙂', '😄', '😂', '😅', '😉', '😎', '🙌', '👏', '🤝', '🙏', '🔥', '💪', '🚀', '🎯', '💯', '✅', '⚡', '👍', '❤️', '🥂']

function MoreBody({ st, name, hasComment }: { st: PendingCardState; name: string; hasComment: boolean }) {
  const off = st.busy || st.drafting
  const first = name.split(' ')[0] || name
  return (
    <div className="op-more-b">
      {hasComment && <div className="op-emo" role="group" aria-label="Add an emoji to the draft">
        {EMOJI.map(e => (
          <button key={e} type="button" aria-label={e} data-verb="emoji" disabled={off} onClick={() => st.addEmoji(e)}>{e}</button>
        ))}
      </div>}
      {hasComment && <button type="button" className="op-mi" data-verb="like" disabled={st.liking || st.liked} onClick={() => void st.onLike()}>
        <b>{st.liked ? 'Liked their comment' : st.liking ? 'Liking…' : 'Like their comment'}</b>
        <small>{st.liked ? 'done, from the client seat' : 'one tap, from the client seat'}</small>
      </button>}
      {st.canTag && !st.isCloseOnly && (
        <button type="button" className="op-mi" data-verb="tag" aria-pressed={st.tag} disabled={st.busy} onClick={() => st.setTag(t => !t)}>
          <b>{st.tag ? `Tag ${first}` : 'No tag'}</b>
          <small>{st.tag
            ? (st.tagMayFail ? 'on: may not stick, hidden surname' : 'on: the reply opens with the @mention')
            : 'off: the reply posts without the @mention'}</small>
        </button>
      )}
      {st.isArchComment && (
        <button type="button" className="op-mi" data-verb="needs-davor" disabled={off || st.needsDavor} onClick={() => void st.onNeedsDavor()}>
          <b>{st.needsDavor ? 'Waiting on Davorin' : 'Needs Davor'}</b>
          <small>nothing posts, the card stays, marked for him</small>
        </button>
      )}
      {st.isArchComment && (
        <button type="button" className="op-mi" data-verb="mark-handled" disabled={off} onClick={() => void st.onMarkHandled()}>
          <b>Mark handled</b>
          <small>closes it, nothing is posted</small>
        </button>
      )}
    </div>
  )
}

export function More({ st, name, layout, open, onClose, hasComment }: {
  st: PendingCardState; name: string; layout: 'desktop' | 'phone'; open: boolean; onClose: () => void
  /** The comment has a LinkedIn id: emoji and like need it; Arch's Davor / handled keys do not. */
  hasComment: boolean
}) {
  if (layout === 'phone') {
    return (
      <Sheet open={open} onClose={onClose} side="bottom" title={`More for ${name || 'this card'}`} className="op-moresheet">
        <MoreBody st={st} name={name} hasComment={hasComment} />
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <section className="op-more" aria-label={`More for ${name}`}>
      <div className="op-cap">More for {name || 'this card'}</div>
      <MoreBody st={st} name={name} hasComment={hasComment} />
    </section>
  )
}
