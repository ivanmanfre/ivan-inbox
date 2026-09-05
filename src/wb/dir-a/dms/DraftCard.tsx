/* ==========================================================================
   src/wb/dir-a/dms/DraftCard.tsx — S35: the list card and the two bars.

   Rebuilt from src/screens/DraftsScreen.tsx (DraftCard, StaleBar, PushedBar).
   Every write, every confirm sheet, the pointer swipe with its directional lock
   and its threshold, the zero-row race guard and every string are the ones that
   were there. What changed is the box: the card is a Group whose foot is the
   decision bar (one primary action, quiet siblings), and the two bars are
   Banners — attention only on the one that is holding something right now.
   ========================================================================== */
import { useRef, useState } from 'react'
import { Banner, Button, Icon } from '../../../ds'
import { Group, Row, Rows } from '../kit'
import { Face, timeAgo } from './parts'
import { Linkified } from '../../../components/Linkified'
import { useConfirm } from '../../../components/ConfirmSheet'
import { returnsIn, usePushLater } from '../../../components/PushLaterSheet'
import {
  approveDraft, discardDraft, emailSenderLabel, isFollowUp, snoozeDraft, threadChatId, type Thread,
} from '../../../lib/inbox'
import './dms.css'

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

  return (
    <div
      className="a-dms-swipe"
      data-dragging={dragging ? '' : undefined}
      style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform var(--ds-dur) var(--ds-ease)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Group
        foot={
          /* Three decisions, one of them loud. The loud one is the one that puts
             a message in front of a person. */
          <div className="a-dms-acts">
            <Button variant="quiet" onClick={() => onOpenThread(thread.prospect_id)}>Edit</Button>
            <Button variant="quiet" onClick={handlePushLater}>Later</Button>
            <span className="a-grow" />
            <Button variant="primary" busy={busy} icon="send" onClick={handleApprove}>
              {busy ? 'Sending…' : 'Approve & send'}
            </Button>
          </div>
        }
      >
        <Rows>
          <Row
            lead={<Face name={thread.prospect_name} />}
            title={thread.prospect_name}
            sub={`${clientTitle(thread.client_id)} · ${channelLabel(thread.channel)} · ${isFollowUp(draft) ? 'follow-up' : thread.stage} ${timeAgo(draft.created_at)}`}
            tail={<span className="a-mono">{timeAgo(draft.created_at)}</span>}
          />
        </Rows>
        <div className="a-dms-cardbody">
          {thread.draftStale && (
            <Banner tone="attention" icon="alert">
              You already replied after their last message — probably not needed
            </Banner>
          )}
          {draft.recipient_email && (
            <div className="a-stack" data-tight>
              <span className="a-meta">
                Approving also sends this email to {draft.recipient_email}{emailSenderLabel(thread.client_id)}
              </span>
              {draft.email_mirror_text && (
                <div className="a-quote a-pre"><Linkified text={draft.email_mirror_text} /></div>
              )}
            </div>
          )}
          {/* The body IS the way in: tapping it opens the thread, which is where
              the draft is edited. */}
          <button
            type="button"
            className="a-dms-tap"
            onClick={() => onOpenThread(thread.prospect_id)}
          >
            <span className="a-pre a-body-t"><Linkified text={draft.message_text} /></span>
            <span className="a-dms-cue"><Icon name="edit" size={16} />Tap to edit</span>
          </button>
          {error && (
            <Banner tone="urgent" icon="error">{error}</Banner>
          )}
        </div>
      </Group>
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

  /* Attention, because these drafts are being HELD right now: each one is a
     message queued against a conversation that has already been answered. */
  return (
    <Banner
      tone="attention"
      icon="alert"
      title={`${stale.length} draft${stale.length === 1 ? '' : 's'} where you already replied`}
      action={
        <Button variant="quiet" busy={busy} disabled={busy} onClick={discardAllStale}>
          {busy ? 'Discarding…' : 'Discard stale'}
        </Button>
      }
    />
  )
}

// What he pushed away, and when it comes back. Without this the parked drafts
// are only findable by scrolling "All" and spotting a muted pill — which is how
// a "later" quietly becomes a "never". One line, no bulk action: bringing a
// draft back is a per-thread decision, unlike discarding stale ones.
export function PushedBar({ pushed, onOpen }: { pushed: Thread[]; onOpen: (id: string) => void }) {
  if (pushed.length === 0) return null
  const next = [...pushed].sort((a, b) =>
    (a.draftSnoozedUntil ?? '').localeCompare(b.draftSnoozedUntil ?? ''))[0]
  /* Neutral: nothing here is stopped or failing. It is work that is parked on
     purpose, with a date. */
  return (
    <Banner
      icon="time"
      title={`${pushed.length} draft${pushed.length === 1 ? '' : 's'} pushed to later · next `
        + `is ${next.prospect_name.split(' ')[0]}, ${returnsIn(next.draftSnoozedUntil!)}`}
      action={<Button variant="quiet" onClick={() => onOpen(next.prospect_id)}>Open</Button>}
    />
  )
}
