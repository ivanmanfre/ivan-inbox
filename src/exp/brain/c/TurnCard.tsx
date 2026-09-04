import { ChatTurn } from '../../v2c/ChatMessage'
import { detectLinks } from '../../../lib/unfurl'
import { LinkPreviewCard } from './LinkPreviewCard'
import { sourceBasenames, sourcesChipLabel } from './brainVisibility'
import { extractRecallNouns, recallPrompt } from './recall'
import { isThreadBusy, THREAD_BUSY_COPY, type AugmentedTurn } from './turnAugment'
import { useState } from 'react'
import type { ChatHandle } from '../../v2c/useChat'

// One bubble in the column, either a user "ask" or Claude's answer. This is the
// candidate's own wrapper around the shared ChatTurn renderer (imported, not
// forked), it adds the brain-visibility footer (sources chip, recall chips)
// and overrides the one case ChatTurn's shared copy table cannot know:
// `thread_busy`, minted after that table shipped.
export function TurnCard({ turn, chat, openTurnId, isLastAssistant }: {
  turn: AugmentedTurn
  chat: ChatHandle
  /** The one turn id, if any, that is genuinely open right now (busy or running-elsewhere). */
  openTurnId: string | null
  isLastAssistant: boolean
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  if (turn.role === 'user') {
    const links = detectLinks(turn.text)
    const openTurn = turn.id === openTurnId
    return (
      <div className="brc-entry brc-entry-turn" data-stream-key={`t:${turn.id}`}>
        <ChatTurn turn={turn} />
        {links.map(l => <LinkPreviewCard key={l.url} url={l.url} />)}
        {openTurn && (
          <div className="brc-running">
            <span className="brc-running-dots"><i /><i /><i /></span>
            <span className="brc-running-t">
              Working. It keeps going if you lock the phone, you will get a notification.
            </span>
          </div>
        )}
      </div>
    )
  }

  // Assistant turn. thread_busy is a code the shared copy table (lib/claude.ts)
  // predates, so it resolves to "Claude failed for an unrecognised reason." ,
  // wrong: the thread is not broken, it is queued behind another turn. Clone
  // with the right words and retryable:false, which is also what suppresses
  // ChatTurn's own Retry button (it only renders when error.retryable is true).
  const busy = isThreadBusy(turn)
  const display: AugmentedTurn = busy
    ? { ...turn, error: { message: THREAD_BUSY_COPY, retryable: false } }
    : turn
  const nouns = display.text ? extractRecallNouns(display.text) : []
  const basenames = display.sources?.length ? sourceBasenames(display.sources) : []

  return (
    <div className="brc-entry brc-entry-turn" data-answer data-turn={turn.turnId ?? turn.id} data-stream-key={`t:${turn.id}`}>
      <ChatTurn turn={display} onRetry={isLastAssistant && !busy ? chat.retry : undefined} />
      {display.text && (basenames.length > 0 || nouns.length > 0) && (
        <div className="brc-brain">
          {basenames.length > 0 && (
            <button
              type="button" className="brc-chip brc-sources" data-sources
              aria-expanded={sourcesOpen}
              onClick={() => setSourcesOpen(v => !v)}
            >
              {sourcesChipLabel(display.sources ?? [])}
            </button>
          )}
          {sourcesOpen && basenames.length > 0 && (
            <div className="brc-sources-list">
              {basenames.map(b => <span className="brc-source-f" key={b}>{b}</span>)}
            </div>
          )}
          {nouns.map(n => (
            <button
              key={n} type="button" className="brc-chip brc-recall" data-recall
              onClick={() => void chat.send(recallPrompt(n))}
            >recall {n}</button>
          ))}
        </div>
      )}
    </div>
  )
}
