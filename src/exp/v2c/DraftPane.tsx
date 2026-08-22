import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  ClientRpcError, DraftSaveConflict, LANE_LABEL, LANE_POSSESSIVE, STAGE_LABEL, approveDraft, boardGroupOf, groupLogByAgent,
  canPromote, canRestartToIdea, canUnpromote, clientDeletable, clientEditable, clientStageLabel, deleteClientDraft,
  deleteDraft, normalizeAgentLog, normalizeImageUrls, normalizeKeyPoints, normalizeQa,
  normalizeSourceDetail, restartDraftToIdea, reviewActionable, saveClientDraftBody, saveDraftBody, selfContainedHtml,
  setBoardVisible, setDraftImage, skipDraft, stageOf, STILL_FOLDERS, listStills,
  taxonomyExtras, taxonomyFields, taxonomyValue,
  type ContentDraft, type ContentDraftDetail, type ContentLane, type SaveConflict,
  type Still, type StillFolder,
} from '../../lib/content'
import { appendAgentNote, clearHumanEdit, planRegen, regenerateDraft, scheduleDraft } from '../../lib/studioActions'
import { label } from '../../lib/labels'
import { Block, KeyRows, Rows, Val } from './ContentBits'
import { AgentRegister, Fold, QaRegister } from './Register'
import { HtmlPreview, Takeover } from './Takeover'
import { LinkedInPost } from './LinkedInPost'
import { absTime, linkedInPostUrl, postTime, relOrAhead, relTime, typeLabel } from './fmt'
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

export type QueueItem = {
  id: string; title: string; type: string | null; updated_at: string; status: string
  // WHEN IT POSTS. Optional because the LM queue (`toLmQueueItem`) has no such
  // column — a resource is not scheduled, it is published or it is not.
  scheduled_at?: string | null
}

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
      {/* Sticky, because a 16-row rail scrolls past its own header and "1/16"
          is the one fact on it that stays true while you walk. */}
      <div className="dw-queue-h">
        <span>In this queue</span>
        <b>{at >= 0 ? at + 1 : '–'}/{queue.length}</b>
      </div>
      {queue.map((q, i) => (
        <button
          type="button"
          key={q.id}
          className={`dw-qrow${q.id === id ? ' on' : ''}`}
          onClick={() => onPick(q.id)}
        >
          {/* The ordinal, at a fixed x, tabular — it is what makes the rail read
              as a QUEUE and not as a second copy of the list. It also gives the
              title one left edge to run from at every row. */}
          <span className="dw-qrow-i">{i + 1}</span>
          <span className="dw-qrow-b">
            {/* ONE line, not two (2026-08-10, "the queue as well nicer looking...
                cleaner"). Two clamped lines gave every row a ragged height and a
                second edge; the row you are ON opens to two, because that is the
                one title worth reading in full. */}
            <span className="dw-qrow-t">{q.title || 'Untitled'}</span>
            {/* WHEN IT POSTS, when the row has a time. `Text · 1d ago` spent the
                whole meta line on the format (identical down the rail) and the
                row's age (not a fact you schedule around). */}
            <span className="dw-qrow-m">
              {q.scheduled_at
                ? <b className="dw-qrow-w">{postTime(q.scheduled_at)}</b>
                : `${typeLabel(q.type)} · ${relTime(q.updated_at)}`}
            </span>
          </span>
        </button>
      ))}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// A collapsible inspect section, with its open state persisted
// ---------------------------------------------------------------------------

// THE EVIDENCE RAIL IS TABBED (D16).
//
// It was five accordions in one scroller and measured 3,313px of scrollHeight
// against a 754px column — 4.4 screens, of which the QA section alone was
// 1,240px. Every section could be open at once, so "where is the source
// briefing" was a scroll through the judge's prose rather than a click. Same
// five sections, same order, same content, one at a time: the rail is now the
// height of ONE section and the other four are one tap away with their headline
// fact printed on the tab.
//
// A tab whose content does not exist on this row is never rendered — the
// artifact and the source briefing are genuinely absent on most drafts, and a
// dead tab is a worse lie than a missing one.
type InspTab = { k: string; label: string; tail?: ReactNode; body: ReactNode }

function InspRail({ tabs, tab, pick }: {
  tabs: InspTab[]; tab: string; pick: (k: string) => void
}) {
  // The stored answer can name a tab this row does not have (the store is
  // shared across every draft the window opens). Fall back to the first, never
  // to an empty panel.
  const active = tabs.find(t => t.k === tab) ?? tabs[0]
  return (
    <aside className="dw-insp">
      {/* NO TABS (2026-08-09, Ivan: "the right side is also pretty disgusting
          it would be better if i can actually have 3 columns to see stuff
          faster"). Every panel is on the page, one under the other, with its
          headline fact on its own header — so QA, Source, Log and Fields are
          read by SCROLLING, not by remembering which of four buttons holds the
          thing you wanted. The tab state is kept and now scrolls to a section
          instead of hiding the other three. */}
      <div className="dw-insp-h">
        {/* Was "Backend depth", the owner's own named complaint ("this looks
            like an internal tool ui"), because the four tabs underneath it
            are the QA verdict, the source, the generation log and the raw
            fields, i.e. what a reader checks to decide the draft's fate, not
            a claim about the app's architecture. */}
        <span>What decides it</span>
        <span className="dw-insp-j">
          {tabs.map(t => (
            <button key={t.k} type="button"
              className={`dw-jump${active?.k === t.k ? ' on' : ''}`}
              onClick={() => {
                pick(t.k)
                document.getElementById(`dw-sec-${t.k}`)?.scrollIntoView({ block: 'start' })
              }}
            >{t.label}</button>
          ))}
        </span>
      </div>
      {tabs.map(t => (
        <section className="dw-sec" id={`dw-sec-${t.k}`} key={t.k}>
          <div className="dw-sec-h">
            <span className="dw-sec-n">{t.label}</span>
            {/* The headline fact stays on the header — the score, the agent
                count and the source kind readable without reading the panel. */}
            {t.tail && <span className="dw-sec-t">{t.tail}</span>}
          </div>
          <div className="dw-sec-body">{t.body}</div>
        </section>
      ))}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// REGENERATE — unchanged contract, now IN THE STICKY ACTION BAR.
//
// It lived at the bottom of the scrolling artifact column until 2026-08-07,
// which measured as the same defect the drawer had: `.dw-main` clientHeight
// 754 against scrollHeight 1984, the button's top at 1887 — 1,133px below the
// fold, off screen at 1440x900 AND at 390x844, while five keyboard actions sat
// pinned on screen. "Unconditionally rendered" was never the ask; "on screen"
// was. The trigger is a `.dw-key` like every other decision, and the confirm
// unfolds as a full-width row inside the same bar, so the warning arrives
// pinned rather than wherever the reader happens to be scrolled.
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

function RegenDraft({ d, onDone, disabled }: {
  d: ContentDraftDetail; onDone: () => void; disabled?: boolean
}) {
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

  // A Fragment, not a wrapper: these are children of `.dw-acts` itself, so the
  // button sits in the button row and the confirm claims a row of its own
  // (`.dw-actrow` is `flex:1 0 100%` against the bar's wrap).
  return (
    <>
      {note && <div className="dw-actrow ct-subtle">{note}</div>}
      {err && <div className="dw-actrow ops-err">{err}</div>}
      {/* "Regenerate copy" until 08-07. The noun moved into the confirm, which
          is where the copy/image fork is actually decided ("Copy only" /
          "Copy + new image") — and the two words it costs are a whole wrapped
          row of a 390px bar. */}
      <button type="button" className="dw-key" disabled={disabled} aria-expanded={asking}
        onClick={() => setAsking(a => !a)}>
        {first ? 'Generate' : 'Regenerate'}
      </button>
      {asking && (
        <div className="dw-actrow wb-delconfirm">
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
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// RESTART TO IDEA — the old board's third regeneration verb, ported (parity 3b).
//
// Regenerate re-runs the pipeline ON this row. This one sends the row back to
// the START of the pipeline: status='idea', so the whole chain re-derives it.
// The board offered it from the inline status control (PostStudioPanel.tsx:
// 610-614) and v2 offered nothing, so a draft whose generation had gone wrong
// at the source could only be regenerated in place or deleted.
//
// The write, the Ivan-lane scope and the warning all live in
// content.ts:restartDraftToIdea, which takes the confirm as an ARGUMENT — this
// component cannot skip the sheet, and the words are the board's own.
// ---------------------------------------------------------------------------

function RestartDraft({ d, onDone, disabled }: {
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
      {note && <div className="dw-actrow ct-subtle">{note}</div>}
      {err && <div className="dw-actrow ops-err">{err}</div>}
      <button type="button" className="dw-key" disabled={busy || disabled} onClick={run}>
        {busy ? 'Sending back…' : 'Back to idea'}
      </button>
    </>
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
// SWAP IMAGE — pick the post's photo out of the still library.
//
// 2026-08-09, Ivan: "we do need regen copy - swap image so we can add other
// library image". Before this the photo was whatever `Text Post Photo Assigner`
// pinned, a regeneration wiped `image_urls` outright, and the operator had no
// way to say "not that one, this one" short of a SQL update.
//
// It unfolds INSIDE the sticky bar, like the Regenerate and Delete confirms —
// the bar is where the acts live and a picker that opened its own modal on top
// of a modal would be the third layer of window on this screen.
// ---------------------------------------------------------------------------

function SwapImage({ d, onDone, disabled }: {
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
      <button type="button" className="dw-key" disabled={disabled} aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        {current ? 'Swap image' : 'Add image'}
      </button>
      {open && (
        <div className="dw-swap">
          <div className="dw-swap-h">
            {STILL_FOLDERS.map(f => (
              <button key={f} type="button"
                className={`ct-chip dw-swap-f${f === folder ? ' on' : ''}`}
                onClick={() => setFolder(f)}
              >{f}</button>
            ))}
            <span className="dw-swap-sp" />
            {current && (
              <button type="button" className="dw-swap-clr" disabled={!!busy} onClick={() => pick(null)}>
                {busy === 'none' ? 'Removing…' : 'Remove photo'}
              </button>
            )}
          </div>
          {err && <div className="ops-err">{err}</div>}
          {!stills && !err && <div className="ct-subtle">Reading the library…</div>}
          {stills && stills.length === 0 && <div className="ct-subtle">Nothing in this folder.</div>}
          {stills && stills.length > 0 && (
            <div className="dw-swap-g">
              {stills.map(s => (
                <button key={s.url} type="button" title={s.name} disabled={!!busy}
                  className={`dw-swap-t${s.url === current ? ' on' : ''}`}
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
                  {busy === s.url && <span className="dw-swap-b">Pinning…</span>}
                </button>
              ))}
            </div>
          )}
          {/* 🔴 The photo is not sticky. A regeneration clears image_urls, so a
              swap made BEFORE a regen is discarded by it — pin the picture
              after the words are settled. */}
          <div className="ct-subtle dw-swap-n">
            A regeneration clears <code>image_urls</code>, so pin the photo after the copy is final.
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DELETE — confirm inline. Distinct from Skip: skip archives a review-stage row
// visibly; delete removes it from the surface entirely, at any stage. Ivan lane
// only; deleteDraft() carries the hard-DELETE-then-fallback contract.
//
// It rides in the same sticky bar as Regenerate (2026-08-07), LAST and in the
// danger register, so the destructive act is reachable without being the one
// the thumb lands on.
// ---------------------------------------------------------------------------

function DeleteDraft({ d, onDone, disabled }: {
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
      {err && <div className="dw-actrow ops-err">{err}</div>}
      <button type="button" className="dw-key d" disabled={disabled} aria-expanded={confirming}
        onClick={() => setConfirming(c => !c)}>
        Delete
      </button>
      {confirming && (
        <div className="dw-actrow wb-delconfirm">
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
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DELETE, on the CLIENT lane.
//
// 🔴 The one place a delete can reach a paying client. The board's `queue` is a
// denormalised copy of the promoted drafts and only operator_set_board_visible
// rebuilds it, so deleting a row that is ON the board removes it from our side
// and leaves a full copy of it on Mattan's, with nothing scheduled to clean it
// up. deleteClientDraft refuses that case server-side after re-reading
// board_visible; this component refuses it on the surface AND says why, because
// an affordance that is simply absent is what produced Ivan's message in the
// first place.
// ---------------------------------------------------------------------------

function DeleteClientDraft({ d, lane, onDone }: { d: ContentDraftDetail; lane: ContentLane; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!clientDeletable(lane, d.board_visible)) {
    return (
      <div className="wb-delzone">
        <div className="ct-subtle">
          On {LANE_POSSESSIVE[lane]} board, so it can’t be deleted from here — his board keeps its own copy of
          every promoted post, and only taking it off the board rebuilds that copy. Take it off
          first, then delete.
        </div>
      </div>
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
    <div className="wb-delzone">
      {err && <div className="ops-err">{err}</div>}
      {confirming ? (
        <div className="wb-delconfirm">
          <span className="wb-delq">
            Delete this draft? Mattan has never seen it, and this removes it permanently.
          </span>
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
  // The section header counts AGENTS, because that is what the register now
  // renders — 43 entries from 14 agents reads as "14", not as "43".
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

  // ---- collapse state, persisted (same store as the lane's filters) --------
  // ---- the evidence rail's ACTIVE TAB, persisted (same store as before) ----
  // The array now holds exactly one key. A browser carrying the old multi-open
  // answer reads its first entry, which is the section that was at the top of
  // that scroller anyway — so nobody lands on a rail they did not choose.
  const [sect, setSect] = useSectionState('content.draftwindow')
  const tab = sect.open[0] ?? 'qa'
  const pickTab = useCallback((k: string) => {
    setSect(p => ({ ...p, open: [k] }))
  }, [setSect])

  // ---- the editor ---------------------------------------------------------
  //
  // Mattan's lane is editable too now, through a DIFFERENT write. The Ivan-lane
  // saveDraftBody is scoped `.is('client_id', null)` and always will be; the
  // client path goes through operator_edit_draft_body, which is the mirror
  // image (`client_id is not null`) and additionally refuses anything outside
  // status review/scheduled. clientEditable carries that second rule, so the
  // button is absent exactly when the database would refuse — and where it is
  // absent, the note below the actions says why.
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
      if (nextId) onPick(nextId)
      else onClose()
    } catch (e) {
      setActErr(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally { setActing(false) }
  }, [actionable, acting, confirm, d.id, nextId, onPick, onClose, refresh])

  // ---- the CLIENT decision: promote / take back --------------------------
  //
  // Ivan: "in mattan's case, after i approve needs review it goes to the
  // board". That is the lifecycle, and this is the write that performs it —
  // NOT approveDraft, which on a client row would set status='approved' and
  // thereby lock the draft off the board for good (operator_set_board_visible
  // only promotes from 'review').
  //
  // Optimistic with rollback, exactly like the dashboard's own onToggle. The
  // local flag is what makes the chip and the delete zone flip on the spot;
  // the list underneath re-groups off its own refetch.
  const [visible, setVisible] = useState<boolean | null | undefined>(d.board_visible)
  useEffect(() => { setVisible(d.board_visible) }, [d.id, d.board_visible])
  const [promoting, setPromoting] = useState(false)
  const [promoteErr, setPromoteErr] = useState('')
  // Both read the OPTIMISTIC flag, not the fetched row, so the pair of buttons
  // swaps the instant the decision is taken rather than after the refetch.
  const promotable = canPromote(d.status, lane) && visible !== true
  const unpromotable = canUnpromote(lane, visible)

  const promote = useCallback(async (next: boolean) => {
    if (promoting) return
    // 🔴 CLIENT-FACING. `true` is the only action in this whole app that puts
    // something in front of a paying client, so the sheet says that first, in
    // those words, and then says what it does NOT do — because "approve" in
    // Ivan's other lane means a status mark, and the same key here means Mattan
    // sees it.
    const ok = await confirm(next ? {
      title: 'Put this on Mattan’s board?',
      message:
        'Mattan sees it. This is the one action here that reaches a client — it fires his board’s '
        + 'own sync, so it lands on his board within moments, not at some later batch. From there '
        + 'the decisions are his: approve, edit, veto, schedule. '
        + 'Nothing publishes — this writes board visibility and never touches the publisher.',
      confirmText: 'Put it on his board',
    } : {
      title: 'Take this off Mattan’s board?',
      message:
        'It goes back to our side only and disappears from his board on the same sync. Nothing is '
        + 'deleted and no status changes — the draft stays here, and you can put it back.',
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
      // THE LETTER KEYS ARE GONE (2026-08-09, Ivan: "no need for keyboard quick
      // access"). a/r/e/s/o each carried a <kbd> badge on its button, and the
      // badges were half the visual noise in the action bar for an operator who
      // uses the mouse. j/k stay: they walk the queue, cost no chrome, and the
      // rail on the left already shows what they move through.
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
  }, [at, queue, editing, editable, actionable, promotable, promote, decide, nextId, onPick, startEdit])

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
  // client_idea_id and source_candidate_id used to render here as bare UUIDs
  // under "Idea"/"Candidate": internal foreign keys with no page in this app
  // that opens from one, so the id itself answered no question a reader could
  // act on. Deleted rather than laundered into a fake label (phase2-labels).
  if (d.source_post_id) {
    // The live LinkedIn post this draft was spun from (content.ts:42), a
    // real fact, so it earns a link rather than a raw urn:li:activity print.
    // The urn stays reachable on hover/copy for the rare support case that
    // needs the literal id.
    const url = linkedInPostUrl(d.source_post_id)
    source.push(['Spun from post', url
      ? <a className="dd-link" href={url} target="_blank" rel="noreferrer" title={d.source_post_id}>
        View the live post ↗
      </a>
      : <span title={d.source_post_id}>Live post (link unavailable)</span>])
  }
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

  // ---- the sticky bar's REAL height ---------------------------------------
  //
  // Below 1180 the window is one scroller and the bar is pinned to the bottom
  // of it, so whatever sits at the end of the artifact column ends up under it
  // (D15). The clearance underneath has to be the bar's MEASURED height, not a
  // constant: the bar wraps, and how many rows it wraps to depends on the lane,
  // the stage and whether a confirm is unfolded inside it — 92px was already
  // two rows before this run added three buttons to it. The var is read by
  // `.dw-main{padding-bottom}` in the ≤1180 block, and defaults to 0, so the
  // magnets window (same markup, no observer) is untouched.
  const actsRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = actsRef.current
    const col = mainRef.current
    if (!bar || !col || typeof ResizeObserver === 'undefined') return
    const set = () => col.style.setProperty('--dw-actsh', `${Math.ceil(bar.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  // ---- 02 · the artifact --------------------------------------------------
  const main = (
    <div className="dw-main" ref={mainRef}>
      <div className="dw-main-in">
        <div className="dw-cap">
          <div className="dw-cap-t">{d.title || d.topic || 'Untitled'}</div>
          {queue.length > 1 && at >= 0 && (
            <span className="dw-pos">{at + 1} of {queue.length}</span>
          )}
        </div>
        <div className="ct-meta" style={{ padding: '0 16px 4px' }}>
          <span className="ct-chip">{typeLabel(d.type)}</span>
          {/* One status, two meanings. `review` here is "waiting on Mattan"
              when he has it and "waiting on you" when he does not, so the chip
              reads the promotion state rather than repeating the raw stage —
              and it reads the OPTIMISTIC flag, so it flips on the decision. */}
          <span className={`ct-chip${stage === 'error' || stage === 'stuck' ? ' ct-chip-bad' : ''}`}>
            {lane !== 'ivan'
              ? clientStageLabel(stage, boardGroupOf({ board_visible: visible }))
              : STAGE_LABEL[stage]}
          </span>
          {/* 🔴 WHEN IT POSTS, FIRST-CLASS (2026-08-10, Ivan: "i cant really
              see post time"). It existed only as one row of the Fields panel,
              four sections down a 4,527px rail, while the chip in this slot
              printed how old the ROW was. On an armed draft that is the fact the
              whole window is about, so it gets its own mark, ahead of the age,
              and the age keeps its own chip rather than being replaced by it. */}
          {d.scheduled_at && (
            <span className="ct-chip ct-chip-when" title={`Scheduled for ${absTime(d.scheduled_at)}`}>
              {/* "Posts" only while the time is still ahead. A scheduled row
                  whose slot has passed has either published or missed, and this
                  chip knows neither — so it states the time and how long ago it
                  was, and claims nothing about what happened at it. */}
              {Date.parse(d.scheduled_at) > Date.now() ? 'Posts ' : 'Post time '}
              {postTime(d.scheduled_at)} · {relOrAhead(d.scheduled_at)}
            </span>
          )}
          <span className="ct-chip" title={`Last edited ${absTime(d.updated_at)}`}>
            edited {relTime(d.updated_at)}
          </span>
          {lane !== 'ivan' && (
            <span className={visible === true ? 'ct-lane' : 'ct-chip'}>
              {visible === true ? `On ${LANE_POSSESSIVE[lane]} board` : 'Not on his board'}
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

        {lane !== 'ivan' && images.length === 0 && d.status === 'review' && (
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

        {/* Regenerate, Back to idea and Delete used to sit HERE, at the foot of
            the scrolling column (2026-08-04, Ivan: "we need edit option and
            regen option"). Rendering them unconditionally was not enough —
            measured 1,133px below the fold at both viewports — so they moved
            into the sticky bar below. Only Schedule stays behind `o`: it is the
            one affordance here that ARMS A PUBLISHER. */}
        {more && lane === 'ivan' && (
          <div style={{ marginBottom: 4 }}>
            <ScheduleDraft d={d} onDone={refresh} />
          </div>
        )}
        {lane !== 'ivan' && (
          <div style={{ marginBottom: 4 }}>
            <DeleteClientDraft
              d={{ ...d, board_visible: visible }}
              lane={lane}
              onDone={() => { refresh(); if (nextId) onPick(nextId); else onClose() }}
            />
          </div>
        )}

        {promoteErr && <div className="ops-err" style={{ margin: '10px 16px 0' }}>{promoteErr}</div>}

        {/* WHY THERE IS NO BUTTON. An affordance that is simply missing is what
            produced Ivan's message; on this lane every gap now states the rule
            that closes it, and the rule is the database's, not a house style. */}
        {lane !== 'ivan' && !promotable && !unpromotable && (
          <div className="ct-subtle dw-clientnote">
            {d.status === 'error'
              ? `This one errored, and only a draft at Needs review can go on ${LANE_POSSESSIVE[lane]} board. Fix or regenerate it on our side first — nothing here reaches him.`
              : `Not promotable at ${STAGE_LABEL[stage].toLowerCase()} — the database only promotes a draft that is still at Needs review.`}
          </div>
        )}
        {lane !== 'ivan' && !editable && (
          <div className="ct-subtle dw-clientnote">
            {LANE_POSSESSIVE[lane]} copy is only editable while the draft is at Needs review or Scheduled. At{' '}
            {STAGE_LABEL[stage].toLowerCase()} the words are settled — edit it on his board instead.
          </div>
        )}

        {/* While the editor is open every one of these would leave the row —
            approving, skipping or walking to the next draft all discard unsaved
            words with no prompt. The keyboard already refuses (the `editing`
            bail in the handler); the buttons have to refuse too, or the guard is
            only a guard for people who use keys. */}
        <div className="dw-acts" ref={actsRef}>
          {/* Skip is GONE (2026-08-09). It archived the row — a destructive act
              wearing a neutral word, sitting second in the bar next to Approve.
              Delete, at the far end and behind a confirm, is the honest version
              of "get this out of my queue", and the queue rail walks past a row
              without judging it. */}
          {actionable && (
            // phase2: same demotion as the card's ReviewActions. A row that
            // already failed does not get to keep Approve at primary weight.
            <button type="button" className={`dw-key${d.status === 'error' ? '' : ' p'}`} disabled={acting || editing}
              onClick={() => decide('approve')}>
              Approve
            </button>
          )}
          {/* 🔴 The client-facing decision. It wears the same `a` key and the
              same primary weight as Ivan's Approve because it is the same
              gesture in his hands — but never the same WORD, because this one
              is seen by a paying client and "Approve" would not say so. */}
          {promotable && (
            <button type="button" className="dw-key p" disabled={promoting || editing}
              onClick={() => promote(true)}>
              {promoting ? 'Putting it up…' : 'Put on Mattan’s board'}
            </button>
          )}
          {unpromotable && (
            <button type="button" className="dw-key" disabled={promoting || editing}
              onClick={() => promote(false)}>
              {promoting ? 'Taking it off…' : 'Take off his board'}
            </button>
          )}
          {editable && !editing && (
            <button type="button" className="dw-key" onClick={startEdit}>Edit</button>
          )}
          {/* `Next` is GONE too: the queue rail on the left is the queue, every
              row of it is one click, and a button that only ever means "the one
              below this one" was a worse version of the list. */}
          {lane === 'ivan' && (
            <button type="button" className="dw-key" disabled={editing} aria-expanded={more}
              onClick={() => setMore(m => !m)}>
              {more ? 'Hide schedule' : 'Schedule'}
            </button>
          )}
          {/* The regeneration/media/removal acts. They refuse while the editor
              is open for the same reason the decisions do: each of them
              discards unsaved words without asking. */}
          {lane === 'ivan' && (
            <>
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
            </>
          )}
          {editing && <span className="dw-hint">Save or cancel the edit first</span>}
        </div>
      </div>
    </div>
  )

  // ---- 03 · the evidence --------------------------------------------------
  const inspTabs: InspTab[] = [
    {
      k: 'qa', label: 'QA',
      tail: qa ? (qa.score !== null ? `${qa.score}` : qa.verdict ?? undefined) : 'none',
      body: qa
        ? <QaRegister qa={qa} />
        : <div className="ct-subtle">No gate has scored this row.</div>,
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
    ...((source.length > 0 || detail || points.length > 0 || d.description)
      ? [{
        k: 'src', label: 'Source', tail: detail?.kind ? label(detail.kind) : undefined,
        body: (
          <>
            <Rows items={source} />
            {detail && (
              <>
                {(detail.kind || detail.label) && (
                  <div className="ct-meta ct-src-m">
                    {detail.kind && <span className="ct-chip">{label(detail.kind)}</span>}
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
            <div className="ct-subtle">No agent activity recorded on this row.</div>
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
              edit.

              🔴 FOLDED 2026-08-10 ("the back end depth i need to scroll a lot").
              Measured 569px on the live proof row, in the LAST panel of a
              4,527px rail, and every row of it is a LOOKUP — you arrive at it
              with a key in mind, never by scrolling past it. Same control and
              same grammar as the QA panel's folds, with the count on the
              summary so the fold states its own cost. Nothing is dropped. */}
          {extras.length > 0 && (
            <Fold label="Taxonomy · other keys" tail={`${extras.length} keys`}>
              <KeyRows items={extras} />
            </Fold>
          )}
          {/* 457px of caption on a row nobody opened this window to read: the IG
              mirror has its own surface, and this panel is where you come to
              check a field, not to proof the caption. */}
          {d.ig_caption && (
            <Fold label="IG caption" tail={`${d.ig_caption.length.toLocaleString()} chars`}>
              <div className="dd-card"><div className="dd-body dd-pre">{d.ig_caption}</div></div>
            </Fold>
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
        </>
      ),
    },
  ]
  const insp = <InspRail tabs={inspTabs} tab={tab} pick={pickTab} />

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
