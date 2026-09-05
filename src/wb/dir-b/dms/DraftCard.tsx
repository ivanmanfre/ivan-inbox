import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Avatar, Banner, Button, Card, Icon, spring, fadeT } from '../../../ds'
import { Linkified } from '../../../components/Linkified'
import { useConfirm } from '../../../components/ConfirmSheet'
import { returnsIn, usePushLater } from '../../../components/PushLaterSheet'
import {
  approveDraft, discardDraft, emailSenderLabel, isFollowUp, snoozeDraft, threadChatId, type Thread,
} from '../../../lib/inbox'
import './dms.css'

// Direction B copy of the three pieces src/screens/DraftsScreen.tsx exports:
// DraftCard, StaleBar and PushedBar (S35). Every hook, every write, every
// guard and every string travels unchanged; only the view is rebuilt on the
// design system.
//
// The swipe is the original's, byte for byte — the same pointer handlers, the
// same directional lock, the same 72px threshold, the same confirm sheets. What
// Direction B adds is what the gesture LOOKS like: the action it is about to run
// is revealed UNDER the card (BeUI Swipeable List), a tick draws in place once
// the threshold is passed (Todo List Item, uiverse), and the card travels on the
// one spring instead of a 200ms ease.

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

function clientTitle(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function channelLabel(c: Thread['channel']): string {
  if (c === 'email') return 'Email'
  if (c === 'linkedin_inmail') return 'InMail'
  return 'LinkedIn'
}

const SWIPE_THRESHOLD = 72

/** The tick that draws itself the moment a swipe passes its threshold. */
function Tick() {
  return <span className="dirb-tick"><Icon name="check" size={20} /></span>
}

// Pointer-based swipe: works with both touch and mouse (so the card is usable
// on desktop too). A directional lock decides on the first move whether the
// gesture is a horizontal swipe (we take it) or a vertical scroll (we bail),
// so the list still scrolls normally under your finger.
export function DraftCard({ thread, onOpenThread, refresh }: {
  thread: Thread; onOpenThread: (id: string) => void; refresh: () => void
}) {
  const draft = thread.draft!
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const pushLater = usePushLater()
  const start = useRef({ x: 0, y: 0 })
  const axis = useRef<'none' | 'x' | 'y'>('none')
  const dxRef = useRef(0)

  function springBack() {
    dxRef.current = 0
    setDx(0)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (busy) return
    start.current = { x: e.clientX, y: e.clientY }
    axis.current = 'none'
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return
    const ddx = e.clientX - start.current.x
    const ddy = e.clientY - start.current.y
    if (axis.current === 'none') {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return
      // Lock to whichever direction dominated the first few pixels.
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'
      if (axis.current === 'x') e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (axis.current !== 'x') return
    dxRef.current = ddx
    setDx(ddx)
  }

  async function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    const final = axis.current === 'x' ? dxRef.current : 0
    axis.current = 'none'
    if (final > SWIPE_THRESHOLD) await handleApprove()
    else if (final < -SWIPE_THRESHOLD) await handleDiscard()
    else springBack()
  }

  async function handleApprove() {
    if (busy) return
    const ok = await confirm({
      title: `Send to ${thread.prospect_name}?`,
      message: 'The sender picks it up within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) { springBack(); return }
    setBusy(true)
    setError(null)
    try {
      await approveDraft(draft.id, draft.message_text, threadChatId(thread))
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve draft')
      springBack()
    } finally {
      setBusy(false)
    }
  }

  // "Later" on the list card. No swipe gesture is bound to it on purpose: a
  // swipe is a one-motion commit, and this decision needs a date before it means
  // anything. Left/right keep meaning discard/approve exactly as the hint says.
  async function handlePushLater() {
    if (busy) return
    const until = await pushLater(thread.prospect_name)
    springBack()
    if (!until) return
    setBusy(true)
    setError(null)
    try {
      await snoozeDraft(draft.id, until)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not push this draft')
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard() {
    if (busy) return
    const ok = await confirm({
      title: `Discard this draft?`,
      message: `It won't be sent to ${thread.prospect_name}.`,
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) { springBack(); return }
    setBusy(true)
    setError(null)
    try {
      // A zero-row update is not an error and it is not a discard. See the same
      // guard on the thread's onDiscard: an already-approved row is refused,
      // and saying nothing here would claim a send was stopped when it was not.
      const stopped = await discardDraft(draft.id)
      if (!stopped) {
        setError('This one was already approved and is in the send queue, so the '
          + 'discard did not stop it. Nothing was changed.')
        springBack()
      }
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard draft')
      springBack()
    } finally {
      setBusy(false)
    }
  }

  const past = Math.abs(dx) > SWIPE_THRESHOLD
  const side = dx > 0 ? 'right' : 'left'

  return (
    <div className="dirb-draftwrap">
      {/* The action the gesture is about to run, revealed under the card. */}
      <AnimatePresence>
        {dx !== 0 && (
          <motion.div
            className="dirb-dmunder"
            data-side={side}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: fadeT }}
            transition={fadeT}
          >
            {past ? <Tick /> : <Icon name={side === 'right' ? 'send' : 'discard'} size={20} />}
            <span className="ds-t-meta">{side === 'right' ? 'Approve & send' : 'Discard'}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        animate={{ x: dx }}
        transition={dragging ? { duration: 0 } : spring}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Card
          className="dirb-lift"
          lead={<Avatar name={thread.prospect_name} live={thread.unread > 0} tint={2} />}
          title={thread.prospect_name}
          sub={`${clientTitle(thread.client_id)} · ${channelLabel(thread.channel)} · ${isFollowUp(draft) ? 'follow-up' : thread.stage} ${timeAgo(draft.created_at)}`}
          tail={<span className="ds-t-mono dirb-dim">{timeAgo(draft.created_at)}</span>}
          foot={
            <div className="dirb-acts">
              <Button variant="quiet" size="sm" onClick={() => onOpenThread(thread.prospect_id)}>Edit</Button>
              <Button variant="quiet" size="sm" onClick={handlePushLater}>Later</Button>
              <span className="dirb-acts-end">
                <Button variant="primary" size="sm" busy={busy} onClick={handleApprove}>
                  {busy ? 'Sending…' : 'Approve & send'}
                </Button>
              </span>
            </div>
          }
        >
          {thread.draftStale && (
            <span className="ds-t-meta dirb-warn">
              You already replied after their last message — probably not needed
            </span>
          )}
          {draft.recipient_email && (
            <div className="dirb-inset dirb-col">
              <span className="ds-t-meta dirb-dim">
                Approving also sends this email to {draft.recipient_email}{emailSenderLabel(thread.client_id)}
              </span>
              {draft.email_mirror_text && (
                <div className="ds-t-body dirb-clamp3"><Linkified text={draft.email_mirror_text} /></div>
              )}
            </div>
          )}
          <div
            className="dirb-quote dirb-draftbody ds-t-body"
            onClick={() => onOpenThread(thread.prospect_id)}
          >
            <Linkified text={draft.message_text} />
            <div className="ds-t-meta dirb-dim">Tap to edit</div>
          </div>
          {error && <Banner tone="urgent" icon="alert">{error}</Banner>}
        </Card>
      </motion.div>
    </div>
  )
}

// The bulk exit from the stale-draft class (Ivan already answered in the
// LinkedIn app, so the queued AI reply is answering a handled message).
export function StaleBar({ stale, refresh }: { stale: Thread[]; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  if (stale.length === 0) return null

  async function discardAllStale() {
    const ok = await confirm({
      title: `Discard ${stale.length} stale draft${stale.length === 1 ? '' : 's'}?`,
      message: 'These threads already have your own reply after the last inbound message. Nothing is sent.',
      confirmText: 'Discard stale',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      for (const t of stale) await discardDraft(t.draft!.id)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Banner
      tone="attention"
      icon="alert"
      className="dirb-dmwrap"
      action={
        <Button variant="quiet" size="sm" busy={busy} onClick={discardAllStale}>
          {busy ? 'Discarding…' : 'Discard stale'}
        </Button>
      }
    >
      {stale.length} draft{stale.length === 1 ? '' : 's'} where you already replied
    </Banner>
  )
}

// What he pushed away, and when it comes back. One line, no bulk action:
// bringing a draft back is a per-thread decision, unlike discarding stale ones.
export function PushedBar({ pushed, onOpen }: { pushed: Thread[]; onOpen: (id: string) => void }) {
  if (pushed.length === 0) return null
  const next = [...pushed].sort((a, b) =>
    (a.draftSnoozedUntil ?? '').localeCompare(b.draftSnoozedUntil ?? ''))[0]
  return (
    <Banner
      tone="neutral"
      icon="timer"
      className="dirb-dmwrap"
      action={<Button variant="quiet" size="sm" onClick={() => onOpen(next.prospect_id)}>Open</Button>}
    >
      {pushed.length} draft{pushed.length === 1 ? '' : 's'} pushed to later · next
      is {next.prospect_name.split(' ')[0]}, {returnsIn(next.draftSnoozedUntil!)}
    </Banner>
  )
}

