import { type ReactNode, useState } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import {
  STAGE_LABEL, normalizeAgentLog, normalizeImageUrls, normalizeKeyPoints, normalizeQa,
  reviewActionable, stageOf, taxonomyFields,
  type ContentDraftDetail, type ContentLane,
} from '../../lib/content'
import { ReviewActions } from './ReviewActions'
import { absTime, relOrAhead, relTime, typeLabel } from './fmt'
import { Failed } from './Surface'

// A content draft, rendered as a PEER rather than a full-screen overlay. Same
// register as cand-a's detail screen (that surface was already right); the change
// is structural — on the workbench it sits beside the list it came from and
// beside Claude, so "ask about this draft" does not mean losing sight of it.
//
// Every block renders only if its fields are populated: this row is written by a
// dozen n8n agents and most rows carry a third of the columns, so a fixed
// skeleton of em-dashes would read as broken rather than sparse.

function Block({ label, children }: { label: string; children: ReactNode }) {
  return <><div className="res-hdr">{label}</div>{children}</>
}

function Rows({ items }: { items: [string, ReactNode][] }) {
  if (items.length === 0) return null
  return (
    <div className="dd-card">
      {items.map(([k, v]) => (
        <div className="dd-row" key={k}>
          <div className="dd-k">{k}</div>
          <div className="dd-v">{v}</div>
        </div>
      ))}
    </div>
  )
}

function Clamp({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220 || text.split('\n').length > lines
  return (
    <div onClick={long ? () => setOpen(o => !o) : undefined}>
      <div
        className={`dd-body${!open && long ? ' dd-clamp' : ''}`}
        style={!open && long ? ({ WebkitLineClamp: lines } as React.CSSProperties) : undefined}
      >{text}</div>
      {long && <div className="dd-more">{open ? 'Show less' : 'Show more'}</div>}
    </div>
  )
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function Body({ d, lane, refresh, onClose }: {
  d: ContentDraftDetail; lane: ContentLane; refresh: () => void; onClose: () => void
}) {
  const stage = stageOf(d)
  const tax = taxonomyFields(d.taxonomy)
  const log = normalizeAgentLog(d.agent_log)
  const qa = normalizeQa(d.qa)
  const points = normalizeKeyPoints(d.key_points)
  const images = normalizeImageUrls(d.image_urls)
  const strength = scalar(d.topic_strength)

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
  if (d.source_detail) source.push(['Detail', d.source_detail])
  if (d.source_ref) source.push(['Ref', d.source_ref])

  const taxRows: [string, ReactNode][] = []
  if (tax.pillar) taxRows.push(['Pillar', tax.pillar])
  if (tax.hook_type) taxRows.push(['Hook', tax.hook_type])
  if (tax.structure_used) taxRows.push(['Structure', tax.structure_used])
  if (tax.image_style) taxRows.push(['Image style', tax.image_style])
  if (tax.arm) taxRows.push(['Experiment arm', tax.arm])
  if (d.funnel_stage) taxRows.push(['Funnel stage', d.funnel_stage])
  if (strength) taxRows.push(['Topic strength', strength])

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
              {d.board_visible === true ? 'On Rise’s board' : 'Internal'}
            </span>
          )}
        </div>
      </div>

      {qa && (
        // QA rides at the TOP here, not near the bottom as on the phone: on a
        // workbench the score is the thing you check before reading the post.
        <div className="wb-qa">
          {qa.score !== null && <div className="wb-qa-n">{qa.score}</div>}
          <div className="wb-qa-r">
            {qa.verdict && (
              <span className={`ct-chip ${qa.pass ? 'ct-chip-ok' : 'ct-chip-warn'}`}>{qa.verdict}</span>
            )}
            <div className="wb-qa-g">
              <span className="wb-qa-fill" style={{
                width: `${Math.max(0, Math.min(100, qa.score ?? 0))}%`,
                background: qa.pass ? 'var(--accent)' : '#FF9F0A',
              }} />
            </div>
          </div>
        </div>
      )}
      {qa?.feedback && <div className="dd-card"><Clamp text={qa.feedback} lines={3} /></div>}

      {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
      {source.length > 0 && <Block label="Source"><Rows items={source} /></Block>}

      {d.post_body && (
        <Block label="Post">
          <div className="dd-card"><div className="dd-body dd-pre">{d.post_body}</div></div>
        </Block>
      )}

      {images.length > 0 && (
        <Block label={images.length === 1 ? 'Image' : `Images · ${images.length}`}>
          <div className="dd-imgs">
            {images.map((u, i) => <img className="dd-img" src={u} alt="" key={`${u}-${i}`} />)}
          </div>
        </Block>
      )}

      {points.length > 0 && (
        <Block label="Key points">
          <div className="dd-card">{points.map((p, i) => <div className="dd-point" key={i}>{p}</div>)}</div>
        </Block>
      )}

      {d.description && (
        <Block label="Description"><div className="dd-card"><Clamp text={d.description} lines={4} /></div></Block>
      )}

      {log.length > 0 && (
        <Block label="Generation register">
          <div className="dd-card">
            {log.map((e, i) => (
              <div className="dd-log" key={i}>
                {e.ts && <div className="dd-log-ts">{absTime(e.ts)}</div>}
                <Clamp text={e.body} lines={5} />
              </div>
            ))}
          </div>
        </Block>
      )}

      {taxRows.length > 0 && <Block label="Taxonomy"><Rows items={taxRows} /></Block>}

      {d.ig_caption && (
        <Block label="IG caption"><div className="dd-card"><div className="dd-body dd-pre">{d.ig_caption}</div></div></Block>
      )}
      {d.pdf_url && (
        <Block label="PDF">
          <a className="dd-link" href={d.pdf_url} target="_blank" rel="noreferrer">Open PDF ↗</a>
        </Block>
      )}

      {reviewActionable(d.status, lane) && (
        <div className="dd-actions"><ReviewActions id={d.id} onDone={() => { refresh(); onClose() }} /></div>
      )}
      <div style={{ height: 28 }} />
    </>
  )
}

export function DraftPane({ id, lane, refresh, onClose, onAsk, mobile }: {
  id: string
  lane: ContentLane
  refresh: () => void
  onClose: () => void
  // "Ask Claude about this" — on the wide canvas it docks the chat peer beside
  // this one; on a phone it pushes chat over it, carrying this draft's name.
  onAsk: () => void
  mobile: boolean
}) {
  const { detail, missing, loading, error } = useDraftDetail(id)
  // The pane header does NOT repeat the title. It used to, and the body's own
  // <div class="dd-title"> printed the same sentence again two rows below it —
  // the same doubled-render defect the panel found on Ops, in a second place, and
  // found here by diffing duplicated visible text inside the peer rather than by
  // reading the file. The body wins the title because a draft's title is a whole
  // sentence and the header can only ellipsize it to one line; the header keeps
  // what a pane header is for, which is saying what kind of thing this is.
  return (
    <>
      <div className="wb-pane-h">
        {mobile && <span className="back" onClick={onClose}>‹</span>}
        <span className="wb-pane-ic">▤</span>
        <div className="wb-pane-ttl">
          <div className="wb-pane-n">Content draft</div>
          <div className="wb-pane-s">
            {lane === 'ivan' ? 'Ivan' : 'Rise'}
            {detail?.type ? ` · ${typeLabel(detail.type)}` : ''}
          </div>
        </div>
        <button className="wb-ask" onClick={onAsk}>Ask Claude</button>
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>
      <div className="rows">
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
      </div>
    </>
  )
}
