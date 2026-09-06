/* ==========================================================================
   src/wb/ask/AskPane.tsx: S15, the docked desktop Ask pane.

   The point is parity of the THREAD, not a second desktop design, so the body
   is `AskThread` again, the same turn states as the phone. What the desktop
   adds is everything a docked pane needs and a phone does not: which model
   answers, whether the pane is live or has just failed, what travels with the
   next message, and a slash palette for the keyboard that is already there.

   Those capabilities were built in `src/exp/v2c/ChatPane.tsx` and this pane is
   where they land on the design system. The vocabulary is IMPORTED from that
   file rather than copied, so there is one palette and one model list; the
   rest is drawn on `src/ds`. ChatPane itself is untouched and still serves the
   `#exp/v2` shell, which is the only place it is reachable.

   Move 19 lands here too: the feed is the design system's own `Sheet`, which
   is where the sheet primitive gets its real job — nothing docks a horizontal
   pager on the desktop, so the sheet keeps its finger tracking, its snap, its
   scrim fading with the drag and its flick to dismiss.

   AskPane's props carry no `goJob`. A deep-linked feed row therefore navigates
   the way a fresh page load would: by writing the job onto the hash. The Shell
   already listens for `hashchange` at runtime, wired for exactly this, so this
   is not a new code path, only the same one entered from inside the running
   app instead of from a click on a URL.
   ========================================================================== */
import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Badge, Banner, Button, Chip, IconButton, LiveDot, Popover, PopoverItem, Sheet,
} from '../../ds'
import { Head } from '../kit'
import type { BrainAskPaneProps } from '../../exp/brain/types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { See } from './See'
import { usePalette } from './Palette'
import { useFeedData } from '../../exp/brain/b/useFeedData'
import { getSelected, subscribe as subscribeRows } from '../../exp/v2c/commandStore'
import {
  EMPTY_SEE, buildSeeBlock, selectionSubject, type SeeState,
} from '../../exp/v2c/chat/paneContext'
import { transportIsMock } from '../../exp/v2c/chat/transport'
import { CLAUDE_MODELS } from '../../lib/claude'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import { wbHash } from '../../exp/v2c/route'
import type { Job } from '../../exp/v2c/layout'
import './ask.css'

// The container's own default is a real, working choice and the FIRST entry,
// not an "auto" fallback tucked at the bottom. Today it is also the only one
// that completes a turn, so burying it would be burying the working option.
const MODEL_OPTIONS: { id: string | null; label: string; note: string }[] = [
  { id: null, label: 'Claude default', note: 'Whatever Claude booted with' },
  ...CLAUDE_MODELS.map(m => ({ id: m.id as string, label: m.label, note: m.note })),
]

function modelLabel(id: string | null): string {
  if (!id || id === 'container-default') return 'default'
  const exact = MODEL_OPTIONS.find(m => m.id === id)
  if (exact) return exact.label
  // The container names itself with a dated id (`claude-haiku-4-5-20251001`).
  // Match the family so the pane says "Haiku 4.5" instead of printing a build
  // stamp, and fall back to the raw id rather than inventing a name.
  return MODEL_OPTIONS.find(m => m.id && id.startsWith(m.id))?.label ?? id
}

function navigateToJob(job: Job): void {
  location.hash = wbHash(job, null)
}

/** A content draft's title is a whole sentence; the pane names it once. */
function short(label: string, max = 52): string {
  if (label.length <= max) return label
  return `${label.slice(0, max - 1).replace(/[\s,.;:]+$/, '')}…`
}

export function AskPane({ chat, job, about, aboutContext, subjects = [], onClose, onOpenAbout, mobile }: BrainAskPaneProps) {
  const feed = useFeedData()
  const [feedOpen, setFeedOpen] = useState(false)
  const [models, setModels] = useState(false)
  // The turn a feed row names, so the docked pane lands on the same answer the
  // phone would (a `claude_turn` row's url carries `&turn=`), and the rect of
  // the card it came from, so it grows out of it (move 9).
  const [focusTurn, setFocusTurn] = useState<string | null>(null)
  const [morphFrom, setMorphFrom] = useState<DOMRect | null>(null)
  // The composer's text lives here because the palette is DERIVED from it and
  // never a second piece of state that could disagree with it.
  const [text, setText] = useState('')
  const palette = usePalette(chat, text, setText)

  // Which chips are switched off, and which are opened up. Held here and not
  // persisted: "off" is a per-conversation decision, and a stale off-list keyed
  // on rows that have since scrolled away would detach things nobody chose to.
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const picked = useSyncExternalStore(subscribeRows, getSelected)
  const allSubjects = useMemo(() => {
    const sel = selectionSubject(picked.map(r => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      // The store keeps the database value; a lane reaches a reader by its
      // name, here as everywhere else since the label purge.
      lane: r.lane ? LANE_LABEL[r.lane as ContentLane] ?? r.lane : undefined,
    })))
    return sel ? [...subjects, sel] : subjects
  }, [subjects, picked])
  const seeBlock = buildSeeBlock(allSubjects, see)

  const mock = transportIsMock()
  const lastTurn = chat.turns[chat.turns.length - 1]
  const lastErr = !!lastTurn?.error
  // The honest-degrade state. A picked model the container refused leaves the
  // selection ALONE: silently reverting it would be the app choosing and then
  // hiding that it did. It says what happened and offers the one thing that
  // works.
  const modelRefused = lastErr && /model/i.test(lastTurn.error!.message) && chat.wanted !== null

  return (
    <div className="a-brain-desktop">
      <Head
        title="Ask"
        // The one fact worth a subtitle is WHICH MODEL is answering: before a
        // turn the pane names the model that WILL run, after one it names what
        // actually answered.
        sub={chat.model
          ? modelLabel(chat.model)
          : chat.wanted ? `${modelLabel(chat.wanted)} · next turn` : 'Claude default'}
        lead={mobile ? <IconButton icon="back" label="Back" onClick={onClose} /> : undefined}
        tail={
          <>
            {/* Live, busy, or the last turn failed. Three states, one mark. */}
            {chat.busy
              ? <LiveDot label="Claude is working" />
              : <span className="a-brain-dot" data-state={lastErr ? 'error' : 'ready'} role="status" aria-label={lastErr ? 'The last turn failed' : 'Ready'} />}
            {mock && <Chip tone="quiet">mock transport</Chip>}
            <span className="a-brain-modelbtn">
              <Button
                variant={chat.wanted ? 'outline' : 'quiet'} size="sm" iconEnd="disclose"
                aria-expanded={models}
                onClick={() => setModels(v => !v)}
              >{modelLabel(chat.wanted)}</Button>
              <Popover open={models} label="Choose the model for the next turn" className="a-brain-modelmenu">
                {MODEL_OPTIONS.map(m => (
                  <PopoverItem
                    key={m.id ?? 'default'}
                    icon={chat.wanted === m.id ? 'check' : undefined}
                    onClick={() => { chat.setWanted(m.id); setModels(false) }}
                    tail={<span className="a-dim">{m.note}</span>}
                  >{m.label}</PopoverItem>
                ))}
                {/* Stated once, where the choice is made, rather than
                    discovered by sending a turn that fails. */}
                <div className="a-brain-modelnote">
                  The pick applies to the next turn only. The pane shows what the
                  turn actually ran on, read back from the broker, never the pick.
                </div>
              </Popover>
            </span>
            <span className="a-brain-feedbtn">
              <IconButton
                icon="bell" label={`Feed, ${feed.unreadTotal} unread`}
                active={feedOpen}
                onClick={() => setFeedOpen(v => !v)}
              />
              {feed.unreadTotal > 0 && (
                <span className="a-brain-feedbtn-n">
                  <Badge tone="neutral" label={`${feed.unreadTotal} unread`}>
                    {feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}
                  </Badge>
                </span>
              )}
            </span>
            {!mobile && <IconButton icon="close" label="Close the Ask pane" onClick={onClose} />}
          </>
        }
      />

      {modelRefused && (
        <Banner
          tone="attention" icon="alert"
          action={<Button variant="quiet" size="sm" onClick={() => chat.setWanted(null)}>Use the Claude default</Button>}
        >{lastTurn.error!.message}</Banner>
      )}

      {/* The context card, phone only. On the desktop the strip below says the
          same thing and more, so keeping both named the same person twice in
          two registers. On the phone the card is not a label: it is the only
          half of the pair still on screen, and tapping it flips back. */}
      {about && mobile && (
        <button
          type="button" className="a-brain-about" data-tap={onOpenAbout ? '' : undefined}
          onClick={onOpenAbout ?? undefined} disabled={!onOpenAbout}
        >
          <span className="a-dim">Asking about</span>
          <span className="a-nowrap">{short(about)}</span>
        </button>
      )}

      <See subjects={allSubjects} see={see} setSee={setSee} />

      <AskThread
        chat={chat} job={job} about={aboutContext ?? about} mobile={mobile}
        focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
        morphFrom={morphFrom} onMorphed={() => setMorphFrom(null)}
        onDragBack={() => { setFocusTurn(null); setFeedOpen(true) }}
        composerExtras={palette}
        see={seeBlock}
        text={text} onText={setText}
      />

      <Sheet
        open={feedOpen}
        onClose={() => setFeedOpen(false)}
        title="Feed"
        sub={`${feed.unreadTotal} unread`}
        className="a-brain-feedsheet"
      >
        <Feed
          feed={feed}
          goJob={navigateToJob}
          openThread={(id, turn, from) => {
            chat.openThread(id)
            setFocusTurn(turn ?? null)
            setMorphFrom(from ?? null)
            setFeedOpen(false)
          }}
          onNavigated={() => setFeedOpen(false)}
        />
      </Sheet>
    </div>
  )
}
