import type { PendingCardState } from '../../wb/ops/usePendingCard'
import { Sheet } from '../ui/Sheet'

// A comment reply's secondary verbs, behind the card's ONE "More" key: emoji
// into the draft (one scrolling row, never a wrapped block), like their
// comment, the @ tag, and on Arch: Needs Davor, Mark handled, and why the
// drafter said what it said with what it read. Desktop: a panel under the
// card. Phone: a bottom sheet.

const EMOJI = ['🙂', '😄', '😂', '😅', '😉', '😎', '🙌', '👏', '🤝', '🙏', '🔥', '💪', '🚀', '🎯', '💯', '✅', '⚡', '👍', '❤️', '🥂']

function MoreBody({ st, name }: { st: PendingCardState; name: string }) {
  const off = st.busy || st.drafting
  const first = name.split(' ')[0] || name
  return (
    <div className="op-more-b">
      <div className="op-emo" role="group" aria-label="Add an emoji to the draft">
        {EMOJI.map(e => (
          <button key={e} type="button" aria-label={e} data-verb="emoji" disabled={off} onClick={() => st.addEmoji(e)}>{e}</button>
        ))}
      </div>
      <button type="button" className="op-mi" data-verb="like" disabled={st.liking || st.liked} onClick={() => void st.onLike()}>
        <b>{st.liked ? 'Liked their comment' : st.liking ? 'Liking…' : 'Like their comment'}</b>
        <small>{st.liked ? 'done, from the client seat' : 'one tap, from the client seat'}</small>
      </button>
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
      {st.isArchComment && (st.archReason || st.archSrc.length > 0) && (
        <div className="op-why">
          <div className="op-cap">Why, and what it read</div>
          {st.archReason && <p>{st.archReason}</p>}
          {st.archOut === 'DRAFT' && st.archBasis && <p>Rests on: {st.archBasis}</p>}
          {st.archCaution && <p><i>Check first:</i> {st.archCaution}</p>}
          {st.archSrc.map(s => (
            <div className="op-src" key={s.id}>
              <span>{s.title}</span>
              <em>{s.source_type} · {s.public ? 'public' : 'private, context only'}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function More({ st, name, layout, open, onClose }: {
  st: PendingCardState; name: string; layout: 'desktop' | 'phone'; open: boolean; onClose: () => void
}) {
  if (layout === 'phone') {
    return (
      <Sheet open={open} onClose={onClose} side="bottom" title={`More for ${name || 'this card'}`} className="op-moresheet">
        <MoreBody st={st} name={name} />
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <section className="op-more" aria-label={`More for ${name}`}>
      <div className="op-cap">More for {name || 'this card'}</div>
      <MoreBody st={st} name={name} />
    </section>
  )
}
