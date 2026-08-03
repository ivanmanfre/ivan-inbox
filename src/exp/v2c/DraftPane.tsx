import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  DraftSaveConflict, LANE_LABEL, STAGE_LABEL, approveDraft, deleteDraft, normalizeAgentLog,
  normalizeImageUrls, normalizeKeyPoints, normalizeQa, normalizeSourceDetail, reviewActionable,
  saveDraftBody, selfContainedHtml, skipDraft, stageOf, taxonomyExtras, taxonomyFields,
  taxonomyValue, type ContentDraft, type ContentDraftDetail, type ContentLane, type SaveConflict,
} from '../../lib/content'
import { appendAgentNote, clearHumanEdit, planRegen, regenerateDraft, scheduleDraft } from '../../lib/studioActions'
import { Block, KeyRows, Rows, Val } from './ContentBits'
import { AgentRegister, QaRegister } from './Register'
import { HtmlPreview, Takeover } from './Takeover'
import { LinkedInPost } from './LinkedInPost'
import { absTime, relOrAhead, relTime, typeLabel } from './fmt'
import { Failed } from './Surface'

// THE DRAFT TAKEOVER WINDOW, rebuilt to the dashboard-v2 standard.
//
// Ivan, 2026-08-03: "the content window when open each post to see is nothing
// like https://ivanmanfredi.com/dashboard-v2/?section=posts&sub=pipeline with
// the html preview editable and way better horizontal organization.. make it
// much better".
//
// MEASURED BEFORE: one 760px column, 9,040px of scroll at 1440 and 13,150px at
// 390 — eleven and seventeen screens. Everything that decides the draft's fate
// (the QA verdict, the source, the generation register, the actions) was below
// all of it.
//
// AFTER, ported from personal-site/components/dashboard-v2/review/
// PostWorkSurface.tsx's review reader:
//
//   ┌──────────┬────────────────────────┬──────────────────┐
//   │ 01 QUEUE │ 02 THE ARTIFACT        │ 03 THE EVIDENCE  │
//   │ the rows │ LinkedIn-faithful,     │ QA verdict,      │
//   │ j/k walks│ EDITABLE IN PLACE      │ source, register │
//   │          │ + the sticky decision  │ + a note you can │
//   │          │   bar                  │   write back     │
//   └──────────┴────────────────────────┴──────────────────┘
//
// Below 1180px it is ONE column in this deliberate order, stated so it is a
// decision and not an accident:
//
//   1. title + stage      — what am I looking at
//   2. the post card      — the words, editable; the decision is about these
//   3. the carousel strip — what ships with them
//   4. the decision bar   — approve / skip / edit, ~one screen in
//   5. QA verdict         — the score you check before deciding
//   6. rendered artifact, source, key points, description
//   7. the generation register + the note composer
//   8. dates, taxonomy, the long tail
//   9. THE QUEUE RAIL, LAST — on a phone you arrived here by tapping a row, so
//      the list is one back-tap away; twelve sibling titles above the post is
//      exactly the vertical scroll he complained about.
//
// WHAT IS BETTER THAN THE REFERENCE, deliberately:
//  · the preview IS the editor (there, `e` swaps the preview for a 16-row
//    textarea — you edit a different object from the one you read);
//  · the save refuses to clobber a body that moved underneath it (there,
//    saveDraft is a bare UPDATE … WHERE id, last writer wins, and this pipeline
//    has four engines that rewrite post_body on a schedule);
//  · the shortcuts carry a modifier guard. The reference matches bare `e.key`
//    outside a field, so ⌘A approves the draft and ⌘R rejects it.

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

// Google Drive /view URLs 302 into viewer HTML and never render in an <img>.
// The reference solves this in lib/driveThumb.ts; this is the same conversion.
export function imageSrc(url: string, size = 800): string {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size}` : url
}

// ---------------------------------------------------------------------------
// The queue rail — j/k made visible
// ---------------------------------------------------------------------------

export type QueueItem = { id: string; title: string; type: string | null; updated_at: string; status: string }

function QueueRail({ queue, id, onPick }: {
  queue: QueueItem[]; id: string; onPick: (id: string) => void
}) {
  const at = queue.findIndex(q => q.id === id)
  const ref = useRef<HTMLDivElement>(null)
  // Keep the current row in view when j/k walks past the fold — but ONLY when
  // the rail is its own scroller. Below 1180 the rail is the LAST block of the
  // window's single scroller, and scrollIntoView walks every ancestor: it
  // dragged the whole window down past the post to show a queue row nobody had
  // asked for. Measured on the 390 shot before this guard.
  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    el.querySelector('.dw-qrow.on')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  if (queue.length < 2) return null
  return (
    <aside className="dw-queue" ref={ref}>
      <div className="dw-queue-h">
        <span>In this queue</span>
        <b>{at >= 0 ? at + 1 : '–'}/{queue.length}</b>
      </div>
      {queue.map(q => (
        <button
          type="button"
          key={q.id}
          className={`dw-qrow${q.id === id ? ' on' : ''}`}
          onClick={() => onPick(q.id)}
        >
          <div className="dw-qrow-t">{q.title || 'Untitled'}</div>
          <div className="dw-qrow-m">{typeLabel(q.type)} · {relTime(q.updated_at)}</div>
        </button>
      ))}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// A collapsible inspect section, with its open state persisted
// ---------------------------------------------------------------------------

function Sec({ k, label, tail, open, toggle, children }: {
  k: string; label: string; tail?: ReactNode
  open: string[]; toggle: (k: string) => void; children: ReactNode
}) {
  const on = open.includes(k)
  return (
    <div className={`dw-sec${on ? ' on' : ''}`}>
      <button type="button" className="dw-sec-b" onClick={() => toggle(k)} aria-expanded={on}>
        <span className="dw-sec-n">{label}</span>
        {tail && <span className="dw-sec-t">{tail}</span>}
        <span className="dw-sec-c" aria-hidden>›</span>
      </button>
      {on && <div className="dw-sec-body">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// REGENERATE — unchanged contract, restyled into the actions drawer.
//
// It states the two conflicts instead of resolving them behind Ivan's back:
//  1. THE IMAGE. post-gen only writes image_urls when include_image='Yes', and
//     the old dashboard sent Yes for every single_image row — the "regen wipes
//     image_urls, re-pin the photo" trap. Here the default is copy-only, so a
//     hand-pinned photo SURVIVES, and asking for a new image is a second,
//     explicit button.
//  2. THE GUARD. db/025 stops a service_role write from overwriting a
//     human-edited body, so a regen on an edited row runs for ~8 minutes and
//     lands nothing. The window says so up front and offers the documented
//     escape hatch as its own deliberate act.
// ---------------------------------------------------------------------------

function RegenDraft({ d, onDone }: { d: ContentDraftDetail; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const plan = planRegen(d as unknown as ContentDraft)
  const hasImage = normalizeImageUrls(d.image_urls).length > 0
  // An `idea`-status row has never been generated, so "Regenerate" is the wrong
  // word for it — the reference's status machine calls that button Generate.
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

  if (!asking) {
    return (
      <div className="wb-delzone">
        {note && <div className="ct-subtle">{note}</div>}
        <button type="button" className="wb-editbtn" onClick={() => setAsking(true)}>
          {first ? 'Generate copy' : 'Regenerate copy'}
        </button>
      </div>
    )
  }
  return (
    <div className="wb-delzone">
      {err && <div className="ops-err">{err}</div>}
      <div className="wb-delconfirm">
        <span className="wb-delq">
          {first ? 'Run' : 'Re-run'} the pipeline for this {plan.postFormat.toLowerCase()}?
          {!first && ' It replaces the copy.'}
          {hasImage && !first && ' Your pinned image is kept unless you pick the image option.'}
        </span>
        {plan.blockedByGuard && (
          <div className="ct-subtle">
            ⚠ You edited this draft by hand, so the database guard will refuse to overwrite your
            words — the run would land nothing. “Replace my edit” clears that protection first.
          </div>
        )}
        <div className="ct-ac">
          <button type="button" className="btn s" disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button type="button" className="btn s" disabled={busy} onClick={() => run(false, false)}>
            {busy ? 'Firing…' : 'Copy only'}
          </button>
          {d.type === 'single_image' && (
            <button type="button" className="btn s" disabled={busy} onClick={() => run(true, false)}>
              Copy + new image
            </button>
          )}
          {plan.blockedByGuard && (
            <button type="button" className="btn wb-btn-danger" disabled={busy} onClick={() => run(false, true)}>
              Replace my edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCHEDULE — the reference's `Approve & schedule`, ported.
//
// 🔴 This is the one affordance here that ARMS A PUBLISHER. status='scheduled'
// + scheduled_at is exactly what the n8n Bridge (yzXqLDIpuNzuhUQq) picks up to
// put a post on LinkedIn, so the confirm says that in those words rather than
// calling it "scheduling". Ivan lane only, like every other write in this file.
// ---------------------------------------------------------------------------

function localNowPlus(hours: number): string {
  const t = new Date(Date.now() + hours * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`
}

function ScheduleDraft({ d, onDone }: { d: ContentDraftDetail; onDone: () => void }) {
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
    <div className="wb-delzone">
      {err && <div className="ops-err">{err}</div>}
      {note && <div className="ct-subtle">{note}</div>}
      <div className="dw-sched">
        <input
          type="datetime-local"
          value={when}
          aria-label="Publish at"
          onChange={e => setWhen(e.target.value)}
        />
        <button type="button" className="dw-key" disabled={busy} onClick={run}>
          {busy ? 'Arming…' : already ? 'Reschedule' : 'Schedule'}
        </button>
      </div>
      {d.scheduled_at && (
        <div className="ct-subtle">Currently set for {absTime(d.scheduled_at)}.</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DELETE — confirm inline. Distinct from Skip: skip archives a review-stage row
// visibly; delete removes it from the surface entirely, at any stage. Ivan lane
// only; deleteDraft() carries the hard-DELETE-then-fallback contract.
// ---------------------------------------------------------------------------

function DeleteDraft({ d, onDone }: { d: ContentDraftDetail; onDone: () => void }) {
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
    <div className="wb-delzone">
      {err && <div className="ops-err">{err}</div>}
      {confirming ? (
        <div className="wb-delconfirm">
          <span className="wb-delq">Delete this draft? This removes it permanently.</span>
          <div className="ct-ac">
            <button type="button" className="btn s" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn wb-btn-danger" disabled={busy} onClick={run}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="wb-delbtn" onClick={() => setConfirming(true)}>
          Delete draft
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The note composer — `append_agent_log`, the reference's AgentLogFeed footer.
// The generation register is written BY agents; this is the one place a human
// writes back into it, which is what makes it a log rather than a transcript.
// ---------------------------------------------------------------------------

function NoteComposer({ id, onDone }: { id: string; onDone: () => void }) {
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
    <div className="dw-note">
      {err && <div className="ops-err">{err}</div>}
      <textarea
        value={text}
        placeholder="Add a note for future-you (⌘↵ to post)…"
        aria-label="Add a note to the generation register"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
      />
      <div className="ct-ac">
        <button type="button" className="btn p" disabled={busy || !text.trim()} onClick={send}>
          {busy ? 'Posting…' : 'Post note'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

function Body({ d, lane, queue, refresh, onClose, onPick }: {
  d: ContentDraftDetail
  lane: ContentLane
  queue: QueueItem[]
  refresh: () => void
  onClose: () => void
  onPick: (id: string) => void
}) {
  const stage = stageOf(d)
  const tax = taxonomyFields(d.taxonomy)
  const extras = taxonomyExtras(d.taxonomy)
  const log = normalizeAgentLog(d.agent_log)
  const qa = normalizeQa(d.qa)
  const points = normalizeKeyPoints(d.key_points)
  const images = normalizeImageUrls(d.image_urls)
  const strength = scalar(d.topic_strength)
  const detail = normalizeSourceDetail(d.source_detail)
  const errMsg = taxonomyValue(d.taxonomy, 'error_message')
  const errAt = taxonomyValue(d.taxonomy, 'error_flipped_at')
  const reason = taxonomyValue(d.taxonomy, 'structure_reason')
  const authored = (d.authored_html ?? '').trim()
  const confirm = useConfirm()

  // ---- collapse state, persisted (same store as the lane's filters) --------
  const [sect, setSect] = useSectionState('content.draftwindow')
  const open = sect.open
  const toggle = useCallback((k: string) => {
    setSect(p => ({ ...p, open: p.open.includes(k) ? p.open.filter(x => x !== k) : [...p.open, k] }))
  }, [setSect])
  // First visit has no stored answer: QA open (it is the number you check
  // before deciding), everything else closed.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (sect.open.length === 0) setSect(p => ({ ...p, open: ['qa'] }))
  }, [sect.open.length, setSect])

  // ---- the editor ---------------------------------------------------------
  const editable = lane === 'ivan'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(d.post_body ?? '')
  // What the editor was OPENED on — the compare half of the compare-and-swap.
  const baseRef = useRef<string>(d.post_body ?? '')
  const [shown, setShown] = useState(d.post_body ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const conflictRef = useRef<HTMLDivElement>(null)
  // A refusal that renders below the fold reads as "nothing happened". The
  // measured case: the caret sits at the end of a 1,700-character post, so the
  // main column is scrolled past the box the save just produced.
  useEffect(() => {
    if (conflict) conflictRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [conflict])

  // A new row arrives (j/k, or a refetch after a write): re-seat the editor on
  // it. Keyed on the id AND the stored body, so an engine landing a rewrite
  // while the window is open updates the read view — but never while a human is
  // mid-edit, because that would silently rewrite what they are typing.
  useEffect(() => {
    if (editing) return
    setShown(d.post_body ?? '')
    setText(d.post_body ?? '')
    baseRef.current = d.post_body ?? ''
    setConflict(null)
    setSaveErr('')
  }, [d.id, d.post_body, editing])

  const startEdit = useCallback(() => {
    setText(shown)
    setEditing(true)
    setSaved(false)
    setSaveErr('')
  }, [shown])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setText(shown)
    setSaveErr('')
  }, [shown])

  const save = useCallback(async () => {
    const body = text
    setBusy(true); setSaveErr(''); setConflict(null)
    try {
      await saveDraftBody(d.id, body, d.taxonomy, baseRef.current, d.updated_at)
      baseRef.current = body
      setShown(body)
      setEditing(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2600)
      refresh()
    } catch (e) {
      if (e instanceof DraftSaveConflict) {
        // NEVER pick a winner. Both texts stay on screen and Ivan decides.
        setConflict(e.detail)
      } else {
        setSaveErr(e instanceof Error ? e.message : 'Save failed')
      }
    } finally { setBusy(false) }
  }, [d.id, d.taxonomy, d.updated_at, text, refresh])

  // Resolving a conflict is an explicit act with two named outcomes.
  const takeTheirs = () => {
    const theirs = conflict?.theirs ?? ''
    baseRef.current = theirs
    setShown(theirs)
    setText(theirs)
    setEditing(false)
    setConflict(null)
    refresh()
  }
  const keepMine = async () => {
    // Re-base onto what the database holds, then write mine over it. This is a
    // second deliberate act, not a retry of the first.
    baseRef.current = conflict?.theirs ?? ''
    setConflict(null)
    await save()
  }

  // ---- decisions ----------------------------------------------------------
  const actionable = reviewActionable(d.status, lane)
  const at = queue.findIndex(q => q.id === d.id)
  const next = at >= 0 && at + 1 < queue.length ? queue[at + 1].id : null

  const [acting, setActing] = useState(false)
  const [actErr, setActErr] = useState('')

  // After a decision the queue ADVANCES rather than closing — the reference's
  // whole reason for being a reader. Closing after every approve is what makes
  // a review queue feel like twelve separate errands.
  const decide = useCallback(async (kind: 'approve' | 'skip') => {
    if (!actionable || acting) return
    // An errored row is one the QA engine refused. Approving it is a legitimate
    // override (Ivan is the judge of last resort), so the confirm names the
    // state instead of the button pretending the row is clean.
    const overriding = d.status === 'error'
    const ok = await confirm(kind === 'approve' ? {
      title: overriding ? 'Approve this draft anyway?' : 'Approve this draft?',
      message: overriding
        ? 'QA refused this one. Approving overrides that verdict. Nothing publishes — scheduling is the separate act below.'
        : 'Marks approved. Nothing publishes — scheduling is the separate act below.',
      confirmText: 'Approve',
    } : {
      title: 'Skip this draft?',
      message: 'Marks it disqualified — it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setActing(true); setActErr('')
    try {
      await (kind === 'approve' ? approveDraft(d.id) : skipDraft(d.id))
      refresh()
      if (next) onPick(next)
      else onClose()
    } catch (e) {
      setActErr(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally { setActing(false) }
  }, [actionable, acting, confirm, d.id, next, onPick, onClose, refresh])

  const [more, setMore] = useState(false)

  // ---- keyboard -----------------------------------------------------------
  //
  // The reference's map (PostWorkSurface.tsx:286-296) with two fixes it needs:
  //   · A MODIFIER GUARD. There, `e.key === 'a'` matches ⌘A, so select-all
  //     approves the draft and ⌘R rejects it. Any modifier bails here.
  //   · `s` is SKIP-WITHOUT-DECIDING (the reference's session-local skip) and
  //     `r` is the persisted reject. Both exist there; only one had a key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (editing) return
      switch (e.key) {
        case 'j': {
          e.preventDefault()
          if (at >= 0 && at + 1 < queue.length) onPick(queue[at + 1].id)
          break
        }
        case 'k': {
          e.preventDefault()
          if (at > 0) onPick(queue[at - 1].id)
          break
        }
        case 'a': if (actionable) { e.preventDefault(); decide('approve') } break
        case 'r': if (actionable) { e.preventDefault(); decide('skip') } break
        case 'e': if (editable) { e.preventDefault(); startEdit() } break
        // Move on without judging — the row keeps its status.
        case 's': e.preventDefault(); if (next) onPick(next); break
        case 'o': e.preventDefault(); setMore(m => !m); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, queue, editing, editable, actionable, decide, next, onPick, startEdit])

  // ---- derived registers --------------------------------------------------
  const dates: [string, ReactNode][] = []
  const dateRow = (label: string, iso: string | null, ahead = false) => {
    if (!iso) return
    dates.push([label, <>{ahead ? relOrAhead(iso) : relTime(iso)} <span className="dd-abs">{absTime(iso)}</span></>])
  }
  dateRow('Created', d.created_at)
  dateRow('Updated', d.updated_at)
  dateRow('Scheduled', d.scheduled_at, true)
  dateRow('Published', d.published_at)

  const source: [string, ReactNode][] = []
  if (tax.source) source.push(['Source', tax.source])
  if (d.source_label) source.push(['Label', d.source_label])
  if (d.source_ref) source.push(['Ref', d.source_ref])
  if (d.client_idea_id) source.push(['Idea', d.client_idea_id])
  if (taxonomyValue(d.taxonomy, 'source_candidate_id')) {
    source.push(['Candidate', taxonomyValue(d.taxonomy, 'source_candidate_id')])
  }
  if (d.source_post_id) source.push(['Spun from post', d.source_post_id])
  if (taxonomyValue(d.taxonomy, 'auto_promoted')) {
    source.push(['Auto-promoted', taxonomyValue(d.taxonomy, 'auto_promoted')])
  }

  const taxRows: [string, ReactNode][] = []
  if (tax.pillar) taxRows.push(['Pillar', tax.pillar])
  if (tax.hook_type) taxRows.push(['Hook', tax.hook_type])
  if (tax.structure_used) {
    taxRows.push(['Structure', <>
      {tax.structure_used}
      {reason && <div className="ct-ref">{reason}</div>}
    </>])
  }
  if (tax.image_style) taxRows.push(['Image style', tax.image_style])
  if (tax.arm) taxRows.push(['Experiment arm', tax.arm])
  if (d.funnel_stage) taxRows.push(['Funnel stage', d.funnel_stage])
  if (strength) taxRows.push(['Topic strength', strength])

  const hero = d.type !== 'carousel' && images[0] ? imageSrc(images[0]) : null
  const slides = d.type === 'carousel' ? images : images.slice(1)

  // ---- 02 · the artifact --------------------------------------------------
  const main = (
    <div className="dw-main">
      <div className="dw-main-in">
        <div className="dw-cap">
          <div className="dw-cap-t">{d.title || d.topic || 'Untitled'}</div>
          {queue.length > 1 && at >= 0 && (
            <span className="dw-pos">{at + 1} of {queue.length}</span>
          )}
        </div>
        <div className="ct-meta" style={{ padding: '0 16px 4px' }}>
          <span className="ct-chip">{typeLabel(d.type)}</span>
          <span className={`ct-chip${stage === 'error' || stage === 'stuck' ? ' ct-chip-bad' : ''}`}>
            {STAGE_LABEL[stage]}
          </span>
          <span className="ct-chip">{relTime(d.updated_at)}</span>
          {lane === 'risedtc' && (
            <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
              {d.board_visible === true ? 'On Mattan’s board' : 'Internal'}
            </span>
          )}
        </div>
        {d.title && d.topic && d.title !== d.topic && <div className="dw-sub">{d.topic}</div>}

        {errMsg && (stage === 'error' || stage === 'stuck' ? (
          <div className="ct-err">
            {errMsg}
            {errAt && <span className="ct-ref"> · flipped {absTime(errAt)}</span>}
          </div>
        ) : (
          <div className="ct-ref ct-ref-p">
            Errored once{errAt ? ` on ${absTime(errAt)}` : ''} and recovered: {errMsg}
          </div>
        ))}

        {lane === 'risedtc' && images.length === 0 && d.status === 'review' && (
          // 🔴 operator_schedule_draft refuses a draft with no media and returns
          // 'awaiting_media'. A regeneration CLEARS image_urls, so the photo has
          // to be re-pinned first.
          <div className="ct-warnbox">
            No image. A regen clears <code>image_urls</code>; the photo has to be
            re-pinned before this can be scheduled (<code>awaiting_media</code>).
          </div>
        )}

        <LinkedInPost
          lane={lane}
          text={shown}
          image={hero}
          editing={editing}
          value={text}
          onChange={setText}
          onStartEdit={editable && !editing ? startEdit : null}
          onCancel={cancelEdit}
          onSave={save}
          busy={busy}
          footer={editing ? (
            <div className="li-editbar">
              <button type="button" className="li-btn p" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="li-btn" disabled={busy} onClick={cancelEdit}>Cancel</button>
              <span className="li-editnote">esc cancels · ⌘↵ saves</span>
            </div>
          ) : saved ? (
            <div className="li-editbar"><span className="li-saved">Saved to the database</span></div>
          ) : undefined}
        />

        {saveErr && <div className="ops-err" style={{ margin: '10px 16px 0' }}>{saveErr}</div>}

        {conflict && (
          // The whole point: BOTH texts, no winner picked.
          <div className="dw-conf" ref={conflictRef}>
            <div className="dw-conf-h">
              {conflict.kind === 'gone'
                ? 'This draft was deleted while you were editing it.'
                : 'This draft changed in the database while you were editing it.'}
            </div>
            {conflict.kind === 'gone' ? (
              <>
                <div className="dw-conf-s">
                  Nothing was written. Your text is still in the editor — copy it out before you close
                  this window, because there is no row left to save it to.
                </div>
                <div className="ct-ac" style={{ marginTop: 10 }}>
                  <button type="button" className="btn s" onClick={() => setConflict(null)}>Dismiss</button>
                </div>
              </>
            ) : (
              <>
                <div className="dw-conf-s">
                  Nothing was overwritten. One of the generation engines rewrote the body
                  {conflict.theirUpdatedAt ? ` at ${absTime(conflict.theirUpdatedAt)}` : ''}. Here is what
                  it holds now — your version is still in the editor above.
                </div>
                <div className="dw-conf-t">{conflict.theirs || '(empty)'}</div>
                <div className="ct-ac" style={{ marginTop: 10 }}>
                  <button type="button" className="btn s" onClick={takeTheirs}>Take theirs, drop mine</button>
                  <button type="button" className="btn p" disabled={busy} onClick={keepMine}>
                    Keep mine, overwrite theirs
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {slides.length > 0 && (
          <div className="dw-slides">
            {slides.map((u, i) => <img src={imageSrc(u, 400)} alt="" loading="lazy" key={`${u}-${i}`} />)}
          </div>
        )}

        {actErr && <div className="ops-err" style={{ margin: '10px 16px 0' }}>{actErr}</div>}

        {/* The risky drawer: everything that spends money or arms a publisher
            lives one deliberate click behind `o`. Delete came BACK OUT of it
            (2026-08-03, Ivan: "there is no delete or approve option") — it
            carries its own two-step confirm, so hiding it bought no safety and
            cost him the affordance he had before. */}
        {more && lane === 'ivan' && (
          <div style={{ marginBottom: 4 }}>
            <RegenDraft d={d} onDone={refresh} />
            <ScheduleDraft d={d} onDone={refresh} />
          </div>
        )}
        {lane === 'ivan' && (
          <div style={{ marginBottom: 4 }}>
            <DeleteDraft d={d} onDone={() => { refresh(); if (next) onPick(next); else onClose() }} />
          </div>
        )}

        {/* While the editor is open every one of these would leave the row —
            approving, skipping or walking to the next draft all discard unsaved
            words with no prompt. The keyboard already refuses (the `editing`
            bail in the handler); the buttons have to refuse too, or the guard is
            only a guard for people who use keys. */}
        <div className="dw-acts">
          {actionable && (
            <>
              <button type="button" className="dw-key p" disabled={acting || editing}
                onClick={() => decide('approve')}>
                <kbd>a</kbd> Approve
              </button>
              <button type="button" className="dw-key" disabled={acting || editing}
                onClick={() => decide('skip')}>
                <kbd>r</kbd> Skip
              </button>
            </>
          )}
          {editable && !editing && (
            <button type="button" className="dw-key" onClick={startEdit}><kbd>e</kbd> Edit</button>
          )}
          {next && (
            <button type="button" className="dw-key" disabled={editing} onClick={() => onPick(next)}>
              <kbd>s</kbd> Next
            </button>
          )}
          {lane === 'ivan' && (
            <button type="button" className="dw-key" disabled={editing} aria-expanded={more}
              onClick={() => setMore(m => !m)}>
              <kbd>o</kbd> {more ? 'Hide actions' : 'More actions'}
            </button>
          )}
          {editing ? (
            <span className="dw-hint">Save or cancel the edit first</span>
          ) : queue.length > 1 ? (
            <span className="dw-hint"><kbd>j</kbd><kbd>k</kbd> move · <kbd>esc</kbd> close</span>
          ) : null}
        </div>
      </div>
    </div>
  )

  // ---- 03 · the evidence --------------------------------------------------
  const insp = (
    <aside className="dw-insp">
      <div className="dw-insp-h">What decides it</div>

      {qa ? (
        <Sec k="qa" label="QA verdict" tail={qa.score !== null ? `${qa.score}` : qa.verdict ?? undefined}
          open={open} toggle={toggle}>
          <QaRegister qa={qa} />
        </Sec>
      ) : (
        <Sec k="qa" label="QA verdict" tail="none" open={open} toggle={toggle}>
          <div className="ct-subtle">No gate has scored this row.</div>
        </Sec>
      )}

      {selfContainedHtml(authored) && (
        <Sec k="art" label="Rendered artifact" open={open} toggle={toggle}>
          {/* Only a SELF-CONTAINED document earns the frame: authored_html is
              usually a class-based fragment whose styles live in the render
              service's kit CSS, and framing that shows raw serif text — the
              opposite of "as it will appear". */}
          <HtmlPreview html={authored} title="Post as it will appear" />
        </Sec>
      )}

      {(source.length > 0 || detail || points.length > 0 || d.description) && (
        <Sec k="src" label="Source briefing" tail={detail?.kind ?? undefined} open={open} toggle={toggle}>
          <Rows items={source} />
          {detail && (
            <>
              {(detail.kind || detail.label) && (
                <div className="ct-meta ct-src-m">
                  {detail.kind && <span className="ct-chip">{detail.kind}</span>}
                  {detail.label && <span className="ct-src-l">{detail.label}</span>}
                </div>
              )}
              {detail.quote && (
                <div className="ct-quote">
                  <div className="dd-body">“{detail.quote}”</div>
                  {detail.callTitle && <div className="ct-ref">{detail.callTitle}</div>}
                </div>
              )}
              {!detail.quote && detail.callTitle && <div className="ct-ref ct-ref-p">{detail.callTitle}</div>}
              {detail.text && <div className="dd-card"><div className="dd-body">{detail.text}</div></div>}
              {detail.links.map(([k, url]) => (
                <a className="dd-link" href={url} target="_blank" rel="noreferrer" key={k}>{k} ↗</a>
              ))}
              <KeyRows items={detail.rows} />
            </>
          )}
          {points.length > 0 && (
            <Block label="Key points">
              <div className="dd-card">{points.map((p, i) => <div className="dd-point" key={i}>{p}</div>)}</div>
            </Block>
          )}
          {d.description && (
            <Block label="Description">
              <div className="dd-card"><div className="dd-body dd-pre">{d.description}</div></div>
            </Block>
          )}
          {source.length === 0 && !detail && points.length === 0 && !d.description && (
            <div className="ct-subtle">Pre-pipeline draft — no linked idea.</div>
          )}
        </Sec>
      )}

      <Sec k="log" label="Generation register" tail={log.length ? `${log.length}` : 'note only'}
        open={open} toggle={toggle}>
        <AgentRegister log={log} />
        {lane === 'ivan' && <NoteComposer id={d.id} onDone={refresh} />}
        {lane !== 'ivan' && log.length === 0 && (
          <div className="ct-subtle">No agent activity recorded on this row.</div>
        )}
      </Sec>

      <Sec k="meta" label="Dates &amp; fields" open={open} toggle={toggle}>
        {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
        {taxRows.length > 0 && <Block label="Taxonomy"><Rows items={taxRows} /></Block>}
        {/* ~25 further keys are live beyond the six named above. They render
            after the known ones, sorted, so a new key appears without a code
            edit. */}
        {extras.length > 0 && <Block label="Taxonomy · other keys"><KeyRows items={extras} /></Block>}
        {d.ig_caption && (
          <Block label="IG caption"><div className="dd-card"><div className="dd-body dd-pre">{d.ig_caption}</div></div></Block>
        )}
        {d.pdf_url && (
          <Block label="PDF">
            <a className="dd-link" href={d.pdf_url} target="_blank" rel="noreferrer">Open PDF ↗</a>
          </Block>
        )}
        {/* style_id is NULL on all 282 rows, regen_slides on all 282,
            video_status on all 282 — named so nobody re-adds them as empty rows. */}
        {d.slide_metadata !== undefined && d.slide_metadata !== null && (
          <Block label="Slides"><Rows items={[['Slide metadata', <Val v={d.slide_metadata} key="s" />]]} /></Block>
        )}
      </Sec>
    </aside>
  )

  // A one-row queue has nowhere to walk to, so it draws no rail and the grid
  // gives the 232px back to the artifact.
  const hasRail = queue.length > 1

  return (
    <div className="dw">
      {/* DOM order is main → evidence → queue, which IS the phone order (§the
          header). CSS `order` puts the queue back on the left for the wide
          layout, so the markup never has to disagree with the phone. */}
      <div className={`dw-cols${hasRail ? '' : ' dw-norail'}`}>
        {main}
        {insp}
        {hasRail && <QueueRail queue={queue} id={d.id} onPick={onPick} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export function DraftWindow({ id, lane, queue, refresh, onClose, onPick, mobile }: {
  id: string
  lane: ContentLane
  queue: QueueItem[]
  refresh: () => void
  onClose: () => void
  onPick: (id: string) => void
  mobile: boolean
}) {
  const [bump, setBump] = useState(0)
  const reload = useCallback(() => setBump(b => b + 1), [])
  const { detail, missing, loading, error } = useDraftDetail(id, bump)
  const refreshBoth = useCallback(() => { reload(); refresh() }, [reload, refresh])

  // The queue rail earns the three-column layout; a single-row queue does not,
  // and the sub-line should not claim a position that does not exist.
  const sub = `${LANE_LABEL[lane]}${detail?.type ? ` · ${typeLabel(detail.type)}` : ''}`


  return (
    <Takeover label="Content draft" sub={sub} onClose={onClose} mobile={mobile} bodyClass="dw-body">
      {error ? (
        <Failed what="This draft" message={error} loadedAt={null} />
      ) : loading && !detail ? (
        <div aria-hidden style={{ padding: '18px 16px 0' }}>
          <div className="sk sk-line" style={{ width: '70%', height: 20 }} />
          <div className="sk sk-line" style={{ width: '40%', marginTop: 12 }} />
          <div className="sk" style={{ height: 120, borderRadius: 16, marginTop: 18 }} />
          <div className="sk" style={{ height: 180, borderRadius: 16, marginTop: 12 }} />
        </div>
      ) : missing || !detail ? (
        // Gone and unreadable are different facts. This one is gone.
        <div className="wb-empty">
          <div className="wb-empty-l">This draft is no longer in the database.</div>
          <div className="wb-empty-s">It was deleted while the queue was open.</div>
        </div>
      ) : (
        <Body
          key={detail.id}
          d={detail}
          lane={lane}
          queue={queue}
          refresh={refreshBoth}
          onClose={onClose}
          onPick={onPick}
        />
      )}
    </Takeover>
  )
}
