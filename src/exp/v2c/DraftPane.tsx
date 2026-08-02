import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import {
  LANE_LABEL, STAGE_LABEL, deleteDraft, normalizeAgentLog, normalizeImageUrls,
  normalizeKeyPoints, normalizeQa, normalizeSourceDetail, reviewActionable, selfContainedHtml, stageOf,
  taxonomyExtras, taxonomyFields, taxonomyValue, updateDraftBody,
  type ContentDraftDetail, type ContentLane,
} from '../../lib/content'
import { ReviewActions } from './ReviewActions'
import { Block, KeyRows, Rows, Val } from './ContentBits'
import { AgentRegister, QaRegister } from './Register'
import { HtmlPreview, Takeover } from './Takeover'
import { absTime, relOrAhead, relTime, typeLabel } from './fmt'
import { Failed } from './Surface'

// A content draft, rendered as a TAKEOVER WINDOW (usability-voice ask 2).
//
// This surface was a 420px side peer, and Ivan's verbatim verdict on that was
// "its literally impossible to read… make it like before on the interface that
// opens a window so i can properly read". The register below is the cand-a
// DraftDetail idiom — full reading surface, comfortable measure — carried into
// the workbench through the shared Takeover chrome. The chat peer is NOT this:
// chat stays a side peer, this is a reading surface.
//
// Content order, per the ask: title/meta head, then the COVER IMAGE(S)
// rendered large, then the rendered HTML preview of the post as it will appear
// (authored_html, sandboxed iframe), then the full existing register — every
// block from the peer survives, because they are load-bearing.
//
// Every block renders only if its fields are populated: this row is written by
// a dozen n8n agents and most rows carry a third of the columns, so a fixed
// skeleton of em-dashes would read as broken rather than sparse.

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

// The editable Post block (ask 3b: "also allow to edit the content").
//
// Ivan lane only — the write is scoped .is('client_id', null) like approve, and
// the risedtc lane stays read-only by standing rule, so the affordance never
// renders there. EXPLICIT save; editing never touches status. The saved text is
// shown optimistically, with a visible Saved flash / red failed state, and the
// human-edit taxonomy markers ride in the same PATCH (the regen-clobber
// protection contract — see updateDraftBody).
function PostBlock({ d, lane }: { d: ContentDraftDetail; lane: ContentLane }) {
  const original = d.post_body ?? ''
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(original)
  const [shown, setShown] = useState(original)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Autosize to the content — the textarea keeps the block's measure.
  useEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [editing, text])

  if (!shown && !editing) return null

  const save = async () => {
    const body = text
    setBusy(true)
    // Optimistic: the block shows the new text at once; the state chip says
    // whether the database agreed.
    setShown(body)
    setEditing(false)
    try {
      await updateDraftBody(d.id, body, d.taxonomy)
      setState('saved')
      window.setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 2500)
    } catch {
      setState('failed')
      setEditing(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Block
      label="Post"
      tail={lane === 'ivan' && !editing
        ? (
          <>
            {state === 'saved' && <span className="wb-savestate ok">Saved</span>}
            {state === 'failed' && <span className="wb-savestate bad">Save failed — retry</span>}
            <button type="button" className="wb-editbtn" onClick={() => { setText(shown); setEditing(true) }}>
              Edit
            </button>
          </>
        )
        : undefined}
    >
      {editing ? (
        <div className="dd-card wb-editcard">
          {state === 'failed' && (
            <div className="wb-savestate bad wb-savestate-row">Save failed — the edit is still here, retry.</div>
          )}
          <textarea
            ref={taRef}
            className="wb-edit-ta"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <div className="ct-ac">
            <button type="button" className="btn s" disabled={busy}
              onClick={() => { setEditing(false); setText(shown); setState('idle') }}>
              Cancel
            </button>
            <button type="button" className="btn p" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dd-card"><div className="dd-body dd-pre">{shown}</div></div>
      )}
    </Block>
  )
}

// Delete, with its confirm INLINE (ask 3c: "there is no delete option").
// Distinct from Skip: skip archives a review-stage row visibly; delete removes
// the row from the surface entirely, at any stage. Ivan lane only — the write
// path is scoped .is('client_id', null) and the button never renders on
// risedtc. deleteDraft() carries the honest hard-DELETE-then-fallback contract.
function DeleteDraft({ d, onDone }: { d: ContentDraftDetail; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true)
    setErr('')
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

function Body({ d, lane, refresh, onClose }: {
  d: ContentDraftDetail; lane: ContentLane; refresh: () => void; onClose: () => void
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
      {/* structure_reason is the generator's own justification and belongs
          directly beneath the value it justifies, not in a grid of leftovers. */}
      {reason && <div className="ct-ref">{reason}</div>}
    </>])
  }
  if (tax.image_style) taxRows.push(['Image style', tax.image_style])
  if (tax.arm) taxRows.push(['Experiment arm', tax.arm])
  if (d.funnel_stage) taxRows.push(['Funnel stage', d.funnel_stage])
  if (strength) taxRows.push(['Topic strength', strength])

  const noImages = images.length === 0

  return (
    <>
      <div className="dd-head">
        <div className="dd-title">{d.title || d.topic || 'Untitled'}</div>
        {d.title && d.topic && d.title !== d.topic && <div className="ct-topic">{d.topic}</div>}
        <div className="ct-meta">
          <span className="ct-chip">{typeLabel(d.type)}</span>
          <span className={`ct-chip${stage === 'error' || stage === 'stuck' ? ' ct-chip-bad' : ''}`}>
            {STAGE_LABEL[stage]}
          </span>
          {lane === 'risedtc' && (
            <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
              {d.board_visible === true ? 'On Mattan’s board' : 'Internal'}
            </span>
          )}
        </div>
      </div>

      {/* An errored row's reason lives in taxonomy, which is why it renders next
          to the stage chip rather than three screens down in a key grid. Only a
          row that is errored NOW gets the red box; a recovered one renders the
          same field as history. */}
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

      {lane === 'risedtc' && noImages && d.status === 'review' && (
        // 🔴 The codified form of the regen trap: operator_schedule_draft refuses
        // a draft with no media and returns 'awaiting_media'. A regeneration
        // CLEARS image_urls, so the photo has to be re-pinned first.
        <div className="ct-warnbox">
          No image. A regen clears <code>image_urls</code>; the photo has to be
          re-pinned before this can be scheduled (<code>awaiting_media</code>).
        </div>
      )}

      {/* THE PREVIEW, at the top (ask 2): cover image(s) large, then the post
          as it will appear — authored_html in a script-less sandboxed iframe.
          The plain-text Post block below stays: it is the editable artifact. */}
      {images.length > 0 && (
        <Block label={images.length === 1 ? 'Cover image' : `Cover images · ${images.length}`}>
          <div className="dd-imgs">
            {images.map((u, i) => <img className="dd-img" src={u} alt="" key={`${u}-${i}`} />)}
          </div>
        </Block>
      )}

      {/* Only a SELF-CONTAINED document earns the frame: authored_html is
          usually a class-based fragment whose styles live in the render
          service's kit CSS, and framing that shows raw serif text — the
          opposite of "as it will appear". Those rows' honest render is the
          cover image(s) above (the service's own screenshots). */}
      {selfContainedHtml(authored) && (
        <Block label="Rendered preview">
          <HtmlPreview html={authored} title="Post as it will appear" />
        </Block>
      )}

      <PostBlock d={d} lane={lane} />

      {/* QA directly under the artifact: the score is the thing you check
          before deciding on the post. */}
      {qa && <QaRegister qa={qa} />}

      {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}

      {(source.length > 0 || detail) && (
        <Block label="Source">
          <Rows items={source} />
          {detail && (
            <>
              {(detail.kind || detail.label) && (
                <div className="ct-meta ct-src-m">
                  {detail.kind && <span className="ct-chip">{detail.kind}</span>}
                  {detail.label && <span className="ct-src-l">{detail.label}</span>}
                </div>
              )}
              {/* The real call quote the client board shows as its honest source
                  chip. */}
              {detail.quote && (
                <div className="ct-quote">
                  <div className="dd-body">“{detail.quote}”</div>
                  {detail.callTitle && <div className="ct-ref">{detail.callTitle}</div>}
                </div>
              )}
              {!detail.quote && detail.callTitle && <div className="ct-ref ct-ref-p">{detail.callTitle}</div>}
              {detail.text && <div className="dd-card"><div className="dd-body">{detail.text}</div></div>}
              {detail.links.length > 0 && detail.links.map(([k, url]) => (
                <a className="dd-link" href={url} target="_blank" rel="noreferrer" key={k}>{k} ↗</a>
              ))}
              {/* Unknown keys as rows — never dropped, and never handed to a JSX
                  child raw (AMENDMENTS §A4.2). */}
              <KeyRows items={detail.rows} />
            </>
          )}
          {source.length === 0 && !detail && (
            <div className="ct-subtle">Pre-pipeline draft — no linked idea.</div>
          )}
        </Block>
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

      <AgentRegister log={log} />

      {taxRows.length > 0 && <Block label="Taxonomy"><Rows items={taxRows} /></Block>}
      {/* ~25 further keys are live beyond the six named above. They render after
          the known ones, sorted, so a new key appears without a code edit. */}
      {extras.length > 0 && (
        <Block label="Taxonomy · other keys"><KeyRows items={extras} /></Block>
      )}

      {d.ig_caption && (
        <Block label="IG caption"><div className="dd-card"><div className="dd-body dd-pre">{d.ig_caption}</div></div></Block>
      )}
      {d.pdf_url && (
        <Block label="PDF">
          <a className="dd-link" href={d.pdf_url} target="_blank" rel="noreferrer">Open PDF ↗</a>
        </Block>
      )}

      {/* style_id is NULL on all 282 rows, regen_slides on all 282, video_status
          on all 282 — named in the spec so nobody re-adds them as empty rows. */}
      {d.slide_metadata !== undefined && d.slide_metadata !== null && (
        <Block label="Slides"><Rows items={[['Slide metadata', <Val v={d.slide_metadata} key="s" />]]} /></Block>
      )}

      {reviewActionable(d.status, lane) && (
        <div className="dd-actions"><ReviewActions id={d.id} onDone={() => { refresh(); onClose() }} /></div>
      )}
      {/* Skip ≠ Delete: Skip (above, review rows) archives visibly; Delete
          removes the row from every list, at any stage. Ivan lane only. */}
      {lane === 'ivan' && <DeleteDraft d={d} onDone={() => { refresh(); onClose() }} />}
      <div style={{ height: 28 }} />
    </>
  )
}

// The window. No "Ask Claude" here — Ivan: "why is that on the content drafts
// as well wtf.. remove that". The button stays on ThreadPeer (inbox threads),
// which he did not complain about.
export function DraftWindow({ id, lane, refresh, onClose, mobile }: {
  id: string
  lane: ContentLane
  refresh: () => void
  onClose: () => void
  mobile: boolean
}) {
  const { detail, missing, loading, error } = useDraftDetail(id)
  return (
    <Takeover
      label="Content draft"
      sub={`${LANE_LABEL[lane]}${detail?.type ? ` · ${typeLabel(detail.type)}` : ''}`}
      onClose={onClose}
      mobile={mobile}
    >
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
        <Body d={detail} lane={lane} refresh={refresh} onClose={onClose} />
      )}
    </Takeover>
  )
}
