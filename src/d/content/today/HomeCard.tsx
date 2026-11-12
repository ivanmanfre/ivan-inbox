import { dHash } from '../../route'
import { useFrame } from '../../shell/frame'
import { CardPeek, useCardKeys } from './keys'
import { useCardBlockMounted, useTodayCard, type LiveCard } from './store'
import './today.css'

/** Today's post card at the top of Home while it waits: the same two lines and keys as the sliding toast. */
export function HomeCard() {
  const t = useTodayCard()
  return t.active && t.card?.draft ? <Live key={`${t.card.day}:${t.card.draft.id}`} card={t.card as LiveCard} version={t.version} /> : null
}

function Live({ card, version }: { card: LiveCard; version: number }) {
  const f = useFrame()
  const body = card.draft.post_body ?? ''
  const keys = useCardKeys(card, body, version)
  useCardBlockMounted()
  return (
    <section className="ct-home" aria-label="Post for today" data-bx-block>
      <CardPeek label="Post for today" body={body} keys={keys} onOpen={() => f.navigate(dHash('content', 'today'))}
        onCheck={() => f.navigate(dHash('content', 'now', { focus: card.draft.id }))} />
    </section>
  )
}
