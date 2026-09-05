/* ==========================================================================
   src/wb/draft/actions.tsx — the draft window's writes (S16-12 to S16-30,
   S16-37), on the design system.

   Ported from src/exp/v2c/DraftPane.tsx. Every write, every confirm, every
   guard, every busy label and every string is the one that was there. What
   changed is that each of these is now a ds Button, a ds Chip and a Banner
   rather than seven hand-rolled button classes that measured identical and
   varied only in fill.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Banner, Button, Chip, Input, Textarea } from '../../ds'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  LANE_POSSESSIVE, clientDeletable, deleteClientDraft, deleteDraft, listStills,
  normalizeImageUrls, restartDraftToIdea, setDraftImage, STILL_FOLDERS,
  type ContentDraft, type ContentDraftDetail, type ContentLane, type Still, type StillFolder,
} from '../../lib/content'
import { appendAgentNote, clearHumanEdit, planRegen, regenerateDraft, scheduleDraft } from '../../lib/studioActions'
import { absTime } from '../../exp/v2c/fmt'
import './draft.css'

/** A note the bar makes about what just happened, or refused to. */
function Say({ tone, children }: { tone?: 'attention' | 'urgent'; children: React.ReactNode }) {
  return <div className="a-dw-say" data-tone={tone}>{children}</div>
}

// ---------------------------------------------------------------------------
// REGENERATE (S16-27). It states the two conflicts instead of resolving them
// behind Ivan's back:
//  1. THE IMAGE. post-gen only writes image_urls when include_image='Yes', so
//     the default here is copy-only and a hand-pinned photo SURVIVES; asking
//     for a new image is a second, explicit button.
//  2. THE GUARD. db/025 stops a service_role write from overwriting a
//     human-edited body, so a regen on an edited row runs for ~8 minutes and
//     lands nothing. The window says so up front and offers the documented
//     escape hatch as its own deliberate act.
// ---------------------------------------------------------------------------
export function RegenDraft({ d, onDone, disabled }: {
  d: ContentDraftDetail; onDone: () => void; disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const plan = planRegen(d as unknown as ContentDraft)
  const hasImage = normalizeImageUrls(d.image_urls).length > 0
  // An `idea`-status row has never been generated, so "Regenerate" is the wrong
  // word for it.
  const first = d.status === 'idea' || d.status === 'suggestion'

  const run = async (withImage: boolean, clearGuard: boolean) => {
    setBusy(true); setErr(''); setNote('')
    try {
      if (clearGuard) await clearHumanEdit(d as unknown as ContentDraft)
      const p = await regenerateDraft(d as unknown as ContentDraft, withImage)
      setNote(
        `Firing ${p.postFormat}${p.includeImage === 'Yes' ? ' with a new image' : ' (copy only)'}. `
        + `The run takes minutes — the row sits in Generating until it lands.`,
      )
      setAsking(false)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the regeneration')
    } finally { setBusy(false) }
  }

  return (
    <>
      {note && <div className="a-dw-shelfrow"><Say>{note}</Say></div>}
      {err && <div className="a-dw-shelfrow"><Say tone="urgent">{err}</Say></div>}
      <Button variant="quiet" disabled={disabled} aria-expanded={asking} onClick={() => setAsking(a => !a)}>
        {first ? 'Generate' : 'Regenerate'}
      </Button>
      {asking && (
        <div className="a-dw-shelfrow a-dw-inline">
          <span className="a-dw-q">
            {first ? 'Run' : 'Re-run'} the pipeline for this {plan.postFormat.toLowerCase()}?
            {!first && ' It replaces the copy.'}
            {hasImage && !first && ' Your pinned image is kept unless you pick the image option.'}
          </span>
          {plan.blockedByGuard && (
            <Banner tone="attention" icon="alert">
              You edited this draft by hand, so the database guard will refuse to overwrite your
              words — the run would land nothing. “Replace my edit” clears that protection first.
            </Banner>
          )}
          <div className="a-dw-inline-a">
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
            <Button size="sm" busy={busy} onClick={() => run(false, false)}>
              {busy ? 'Firing…' : 'Copy only'}
            </Button>
            {d.type === 'single_image' && (
              <Button size="sm" disabled={busy} onClick={() => run(true, false)}>Copy + new image</Button>
            )}
            {plan.blockedByGuard && (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => run(false, true)}>
                Replace my edit
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// RESTART TO IDEA (S16-29). Regenerate re-runs the pipeline ON this row; this
// sends it back to the START, status='idea', so the whole chain re-derives it.
// The write, the Ivan-lane scope and the warning live in content.ts, which
// takes the confirm as an ARGUMENT — this component cannot skip the sheet.
// ---------------------------------------------------------------------------
export function RestartDraft({ d, onDone, disabled }: {
  d: ContentDraftDetail; onDone: () => void; disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const confirm = useConfirm()

  const run = async () => {
    setBusy(true); setErr(''); setNote('')
    try {
      const did = await restartDraftToIdea(d, confirm)
      if (did) {
        setNote('Back at Idea. The pipeline re-derives it from there — the row sits at Idea until it does.')
        onDone()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send it back to idea')
    } finally { setBusy(false) }
  }

  return (
    <>
      {note && <div className="a-dw-shelfrow"><Say>{note}</Say></div>}
      {err && <div className="a-dw-shelfrow"><Say tone="urgent">{err}</Say></div>}
      <Button variant="quiet" busy={busy} disabled={disabled} onClick={run}>
        {busy ? 'Sending back…' : 'Back to idea'}
      </Button>
    </>
  )
}

// ---------------------------------------------------------------------------
// SCHEDULE (S16-25).
//
// 🔴 This is the one affordance in this window that ARMS A PUBLISHER.
// status='scheduled' + scheduled_at is exactly what the n8n bridge picks up to
// put a post on LinkedIn, so the confirm says that in those words rather than
// calling it "scheduling". Ivan lane only, like every other write in this file.
// ---------------------------------------------------------------------------
function localNowPlus(hours: number): string {
  const t = new Date(Date.now() + hours * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`
}

export function ScheduleDraft({ d, onDone }: { d: ContentDraftDetail; onDone: () => void }) {
  const [when, setWhen] = useState(() => (d.scheduled_at
    ? localNowPlus((Date.parse(d.scheduled_at) - Date.now()) / 3600_000)
    : localNowPlus(24)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const confirm = useConfirm()
  const already = d.status === 'scheduled'

  const run = async () => {
    const at = new Date(when)
    if (Number.isNaN(at.getTime())) { setErr('That is not a time.'); return }
    const ok = await confirm({
      title: already ? 'Move this post?' : 'Put this post on LinkedIn?',
      message: `The publisher reads status='scheduled' and posts it at ${at.toLocaleString()}. `
        + 'This is not an internal mark — it arms the bridge that publishes.',
      confirmText: already ? 'Reschedule' : 'Schedule it',
    })
    if (!ok) return
    setBusy(true); setErr(''); setNote('')
    try {
      await scheduleDraft(d.id, at.toISOString())
      setNote(`Armed for ${at.toLocaleString()}.`)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not schedule it')
    } finally { setBusy(false) }
  }

  return (
    <div className="a-dw-sched">
      {err && <Say tone="urgent">{err}</Say>}
      {note && <Say>{note}</Say>}
      <div className="a-dw-sched-r">
        <Input
          type="datetime-local"
          label="Publish at"
          labelHidden
          mono
          value={when}
          onChange={e => setWhen(e.target.value)}
        />
        <Button busy={busy} onClick={run}>
          {busy ? 'Arming…' : already ? 'Reschedule' : 'Schedule'}
        </Button>
      </div>
      {d.scheduled_at && <Say>Currently set for {absTime(d.scheduled_at)}.</Say>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SWAP IMAGE (S16-28) — pick the post's photo out of the still library. It
// unfolds INSIDE the shelf, like the other confirms: a picker that opened its
// own modal on top of a modal would be the third layer of window on this
// screen.
// ---------------------------------------------------------------------------
export function SwapImage({ d, onDone, disabled }: {
  d: ContentDraftDetail; onDone: () => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [folder, setFolder] = useState<StillFolder>(STILL_FOLDERS[0])
  const [stills, setStills] = useState<Still[] | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const current = normalizeImageUrls(d.image_urls)[0] ?? null

  // Load on open, and again per folder. Not on mount: an operator who never
  // opens the picker should never pay three storage LISTs for it.
  useEffect(() => {
    if (!open) return
    let live = true
    setStills(null); setErr('')
    listStills(folder)
      .then(s => { if (live) setStills(s) })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Could not read the library.') })
    return () => { live = false }
  }, [open, folder])

  const pick = async (url: string | null) => {
    setBusy(url ?? 'none'); setErr('')
    try {
      await setDraftImage(d.id, url)
      setOpen(false)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The swap failed.')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Button variant="quiet" disabled={disabled} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {current ? 'Swap image' : 'Add image'}
      </Button>
      {open && (
        <div className="a-dw-shelfrow a-dw-swap">
          <div className="a-dw-swap-h">
            {STILL_FOLDERS.map(f => (
              <Chip key={f} selected={f === folder} onClick={() => setFolder(f)}>{f}</Chip>
            ))}
            <span className="a-grow" />
            {current && (
              <Button variant="quiet" size="sm" disabled={!!busy} onClick={() => pick(null)}>
                {busy === 'none' ? 'Removing…' : 'Remove photo'}
              </Button>
            )}
          </div>
          {err && <Say tone="urgent">{err}</Say>}
          {!stills && !err && <Say>Reading the library…</Say>}
          {stills && stills.length === 0 && <Say>Nothing in this folder.</Say>}
          {stills && stills.length > 0 && (
            <div className="a-dw-swap-g">
              {stills.map(s => (
                <button
                  key={s.url}
                  type="button"
                  aria-label={`Pin ${s.name}`}
                  title={s.name}
                  disabled={!!busy}
                  className="a-dw-tile"
                  data-on={s.url === current ? '' : undefined}
                  onClick={() => pick(s.url)}
                >
                  <img
                    src={s.thumb}
                    alt={s.name}
                    loading="lazy"
                    // The render endpoint is a paid storage feature. If it is
                    // ever off, the tile shows the original rather than a
                    // broken-image glyph in a picker.
                    onError={e => {
                      const el = e.currentTarget
                      if (el.src !== s.url) el.src = s.url
                    }}
                  />
                  {busy === s.url && <span className="a-dw-tile-b">Pinning…</span>}
                </button>
              ))}
            </div>
          )}
          {/* 🔴 The photo is not sticky. A regeneration clears image_urls, so a
              swap made BEFORE a regen is discarded by it. */}
          <Say>A regeneration clears the pinned image, so pin the photo after the copy is final.</Say>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DELETE (S16-30). Distinct from Skip: skip archives a review-stage row
// visibly; delete removes it from the surface entirely, at any stage. Ivan lane
// only; deleteDraft() carries the hard-DELETE-then-fallback contract. It rides
// at the far end of the shelf — the corner diagonally opposite Approve, so it
// is reachable without being where the thumb lands.
// ---------------------------------------------------------------------------
export function DeleteDraft({ d, onDone, disabled }: {
  d: ContentDraftDetail; onDone: () => void; disabled?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true); setErr('')
    try {
      await deleteDraft(d.id, d.taxonomy)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <>
      {err && <div className="a-dw-shelfrow"><Say tone="urgent">{err}</Say></div>}
      {/* Verb plus noun: a bare "Delete" beside six other verbs does not say
          what it removes. */}
      <Button variant="danger" disabled={disabled} aria-expanded={confirming}
        onClick={() => setConfirming(c => !c)}>
        Delete draft
      </Button>
      {confirming && (
        <div className="a-dw-shelfrow a-dw-inline">
          <span className="a-dw-q">Delete this draft? This removes it permanently.</span>
          <div className="a-dw-inline-a">
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" size="sm" busy={busy} onClick={run}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DELETE, on the CLIENT lane (S16-18).
//
// 🔴 The one place a delete can reach a paying client. The board's queue is a
// denormalised copy of the promoted drafts and only operator_set_board_visible
// rebuilds it, so deleting a row that is ON the board removes it from our side
// and leaves a full copy of it on his, with nothing scheduled to clean it up.
// deleteClientDraft refuses that case server-side; this component refuses it on
// the surface AND says why, because an affordance that is simply absent is what
// produced Ivan's message in the first place.
// ---------------------------------------------------------------------------
export function DeleteClientDraft({ d, lane, onDone }: {
  d: ContentDraftDetail; lane: ContentLane; onDone: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!clientDeletable(lane, d.board_visible)) {
    return (
      <Say>
        On {LANE_POSSESSIVE[lane]} board, so it can’t be deleted from here — his board keeps its own copy of
        every promoted post, and only taking it off the board rebuilds that copy. Take it off
        first, then delete.
      </Say>
    )
  }

  const run = async () => {
    setBusy(true); setErr('')
    try {
      await deleteClientDraft(d.id, d.taxonomy)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
      setBusy(false)
    }
  }

  return (
    <div className="a-dw-delzone">
      {err && <Say tone="urgent">{err}</Say>}
      {confirming ? (
        <div className="a-dw-inline">
          <span className="a-dw-q">
            Delete this draft? Mattan has never seen it, and this removes it permanently.
          </span>
          <div className="a-dw-inline-a">
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" size="sm" busy={busy} onClick={run}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>Delete draft</Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// THE NOTE COMPOSER (S16-37) — `append_agent_log`. The generation register is
// written BY agents; this is the one place a human writes back into it, which
// is what makes it a log rather than a transcript.
//
// 🔴 It is a SECONDARY control. It measured 331x50 as a full-width lime slab,
// 4.6x the area of Approve, spent on one of the least important acts on the
// screen. Adding a note takes the secondary weight and the width of its label.
// ---------------------------------------------------------------------------
export function NoteComposer({ id, onDone }: { id: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true); setErr('')
    try {
      await appendAgentNote('carousel_drafts', id, body)
      setText('')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the note')
    } finally { setBusy(false) }
  }
  return (
    <div className="a-dw-note-c">
      {err && <Say tone="urgent">{err}</Say>}
      <Textarea
        label="Add a note to the generation register"
        labelHidden
        value={text}
        placeholder="Add a note for future-you (⌘↵ to post)…"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
      />
      <div className="a-dw-inline-a">
        <Button size="sm" busy={busy} disabled={!text.trim()} onClick={send}>
          {busy ? 'Posting…' : 'Post note'}
        </Button>
      </div>
    </div>
  )
}
