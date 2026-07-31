import { type ReactNode, useState } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import {
  normalizeAgentLog, normalizeImageUrls, normalizeKeyPoints, normalizeQa,
  reviewActionable, stageOf, taxonomyFields, STAGE_LABEL,
  type ContentDraftDetail, type ContentLane,
} from '../../lib/content'
import { ReviewActions } from './ReviewActions'
import { absTime, relOrAhead, relTime, typeLabel } from './fmt'

// Full-screen push, same idiom as ThreadScreen (position:fixed .ct-overlay so
// it covers the tab bar too, back chevron top-left). Every block below renders
// ONLY if its fields are populated — this row is written by a dozen different
// n8n agents and most rows carry a third of the columns, so a fixed skeleton of
// "—" placeholders would read as a broken record instead of a sparse one.

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="res-hdr">{label}</div>
      {children}
    </>
  )
}

// label/value hairline rows — the app's own register (uppercase section label,
// .5px separators, no new colours).
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

// Long agent prose and QA feedback are clamped, not truncated: the full text is
// one tap away and nothing is silently thrown out.
function Clamp({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220 || text.split('\n').length > lines
  return (
    <div onClick={long ? () => setOpen(o => !o) : undefined}>
      <div className={`dd-body${!open && long ? ' dd-clamp' : ''}`} style={
        !open && long ? ({ WebkitLineClamp: lines } as React.CSSProperties) : undefined
      }>{text}</div>
      {long && <div className="dd-more">{open ? 'Show less' : 'Show more'}</div>}
    </div>
  )
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function DetailSkeleton() {
  return (
    <div aria-hidden style={{ padding: '18px 16px 0' }}>
      <div className="sk sk-line" style={{ width: '70%', height: 20 }} />
      <div className="sk sk-line" style={{ width: '40%', marginTop: 12 }} />
      <div className="sk" style={{ height: 120, borderRadius: 16, marginTop: 18 }} />
      <div className="sk" style={{ height: 180, borderRadius: 16, marginTop: 12 }} />
    </div>
  )
}

function Body({ d, lane, refresh, onBack }: {
  d: ContentDraftDetail; lane: ContentLane; refresh: () => void; onBack: () => void
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
    dates.push([label, (
      <>{ahead ? relOrAhead(iso) : relTime(iso)} <span className="dd-abs">{absTime(iso)}</span></>
    )])
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
  if (d.client_idea_id) source.push(['From idea', d.client_idea_id])

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
          {lane === 'risedtc' ? (
            // D7 / spec §2: on a Rise row the thing Ivan needs to know at a
            // glance is whether the client can SEE it, not merely that it's a
            // client row. board_visible is the operator_set_board_visible flag.
            <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
              {d.board_visible === true ? "On Rise's board" : 'Internal'}
            </span>
          ) : null}
        </div>
      </div>

      {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
      {source.length > 0 && <Block label="Source"><Rows items={source} /></Block>}

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

      {qa && (
        <Block label="QA">
          <div className="dd-card">
            <div className="dd-qa">
              {qa.score !== null && <div className="dd-score">{qa.score}</div>}
              {qa.verdict && (
                // Only a literal PASS is green — see normalizeQa. A live row
                // carries verdict "PASS" over feedback prose that opens
                // "VERDICT: REWRITE_OK", so the chip reads the field and the
                // prose is shown verbatim below rather than re-derived.
                <span className={`ct-chip ${qa.pass ? 'ct-chip-ok' : 'ct-chip-warn'}`}>{qa.verdict}</span>
              )}
            </div>
            {qa.feedback && <div className="dd-qa-fb"><Clamp text={qa.feedback} lines={3} /></div>}
          </div>
        </Block>
      )}

      {taxRows.length > 0 && <Block label="Taxonomy"><Rows items={taxRows} /></Block>}

      {images.length > 0 && (
        <Block label={images.length === 1 ? 'Image' : `Images · ${images.length}`}>
          <div className="dd-imgs">
            {images.map((u, i) => <img className="dd-img" src={u} alt="" key={`${u}-${i}`} />)}
          </div>
        </Block>
      )}

      {d.description && <Block label="Description"><div className="dd-card"><Clamp text={d.description} lines={4} /></div></Block>}

      {d.post_body && (
        <Block label="Post">
          <div className="dd-card"><div className="dd-body dd-pre">{d.post_body}</div></div>
        </Block>
      )}

      {points.length > 0 && (
        <Block label="Key points">
          <div className="dd-card">
            {points.map((p, i) => <div className="dd-point" key={i}>{p}</div>)}
          </div>
        </Block>
      )}

      {d.ig_caption && (
        <Block label="IG caption">
          <div className="dd-card"><div className="dd-body dd-pre">{d.ig_caption}</div></div>
        </Block>
      )}

      {d.pdf_url && (
        <Block label="PDF">
          <a className="dd-link" href={d.pdf_url} target="_blank" rel="noreferrer">Open PDF ↗</a>
        </Block>
      )}

      {reviewActionable(d.status, lane) && (
        <div className="dd-actions">
          <ReviewActions id={d.id} onDone={() => { refresh(); onBack() }} />
        </div>
      )}
      <div style={{ height: 28 }} />
    </>
  )
}

export function DraftDetail({ id, lane, refresh, onBack }: {
  id: string
  lane: ContentLane
  // The queue's own refresh — the detail screen never re-fetches the list, and
  // approving from here closes back to a list that has already been told to
  // reload.
  refresh: () => void
  onBack: () => void
}) {
  const { detail, missing, loading, error } = useDraftDetail(id)

  return (
    <div className="ct-overlay">
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">Draft</div></div>
      </div>
      <div className="rows">
        {error ? (
          <div className="ct-broken">{error}</div>
        ) : loading && !detail ? (
          <DetailSkeleton />
        ) : missing || !detail ? (
          // D10: gone and unreadable are different facts. This one is gone.
          <div className="empty">This draft is no longer in the database.</div>
        ) : (
          <Body d={detail} lane={lane} refresh={refresh} onBack={onBack} />
        )}
      </div>
    </div>
  )
}
