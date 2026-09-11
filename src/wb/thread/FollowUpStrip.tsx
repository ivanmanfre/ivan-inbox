/* ==========================================================================
   src/wb/thread/FollowUpStrip.tsx — "Follow up on a date" on a conversation.

   Ivan, 2026-09-11 (Tessa Tysome, Cowshed: "catch up when I am back mid
   October"): "needs an option to draft a follow up in x date".

   Later (on the draft card) parks a draft that already exists. This asks for a
   NEW message on a day he names, with or without a draft on the thread. The
   stamp goes on the prospect (src/lib/followUp.ts); the RISE Reply Drafter
   writes the follow-up when the date arrives and it lands back here as an
   "AI follow-up" to approve. RISE and ARCH: those are the two drafters with
   the dated lane; a stamp nobody consumes would be a promise with no machine.

   2026-09-12 (Serg Safonov, Savvy KID: "remind in few weeks"; Ivan: "the ui
   should tell me reply and draft follow up in 2 weeks or so"): when the
   planner read the latest inbound as "come back later", the strip SAYS so and
   offers that date in one tap. Still his tap: the suggestion lives on the
   draft's evidence, the decision on the prospect row (followUpSuggestion).
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Banner, Button, Chip, Textarea } from '../../ds'
import { formatReturn, returnsIn, usePushLater } from '../../lib/pushLater'
import { clearFollowUp, fetchFollowUp, followUpSuggestion, setFollowUp, type FollowUp } from '../../lib/followUp'
import type { Thread } from '../../lib/inbox'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FollowUpStrip({ thread }: { thread: Thread }) {
  const [fu, setFu] = useState<FollowUp | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pushLater = usePushLater()
  const first = thread.prospect_name.split(' ')[0]
  const supported = thread.client_id === 'risedtc' || thread.client_id === 'arch'
  const suggested = fu ? null : followUpSuggestion(thread.draft?.draft_evidence)

  useEffect(() => {
    if (!supported) return
    let alive = true
    setLoaded(false); setErr('')
    fetchFollowUp(thread.prospect_id)
      .then(f => { if (alive) { setFu(f); setLoaded(true) } })
      .catch(e => { if (alive) { setErr(errText(e)); setLoaded(true) } })
    return () => { alive = false }
  }, [thread.prospect_id, supported])

  if (!supported || !loaded) return null

  async function stamp(until: string, note: string) {
    setBusy(true); setErr('')
    try {
      await setFollowUp(thread.prospect_id, until, note)
      setFu({ at: until, note: note.trim() || null })
      setOpen(false); setWhy('')
    } catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }

  async function onPick() {
    const until = await pushLater(thread.prospect_name, 'followup')
    if (!until) return
    await stamp(until, why)
  }

  /** The offered date, as read from their message. One tap, nothing sent. */
  async function onTakeSuggestion() {
    if (!suggested) return
    await stamp(suggested.at, suggested.why)
  }

  async function onClear() {
    setBusy(true); setErr('')
    try {
      await clearFollowUp(thread.prospect_id)
      setFu(null)
    } catch (e) { setErr(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="a-thread-followup">
      {fu ? (
        <div className="a-thread-followup-row">
          <Chip icon="time">Follow-up drafts {formatReturn(fu.at)}</Chip>
          <span className="a-dim a-thread-followup-note">
            {returnsIn(fu.at)}{fu.note ? ` · ${fu.note}` : ''}
            {` · if ${first} writes first, the date is dropped`}
          </span>
          <span className="a-grow" />
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setWhy(fu.note ?? ''); setOpen(true) }}>Change</Button>
          <Button variant="quiet" size="sm" busy={busy} onClick={busy ? undefined : onClear}>Clear</Button>
        </div>
      ) : suggested && !open ? (
        <Banner
          icon="time"
          title={`${first} asked to hear from you again later${suggested.dated ? `, around ${formatReturn(suggested.at)}` : ''}.`}
          action={<>
            <Button variant="primary" size="sm" busy={busy} onClick={busy ? undefined : onTakeSuggestion}>Follow up {formatReturn(suggested.at)}</Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setWhy(suggested.why); setOpen(true) }}>Another date</Button>
          </>}
        >
          {suggested.why ? `"${suggested.why}" · ` : ''}Send the reply now; on that date a follow-up is drafted for you to approve. If {first} writes first, the date is dropped.
        </Banner>
      ) : !open ? (
        <div className="a-thread-followup-row">
          <Button variant="quiet" size="sm" icon="time" onClick={() => setOpen(true)}>Follow up on a date</Button>
        </div>
      ) : null}
      {open && (
        <div className="a-thread-followup-form">
          <Textarea
            label="What the follow-up should pick up (optional)"
            placeholder="e.g. back mid October, we emailed the model, set the catch-up"
            value={why}
            onChange={e => setWhy(e.target.value)}
            disabled={busy}
            rows={2}
          />
          <div className="a-thread-acts">
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setOpen(false); setWhy('') }}>Cancel</Button>
            <Button variant="primary" size="sm" busy={busy} onClick={busy ? undefined : onPick}>Pick the date</Button>
          </div>
        </div>
      )}
      {err && <Banner tone="attention" icon="alert">{err}</Banner>}
    </div>
  )
}
