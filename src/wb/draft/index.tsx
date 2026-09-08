/* ==========================================================================
   src/wb/draft/index.tsx — S16, the draft window, on the design system.

   Rebuilt from src/exp/v2c/DraftPane.tsx. Every hook, every read, every write,
   every confirm, the compare-and-swap save, the conflict picker, the regen
   guard, the optimistic promote with rollback, the queue advance, the j/k walk
   with its modifier guard, and every string are the ones that were there. The
   old file stays on disk until W6, because W3's magnet window still reads its
   `QueueItem` type.

   THE THREE COLUMNS (panes PICKS §1):

     ┌──────────┬────────────────────────┬──────────────────┐
     │ 01 QUEUE │ 02 THE ARTIFACT        │ 03 THE EVIDENCE  │
     │ the rows │ LinkedIn-faithful,     │ QA · Artifact ·  │
     │ j/k walks│ editable in place,     │ Source · Log ·   │
     │          │ decision bar pinned    │ Fields, on tabs  │
     └──────────┴────────────────────────┴──────────────────┘

   Below 1180 it is ONE column in the takeover shell's deliberate order, the
   artifact, then its decision, then the evidence, then the queue LAST, because
   on a phone you arrived here by tapping a row and the list is one back-tap
   away; twelve sibling titles above the post is exactly the vertical scroll
   Ivan complained about.

   THE ARTIFACT KEEPS ITS OWN GEOMETRY. `LinkedInPost` is a reproduction of a
   platform surface, not a screen of ours: it is the platform-artifact exception
   and it renders unchanged, at its own measure, because widening it would make
   the preview lie about what LinkedIn will show.

   The EVIDENCE RAIL IS TABBED, and it is the ds `Tabs` now rather than a
   hand-measured indicator that read its own offsets every frame. Same five
   sections, same order, same content, one at a time; a tab whose content does
   not exist on this row is never rendered, because a dead tab is a worse lie
   than a missing one.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Banner, Button, Chip, EmptyState, Icon, Kbd, Skeleton, Tabs } from '../../ds'
import { Takeover, TakeoverRailHead, HtmlPreview } from '../takeover'
import { useDraftDetail } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  ClientRpcError, DraftSaveConflict, LANE_LABEL, LANE_POSSESSIVE, STAGE_LABEL, approveDraft,
  boardGroupOf, canPromote, canRestartToIdea, canUnpromote, clientEditable, clientStageLabel,
  groupLogByAgent, normalizeAgentLog, normalizeImageUrls, normalizeKeyPoints, normalizeQa,
  normalizeSourceDetail, reviewActionable, saveClientDraftBody, saveDraftBody, selfContainedHtml,
  setBoardVisible, skipDraft, stageOf, taxonomyExtras, taxonomyFields, taxonomyValue,
  type ContentDraftDetail, type ContentLane, type SaveConflict,
} from '../../lib/content'
import { label } from '../../lib/labels'
import { Block, Fold, KeyRows, Rows, Val, Well, Pre } from './bits'
import { AgentRegister, QaRegister } from './register'
import {
  DeleteClientDraft, DeleteDraft, NoteComposer, RegenDraft, RestartDraft, ScheduleDraft, SwapImage,
} from './actions'
import { LinkedInPost } from './LinkedInPost'
import { absTime, linkedInPostUrl, postTime, relOrAhead, relTime, typeLabel } from '../../exp/v2c/fmt'
import './draft.css'

/** The queue rail's row -- moved here in Phase 3 W6 from `src/exp/v2c/DraftPane`,
    the component this window replaced and which is now deleted. */
export type QueueItem = {
  id: string; title: string; type: string | null; updated_at: string; status: string
  // WHEN IT POSTS. Optional because the LM queue (`toLmQueueItem`) has no such
  // column -- a resource is not scheduled, it is published or it is not.
  scheduled_at?: string | null
}

const RAIL_KEY = 'wb-draft-rail'

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

// Google Drive /view URLs 302 into viewer HTML and never render in an <img>.
export function imageSrc(url: string, size = 800): string {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size}` : url
}

// ---------------------------------------------------------------------------
// 01 · the queue rail — j/k made visible
// ---------------------------------------------------------------------------
function QueueRail({ queue, id, onPick }: {
  queue: QueueItem[]; id: string; onPick: (id: string) => void
}) {
  const at = queue.findIndex(q => q.id === id)
  const ref = useRef<HTMLDivElement>(null)
  // Keep the current row in view when j/k walks past the fold — but ONLY when
  // the rail is its own scroller. Below 1180 the rail is the LAST block of the
  // window's single scroller, and scrollIntoView walks every ancestor: it
  // dragged the whole window down past the post to show a queue row nobody had
  // asked for.
  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    el.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <div className="a-dw-q-rail" ref={ref}>
      {/* Sticky, because a 16-row rail scrolls past its own header and the
          position is the one fact on it that stays true while you walk. */}
      <TakeoverRailHead label="In this queue" tail={`${at >= 0 ? at + 1 : '–'}/${queue.length}`} />
      {queue.map((q, i) => (
        <button
          type="button"
          key={q.id}
          className="a-dw-qrow"
          data-on={q.id === id ? '' : undefined}
          aria-current={q.id === id ? 'true' : undefined}
          onClick={() => onPick(q.id)}
        >
          {/* The ordinal, at a fixed x, tabular — it is what makes the rail read
              as a QUEUE and not as a second copy of the list, and it gives every
              title one left edge to run from. */}
          <span className="a-mono a-dim a-dw-qrow-i">{i + 1}</span>
          <span className="a-dw-qrow-b">
            {/* ONE line, not two; the row you are ON opens to two, because that
                is the one title worth reading in full. */}
            <span className="a-dw-qrow-t">{q.title || 'Untitled'}</span>
            <span className="a-mono a-dim a-dw-qrow-m">
              {q.scheduled_at
                ? postTime(q.scheduled_at)
                : `${typeLabel(q.type)} · ${relTime(q.updated_at)}`}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------
function Body({ d, lane, queue, refresh, onClose, onPick, mobile }: {
  d: ContentDraftDetail
  lane: ContentLane
  queue: QueueItem[]
  refresh: () => void
  onClose: () => void
  onPick: (id: string) => void
  mobile: boolean
}) {
  const stage = stageOf(d)
  const tax = taxonomyFields(d.taxonomy)
  const extras = taxonomyExtras(d.taxonomy)
  const log = normalizeAgentLog(d.agent_log)
  // The header counts AGENTS, because that is what the register renders — 43
  // entries from 14 agents reads as "14", not as "43".
  const agentCount = groupLogByAgent(log).length
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

  // ---- the evidence rail's ACTIVE TAB, persisted --------------------------
  const [sect, setSect] = useSectionState('content.draftwindow')
  const tab = sect.open[0] ?? 'qa'
  const pickTab = useCallback((k: string) => {
    setSect(p => ({ ...p, open: [k] }))
  }, [setSect])

  // ---- the editor ---------------------------------------------------------
  //
  // The client lane is editable too, through a DIFFERENT write: saveDraftBody
  // is scoped `.is('client_id', null)` and always will be; the client path goes
  // through operator_edit_draft_body, which is the mirror image and refuses
  // anything outside status review/scheduled. `clientEditable` carries that
  // second rule, so the button is absent exactly when the database would
  // refuse — and where it is absent, the note below the actions says why.
  const editable = lane === 'ivan' || clientEditable(d.status, lane)
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
  // A refusal that renders below the fold reads as "nothing happened".
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
      await (lane === 'ivan'
        ? saveDraftBody(d.id, body, d.taxonomy, baseRef.current, d.updated_at)
        : saveClientDraftBody(d.id, body, d.taxonomy, baseRef.current, d.updated_at))
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
  }, [d.id, d.taxonomy, d.updated_at, lane, text, refresh])

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
  const nextId = at >= 0 && at + 1 < queue.length ? queue[at + 1].id : null

  const [acting, setActing] = useState(false)
  const [actErr, setActErr] = useState('')

  // After a decision the queue ADVANCES rather than closing — the reader's
  // whole reason for being a reader. Closing after every approve is what makes
  // a review queue feel like twelve separate errands.
  const decide = useCallback(async (kind: 'approve' | 'skip') => {
    if (!actionable || acting) return
    // An errored row is one the QA engine refused. Approving it is a legitimate
    // override (Ivan is the judge of last resort), so the confirm names the
    // state instead of the button pretending the row is clean.
    const overriding = d.status === 'error'
    // A clean approve is a reversible status mark that publishes nothing, and
    // a sheet in front of it was one more click on every one of 33 rows (Ivan,
    // 2026-09-08: "takes too long"). The sheet stays where the act is not
    // clean: overriding a QA refusal, or skipping, which is durable.
    const ok = (kind === 'approve' && !overriding) || await confirm(kind === 'approve' ? {
      title: 'Approve this draft anyway?',
      message: 'QA refused this one. Approving overrides that verdict. Nothing publishes, scheduling is the separate act below.',
      confirmText: 'Approve',
    } : {
      title: 'Skip this draft?',
      message: 'Marks it disqualified, it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setActing(true); setActErr('')
    try {
      await (kind === 'approve' ? approveDraft(d.id) : skipDraft(d.id))
      refresh()
      if (nextId) onPick(nextId)
      else onClose()
    } catch (e) {
      setActErr(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally { setActing(false) }
  }, [actionable, acting, confirm, d.id, d.status, nextId, onPick, onClose, refresh])

  // ---- the CLIENT decision: promote / take back --------------------------
  //
  // Optimistic with rollback. The local flag is what makes the chip and the
  // delete zone flip on the spot; the list underneath re-groups off its own
  // refetch.
  const [visible, setVisible] = useState<boolean | null | undefined>(d.board_visible)
  useEffect(() => { setVisible(d.board_visible) }, [d.id, d.board_visible])
  const [promoting, setPromoting] = useState(false)
  const [promoteErr, setPromoteErr] = useState('')
  // Both read the OPTIMISTIC flag, so the pair of buttons swaps the instant the
  // decision is taken rather than after the refetch.
  const promotable = canPromote(d.status, lane) && visible !== true
  const unpromotable = canUnpromote(lane, visible)

  const promote = useCallback(async (next: boolean) => {
    if (promoting) return
    // 🔴 CLIENT-FACING. `true` is the only action in this whole app that puts
    // something in front of a paying client, so the sheet says that first, in
    // those words, and then says what it does NOT do.
    const ok = await confirm(next ? {
      title: 'Put this on Mattan’s board?',
      message:
        'Mattan sees it. This is the one action here that reaches a client, it fires his board’s '
        + 'own sync, so it lands on his board within moments, not at some later batch. From there '
        + 'the decisions are his: approve, edit, veto, schedule. '
        + 'Nothing publishes, this writes board visibility and never touches the publisher.',
      confirmText: 'Put it on his board',
    } : {
      title: 'Take this off Mattan’s board?',
      message:
        'It goes back to our side only and disappears from his board on the same sync. Nothing is '
        + 'deleted and no status changes, the draft stays here, and you can put it back.',
      confirmText: 'Take it off',
    })
    if (!ok) return
    setPromoting(true); setPromoteErr('')
    setVisible(next)
    try {
      await setBoardVisible(d.id, next)
      refresh()
      // Promoting clears the row out of the section it was opened from, so the
      // reader walks on the way approve does. Taking one back is a correction —
      // stay on it, so the result is visible.
      if (next) { if (nextId) onPick(nextId); else onClose() }
    } catch (e) {
      setVisible(!next)
      setPromoteErr(e instanceof ClientRpcError || e instanceof Error
        ? e.message
        : 'Could not change the board visibility')
    } finally { setPromoting(false) }
  }, [confirm, d.id, nextId, onClose, onPick, promoting, refresh])

  // OPEN by default on a row that is waiting to be armed: needs review →
  // scheduled is the walk Ivan makes on every row, and a disclosure in front
  // of the date was a click on each. Closed on a row that is already armed or
  // past deciding, where a date field would only be noise.
  const [more, setMore] = useState(lane === 'ivan' && (stage === 'review' || stage === 'approved'))
  // The four recovery acts used to be a permanently rendered tier. They are one
  // disclosure away now — see the bar's own comment for why.
  const [shelf, setShelf] = useState(false)
  // THE QUEUE RAIL, CLOSED BY DEFAULT. Thirty-three truncated titles beside the
  // post is the clutter Ivan named on 2026-09-08; j/k still walk the queue and
  // the header's own count says where you are. Persisted, because "show me the
  // queue" is a way of working, not a per-row answer.
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false }
  })
  const toggleRail = useCallback(() => {
    setRailOpen(o => {
      try { localStorage.setItem(RAIL_KEY, o ? '0' : '1') } catch { /* private mode */ }
      return !o
    })
  }, [])

  // ---- keyboard (S16-40) --------------------------------------------------
  //
  // 🔴 A MODIFIER GUARD. The reference matched a bare `e.key` outside a field,
  // so ⌘A approved the draft and ⌘R rejected it. Any modifier bails.
  // The letter keys are gone (Ivan: "no need for keyboard quick access"); j/k
  // stay, because they walk the queue and the rail already shows what they move
  // through.
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, queue, editing, onPick])

  // ---- derived registers --------------------------------------------------
  const dates: [string, ReactNode][] = []
  const dateRow = (k: string, iso: string | null, ahead = false) => {
    if (!iso) return
    dates.push([k, <>{ahead ? relOrAhead(iso) : relTime(iso)} <span className="a-dim">{absTime(iso)}</span></>])
  }
  dateRow('Created', d.created_at)
  dateRow('Updated', d.updated_at)
  dateRow('Scheduled', d.scheduled_at, true)
  dateRow('Published', d.published_at)

  // 🔴 A row key is a LOOKUP: you arrive at it with a question, never by reading
  // past it. Nothing is truncated and nothing is dropped — the value is
  // verbatim in the DOM, at the quiet tier, one disclosure away.
  const source: [string, ReactNode][] = []
  const sourceIds: [string, ReactNode][] = []
  const idRow = (k: string, v: string | null | undefined) => {
    if (v) sourceIds.push([k, <span className="a-mono" key={k}>{v}</span>])
  }
  if (tax.source) source.push(['Source', tax.source])
  if (d.source_label) source.push(['Label', d.source_label])
  if (d.source_post_id) {
    // The live LinkedIn post this draft was spun from, a real fact, so it earns
    // a link rather than a raw urn print. The urn stays reachable on hover.
    const url = linkedInPostUrl(d.source_post_id)
    source.push(['Spun from post', url
      ? <a className="a-dw-link" href={url} target="_blank" rel="noreferrer" title={d.source_post_id}>
        View the live post
      </a>
      : <span title={d.source_post_id}>Live post (link unavailable)</span>])
  }
  if (taxonomyValue(d.taxonomy, 'auto_promoted')) {
    source.push(['Auto-promoted', taxonomyValue(d.taxonomy, 'auto_promoted')])
  }
  idRow('Ref', d.source_ref)

  const taxRows: [string, ReactNode][] = []
  if (tax.pillar) taxRows.push(['Pillar', tax.pillar])
  if (tax.hook_type) taxRows.push(['Hook', tax.hook_type])
  if (tax.structure_used) {
    taxRows.push(['Structure', <>
      {tax.structure_used}
      {reason && <span className="a-meta a-dw-reason">{reason}</span>}
    </>])
  }
  if (tax.image_style) taxRows.push(['Image style', tax.image_style])
  if (tax.arm) taxRows.push(['Experiment arm', tax.arm])
  if (d.funnel_stage) taxRows.push(['Funnel stage', d.funnel_stage])
  if (strength) taxRows.push(['Topic strength', strength])

  const hero = d.type !== 'carousel' && images[0] ? imageSrc(images[0]) : null
  const slides = d.type === 'carousel' ? images : images.slice(1)

  // ---- 02 · the artifact --------------------------------------------------
  const artifact = (
    <>
      <div className="a-dw-cap">
        <h2 className="a-dw-cap-t">{d.title || d.topic || 'Untitled'}</h2>
      </div>
      {/* The type and the position are NOT repeated here: the window's header
          prints both, and a fact printed twice on one screen is the clutter
          Ivan named. */}
      <div className="a-dw-chips">
        {/* One status, two meanings. `review` here is "waiting on Mattan" when
            he has it and "waiting on you" when he does not, so the chip reads
            the promotion state rather than repeating the raw stage — and it
            reads the OPTIMISTIC flag, so it flips on the decision. */}
        <Chip tone={stage === 'error' || stage === 'stuck' ? 'urgent' : 'neutral'}>
          {lane !== 'ivan'
            ? clientStageLabel(stage, boardGroupOf({ board_visible: visible }))
            : STAGE_LABEL[stage]}
        </Chip>
        {/* 🔴 WHEN IT POSTS, FIRST-CLASS. On an armed draft that is the fact
            the whole window is about. "Posts" only while the time is still
            ahead: a scheduled row whose slot has passed has either published or
            missed, and this chip knows neither. */}
        {d.scheduled_at && (
          <Chip icon="scheduled">
            {Date.parse(d.scheduled_at) > Date.now() ? 'Posts ' : 'Post time '}
            {postTime(d.scheduled_at)} · {relOrAhead(d.scheduled_at)}
          </Chip>
        )}
        <Chip>edited {relTime(d.updated_at)}</Chip>
        {lane !== 'ivan' && (
          <Chip tone={visible === true ? 'accent' : 'neutral'}>
            {visible === true ? `On ${LANE_POSSESSIVE[lane]} board` : 'Not on his board'}
          </Chip>
        )}
      </div>
      {d.title && d.topic && d.title !== d.topic && <p className="a-dw-sub">{d.topic}</p>}

      {errMsg && (stage === 'error' || stage === 'stuck' ? (
        <Banner tone="urgent" icon="error">
          {errMsg}
          {errAt && <span className="a-dim"> · flipped {absTime(errAt)}</span>}
        </Banner>
      ) : (
        <p className="a-dw-note">
          Errored once{errAt ? ` on ${absTime(errAt)}` : ''} and recovered: {errMsg}
        </p>
      ))}

      {lane !== 'ivan' && images.length === 0 && d.status === 'review' && (
        // 🔴🔴 IT WAS READING AS A REFUSAL OF THE CLICK. The promote had
        // SUCCEEDED; the box that was on screen before the click was still
        // there after it, unchanged, and a red block that does not move is
        // indistinguishable from a red block that just appeared. It is a NOTE,
        // not an alarm, and it says which step it bites at and which it does
        // not — promoting an image-less draft is legal and always was.
        <p className="a-dw-note">
          No image yet. This does not stop it going on the board — it stops the
          SCHEDULE later, which refuses a draft with no media. A regeneration
          clears the pinned image, so the photo has to be re-pinned before a
          date will take.
        </p>
      )}

      {/* THE STAGE. The artifact and the row that decides its fate are ONE
          object. 🔴 The MEASURE does not move: widening the post card would
          make the preview lie about what LinkedIn will show. */}
      <div className="a-dw-stage">
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
            <div className="a-dw-editbar">
              <Button variant="primary" size="sm" busy={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={cancelEdit}>Cancel</Button>
              {/* The caps are the system's icons, not the unicode marks: a key
                  is drawn by `Kbd`, and ⌘ and ↵ are in the glyph map. */}
              <span className="a-dw-keys">
                <Kbd>esc</Kbd> cancels
                <Kbd><Icon name="cmd" size={16} label="Command" /></Kbd>
                <Kbd><Icon name="enter" size={16} label="Return" /></Kbd> saves
              </span>
            </div>
          ) : saved ? (
            <div className="a-dw-editbar"><span className="a-mono a-dim">Saved to the database</span></div>
          ) : undefined}
        />

        {saveErr && <Banner tone="urgent" icon="error">{saveErr}</Banner>}

        {conflict && (
          // The whole point: BOTH texts, no winner picked.
          <div className="a-dw-conf" ref={conflictRef}>
            <span className="a-title-t">
              {conflict.kind === 'gone'
                ? 'This draft was deleted while you were editing it.'
                : 'This draft changed in the database while you were editing it.'}
            </span>
            {conflict.kind === 'gone' ? (
              <>
                <p className="a-dw-note">
                  Nothing was written. Your text is still in the editor — copy it out before you close
                  this window, because there is no row left to save it to.
                </p>
                <div className="a-dw-inline-a">
                  <Button variant="quiet" size="sm" onClick={() => setConflict(null)}>Dismiss</Button>
                </div>
              </>
            ) : (
              <>
                <p className="a-dw-note">
                  Nothing was overwritten. One of the generation engines rewrote the body
                  {conflict.theirUpdatedAt ? ` at ${absTime(conflict.theirUpdatedAt)}` : ''}. Here is what
                  it holds now — your version is still in the editor above.
                </p>
                <Well><Pre>{conflict.theirs || '(empty)'}</Pre></Well>
                <div className="a-dw-inline-a">
                  <Button variant="quiet" size="sm" onClick={takeTheirs}>Take theirs, drop mine</Button>
                  <Button variant="primary" size="sm" busy={busy} onClick={keepMine}>
                    Keep mine, overwrite theirs
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {slides.length > 0 && (
          <div className="a-dw-slides">
            {slides.map((u, i) => <img src={imageSrc(u, 400)} alt="" loading="lazy" key={`${u}-${i}`} />)}
          </div>
        )}

        {actErr && <Banner tone="urgent" icon="error">{actErr}</Banner>}

        {lane !== 'ivan' && (
          <DeleteClientDraft
            d={{ ...d, board_visible: visible }}
            lane={lane}
            onDone={() => { refresh(); if (nextId) onPick(nextId); else onClose() }}
          />
        )}

        {promoteErr && <Banner tone="urgent" icon="error">{promoteErr}</Banner>}

        {/* WHY THERE IS NO BUTTON. An affordance that is simply missing is what
            produced Ivan's message; on this lane every gap now states the rule
            that closes it, and the rule is the database's, not a house style. */}
        {lane !== 'ivan' && !promotable && !unpromotable && (
          <p className="a-dw-note">
            {d.status === 'error'
              ? `This one errored, and only a draft at Needs review can go on ${LANE_POSSESSIVE[lane]} board. Fix or regenerate it on our side first, nothing here reaches him.`
              : `Not promotable at ${STAGE_LABEL[stage].toLowerCase()}, the database only promotes a draft that is still at Needs review.`}
          </p>
        )}
        {lane !== 'ivan' && !editable && (
          <p className="a-dw-note">
            {LANE_POSSESSIVE[lane]} copy is only editable while the draft is at Needs review or Scheduled. At{' '}
            {STAGE_LABEL[stage].toLowerCase()} the words are settled — edit it on his board instead.
          </p>
        )}
      </div>
    </>
  )

  // ---- the decision bar ---------------------------------------------------
  //
  // TWO TIERS, AND THE SPLIT IS THE POINT: DECIDE, then REMAKE. Every one of
  // these buttons measured identical and varied only in fill, so the geometry
  // is the system's and the WEIGHT is what varies.
  //
  // While the editor is open every one of them would leave the row: approving,
  // skipping or walking to the next draft all discard unsaved words with no
  // prompt. The keyboard already refuses; the buttons refuse too, or the guard
  // is only a guard for people who use keys.
  const decisionBar = (
    <div className="a-dw-acts">
      <div className="a-dw-decide">
        {actionable && (
          // A row that already failed does not get to keep Approve at primary
          // weight: approving it is an override, not a clean pass.
          <Button
            variant={d.status === 'error' ? 'default' : 'primary'}
            disabled={acting || editing}
            onClick={() => decide('approve')}
          >
            Approve
          </Button>
        )}
        {/* 🔴 The client-facing decision. It wears the same primary weight as
            Ivan's Approve because it is the same gesture in his hands, but
            never the same WORD, because this one is seen by a paying client and
            "Approve" would not say so. */}
        {promotable && (
          <Button variant="primary" busy={promoting} disabled={editing} onClick={() => promote(true)}>
            {promoting ? 'Putting it up…' : 'Put on Mattan’s board'}
          </Button>
        )}
        {unpromotable && (
          <Button busy={promoting} disabled={editing} onClick={() => promote(false)}>
            {promoting ? 'Taking it off…' : 'Take off his board'}
          </Button>
        )}
        {editable && !editing && <Button onClick={startEdit}>Edit</Button>}
        {lane === 'ivan' && (
          // Quiet while the date row is open: the row's own button is the act,
          // and this one only folds it away.
          <Button variant={more ? 'quiet' : 'default'} disabled={editing} aria-expanded={more}
            onClick={() => setMore(m => !m)}>
            {more ? 'Hide date' : 'Schedule'}
          </Button>
        )}
        {/* Regenerate, Swap image, Back to idea and Delete draft were four
            permanently rendered tertiary controls. None of them is the job:
            each is what you reach for when the draft is WRONG, and one of them
            is destructive. Nothing is removed — every one is still here, still
            takes the same write, still carries the same confirm. */}
        {lane === 'ivan' && (
          <Button variant="quiet" iconEnd="forward" disabled={editing} aria-expanded={shelf}
            onClick={() => setShelf(s => !s)}>
            Fix or remove
          </Button>
        )}
      </div>
      {shelf && lane === 'ivan' && (
        <div className="a-dw-remake">
          <RegenDraft d={d} onDone={refresh} disabled={editing} />
          <SwapImage d={d} onDone={refresh} disabled={editing} />
          {canRestartToIdea(d.status, lane) && (
            <RestartDraft d={d} onDone={refresh} disabled={editing} />
          )}
          <DeleteDraft
            d={d}
            disabled={editing}
            onDone={() => { refresh(); if (nextId) onPick(nextId); else onClose() }}
          />
        </div>
      )}
      {/* 🔴 THE ONE AFFORDANCE HERE THAT ARMS A PUBLISHER, and it unfolds
          INSIDE the bar like every other disclosure in this window. */}
      {more && lane === 'ivan' && !editing && (
        <div className="a-dw-shelfrow">
          <ScheduleDraft
            d={d}
            onDone={refresh}
            // A fresh arm is a decision like approve: the reader walks on to
            // the next row rather than sitting on the one just settled.
            onArmed={() => { if (nextId) onPick(nextId); else onClose() }}
          />
        </div>
      )}
      {editing && <span className="a-mono a-dim">Save or cancel the edit first</span>}
    </div>
  )

  // ---- 03 · the evidence --------------------------------------------------
  type Pane = { k: string; label: string; tail?: string; body: ReactNode }
  const panes: Pane[] = [
    {
      k: 'qa', label: 'QA',
      tail: qa ? (qa.score !== null ? `${qa.score}` : qa.verdict ?? undefined) : 'none',
      body: qa
        ? <QaRegister qa={qa} />
        : <p className="a-dw-note">No gate has scored this row.</p>,
    },
    ...(selfContainedHtml(authored)
      ? [{
        k: 'art', label: 'Artifact',
        // Only a SELF-CONTAINED document earns the frame: authored_html is
        // usually a class-based fragment whose styles live in the render
        // service's kit CSS, and framing that shows raw serif text — the
        // opposite of "as it will appear".
        body: <HtmlPreview html={authored} title="Post as it will appear" />,
      }]
      : []),
    ...((source.length > 0 || sourceIds.length > 0 || detail || points.length > 0 || d.description)
      ? [{
        k: 'src', label: 'Source', tail: detail?.kind ? label(detail.kind) : undefined,
        body: (
          <>
            <Rows items={source} />
            {sourceIds.length > 0 && (
              <Fold label="Identifiers" tail={`${sourceIds.length} ${sourceIds.length === 1 ? 'key' : 'keys'}`}>
                <Rows items={sourceIds} />
              </Fold>
            )}
            {detail && (
              <>
                {(detail.kind || detail.label) && (
                  <div className="a-dw-chips">
                    {detail.kind && <Chip>{label(detail.kind)}</Chip>}
                    {detail.label && <span className="a-meta">{detail.label}</span>}
                  </div>
                )}
                {detail.quote && (
                  <blockquote className="a-quote">
                    <span className="a-dw-body">{detail.quote}</span>
                    {detail.callTitle && <span className="a-meta a-dim">{detail.callTitle}</span>}
                  </blockquote>
                )}
                {!detail.quote && detail.callTitle && <p className="a-dw-note">{detail.callTitle}</p>}
                {detail.text && <Well><span className="a-dw-body">{detail.text}</span></Well>}
                {detail.links.map(([k, url]) => (
                  <a className="a-dw-link" href={url} target="_blank" rel="noreferrer" key={k}>{k}</a>
                ))}
                <KeyRows items={detail.rows} />
              </>
            )}
            {points.length > 0 && (
              <Block label="Key points">
                <Well>{points.map((p, i) => <p className="a-dw-point" key={i}>{p}</p>)}</Well>
              </Block>
            )}
            {d.description && (
              <Block label="Description">
                <Well><Pre>{d.description}</Pre></Well>
              </Block>
            )}
            {source.length === 0 && sourceIds.length === 0 && !detail && points.length === 0 && !d.description && (
              <p className="a-dw-note">Pre-pipeline draft, no linked idea.</p>
            )}
          </>
        ),
      }]
      : []),
    {
      k: 'log', label: 'Log',
      tail: log.length ? `${agentCount} agent${agentCount === 1 ? '' : 's'}` : 'note only',
      body: (
        <>
          <AgentRegister log={log} />
          {lane === 'ivan' && <NoteComposer id={d.id} onDone={refresh} />}
          {lane !== 'ivan' && log.length === 0 && (
            <p className="a-dw-note">No agent activity recorded on this row.</p>
          )}
        </>
      ),
    },
    {
      k: 'meta', label: 'Fields',
      body: (
        <>
          {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
          {taxRows.length > 0 && <Block label="Taxonomy"><Rows items={taxRows} /></Block>}
          {/* ~25 further keys are live beyond the six named above. They render
              after the known ones, sorted, so a new key appears without a code
              edit — and every row of it is a LOOKUP, so it folds and the count
              rides on the summary. Nothing is dropped. */}
          {extras.length > 0 && (
            <Fold label="Taxonomy · other keys" tail={`${extras.length} keys`}>
              <KeyRows items={extras} />
            </Fold>
          )}
          {d.ig_caption && (
            <Fold label="IG caption" tail={`${d.ig_caption.length.toLocaleString()} chars`}>
              <Well><Pre>{d.ig_caption}</Pre></Well>
            </Fold>
          )}
          {d.pdf_url && (
            <Block label="PDF">
              <a className="a-dw-link" href={d.pdf_url} target="_blank" rel="noreferrer">Open PDF</a>
            </Block>
          )}
          {d.slide_metadata !== undefined && d.slide_metadata !== null && (
            <Block label="Slides"><Rows items={[['Slide metadata', <Val v={d.slide_metadata} key="s" />]]} /></Block>
          )}
        </>
      ),
    },
  ]
  // The stored answer can name a tab this row does not have (the store is
  // shared across every draft the window opens). Fall back to the first, never
  // to an empty panel.
  const active = panes.find(p => p.k === tab) ?? panes[0]

  const evidence = (
    <div className="a-dw-insp">
      <div className="a-dw-insp-h">
        <Tabs
          label="What decides it"
          options={panes.map(p => ({ id: p.k, label: p.label }))}
          value={active.k}
          onChange={pickTab}
          markerId="a-dw-tabs"
        />
        {/* The headline fact stays on the header — the score, the agent count
            and the source kind readable without reading the panel. */}
        {active.tail && <span className="a-mono a-dim a-dw-insp-t">{active.tail}</span>}
      </div>
      <div className="a-dw-insp-b">{active.body}</div>
    </div>
  )

  // A one-row queue has nowhere to walk to, so it draws no rail and the window
  // gives the width back to the artifact.
  const rail = queue.length > 1 && railOpen
    ? <QueueRail queue={queue} id={d.id} onPick={onPick} />
    : undefined
  const railToggle = queue.length > 1
    ? (
      <Button variant="quiet" size="sm" icon="list" aria-expanded={railOpen} onClick={toggleRail}>
        {at >= 0 ? `${at + 1} of ${queue.length}` : `${queue.length} in queue`}
      </Button>
    )
    : undefined

  return (
    <Takeover
      // The window is named for what it IS, not for what is in it: the draft's
      // own title is the document's first line, one row below, and printing it
      // twice was the double-title W1 left open.
      label="Content draft"
      sub={`${LANE_LABEL[lane]}${d.type ? ` · ${typeLabel(d.type)}` : ''}`}
      onClose={onClose}
      mobile={mobile}
      tail={railToggle}
      rail={rail}
      peer={evidence}
      foot={decisionBar}
      bodyClass="a-dw"
    >
      {artifact}
    </Takeover>
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

  if (detail && !error) {
    return (
      <Body
        key={detail.id}
        d={detail}
        lane={lane}
        queue={queue}
        refresh={refreshBoth}
        onClose={onClose}
        onPick={onPick}
        mobile={mobile}
      />
    )
  }

  return (
    <Takeover label="Content draft" sub={LANE_LABEL[lane]} onClose={onClose} mobile={mobile}>
      {error ? (
        <EmptyState icon="error" title="This draft" sub={error} />
      ) : loading ? (
        <div aria-hidden className="a-dw-sk">
          <Skeleton shape="title" width="70%" />
          <Skeleton width="40%" />
          <Skeleton shape="block" />
          <Skeleton shape="block" />
        </div>
      ) : missing ? (
        // Gone and unreadable are different facts. This one is gone.
        <EmptyState
          icon="doc"
          title="This draft is no longer in the database."
          sub="It was deleted while the queue was open."
        />
      ) : null}
    </Takeover>
  )
}
