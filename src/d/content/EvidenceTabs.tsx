import { useState, type ReactNode } from 'react'
import {
  normalizeKeyPoints, normalizeSourceDetail, taxonomyExtras, taxonomyFields, taxonomyValue,
  type ContentDraftDetail,
} from '../../lib/content'
import { appendAgentNote } from '../../lib/studioActions'
import { label } from '../../lib/labels'
import { linkedInPostUrl } from '../../exp/v2c/fmt'
import { Fold, KeyRows, Val } from '../../wb/draft/bits'
import { Btn } from '../ui/Key'
import { warsawDayTime } from '../ui/time'

// The parts of the evidence tabs that today's window carries and D's first
// pass dropped: the Source rows (live-post link, auto-promoted, identifiers,
// detail links and keys, key points, description), every Fields row (dates
// incl. Published, taxonomy with the structure reason, the other taxonomy
// keys, IG caption, PDF, slide metadata) and the note composer on the Log tab
// (append_agent_log via today's appendAgentNote).
export function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function KV({ items }: { items: [string, ReactNode][] }) {
  if (!items.length) return null
  return <dl className="cn-kv">{items.map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>
}
function Pair({ k, v }: { k: string; v: ReactNode }) { return <><dt>{k}</dt><dd>{v}</dd></> }

export function SourceTab({ d }: { d: ContentDraftDetail }) {
  const src = normalizeSourceDetail(d.source_detail)
  const points = normalizeKeyPoints(d.key_points)
  const tax = taxonomyFields(d.taxonomy)
  const rows: [string, ReactNode][] = []
  if (tax.source) rows.push(['Source', String(tax.source)])
  if (d.source_label) rows.push(['Label', d.source_label])
  if (d.source_post_id) {
    const url = linkedInPostUrl(d.source_post_id)
    rows.push(['Spun from post', url
      ? <a href={url} target="_blank" rel="noreferrer" title={d.source_post_id} data-verb="live-post">View the live post</a>
      : <span title={d.source_post_id}>Live post (link unavailable)</span>])
  }
  const auto = taxonomyValue(d.taxonomy, 'auto_promoted')
  if (auto) rows.push(['Auto-promoted', auto])
  const empty = !rows.length && !d.source_ref && !src && !points.length && !d.description
  return (
    <div className="cn-src">
      <KV items={rows} />
      {d.source_ref && <div className="cn-reg app wb ds-shell"><Fold label="Identifiers" tail="1 key"><KV items={[['Ref', <span className="cn-mono">{d.source_ref}</span>]]} /></Fold></div>}
      {src && (
        <>
          {(src.kind || src.label) && <p className="cn-dim">{[src.kind ? label(src.kind) : null, src.label].filter(Boolean).join(' · ')}</p>}
          {src.quote && <blockquote className="cn-quote">{src.quote}{src.callTitle && <small>{src.callTitle}</small>}</blockquote>}
          {!src.quote && src.callTitle && <p className="cn-dim">{src.callTitle}</p>}
          {src.text && <p className="cn-well">{src.text}</p>}
          {src.links.map(([k, url]) => <p key={k}><a href={url} target="_blank" rel="noreferrer">{k}</a></p>)}
          {src.rows.length > 0 && <div className="cn-reg app wb ds-shell"><KeyRows items={src.rows} /></div>}
          {src.holds.map((h, i) => <p key={i} className="cn-hr">{h}</p>)}
        </>
      )}
      {points.length > 0 && <><small className="cn-cap">Key points</small><div className="cn-well">{points.map((p, i) => <p key={i}>{p}</p>)}</div></>}
      {d.description && <><small className="cn-cap">Description</small><pre className="cn-well cn-pre">{d.description}</pre></>}
      {empty && <p>Pre-pipeline draft, no linked idea.</p>}
    </div>
  )
}

export function FieldsTab({ d }: { d: ContentDraftDetail }) {
  const tax = taxonomyFields(d.taxonomy)
  const extras = taxonomyExtras(d.taxonomy)
  const reason = taxonomyValue(d.taxonomy, 'structure_reason')
  const strength = scalar(d.topic_strength)
  const dates: [string, ReactNode][] = [['Created', warsawDayTime(d.created_at)], ['Updated', warsawDayTime(d.updated_at)]]
  if (d.scheduled_at) dates.push(['Scheduled', `${warsawDayTime(d.scheduled_at)} Warsaw`])
  if (d.published_at) dates.push(['Published', `${warsawDayTime(d.published_at)} Warsaw`])
  const taxRows: [string, ReactNode][] = [['Status', d.status ?? 'none'], ['Type', d.type ?? 'none']]
  if (tax.pillar) taxRows.push(['Pillar', String(tax.pillar)])
  if (tax.hook_type) taxRows.push(['Hook', String(tax.hook_type)])
  if (tax.structure_used) taxRows.push(['Structure', <>{String(tax.structure_used)}{reason && <small className="cn-dim"> {reason}</small>}</>])
  if (tax.image_style) taxRows.push(['Image style', String(tax.image_style)])
  if (tax.arm) taxRows.push(['Experiment arm', String(tax.arm)])
  if (d.funnel_stage) taxRows.push(['Funnel stage', d.funnel_stage])
  if (strength) taxRows.push(['Topic strength', strength])
  return (
    <div>
      <small className="cn-cap">Dates</small><KV items={dates} />
      <small className="cn-cap">Taxonomy</small><KV items={taxRows} />
      <div className="cn-reg app wb ds-shell">
        {extras.length > 0 && <Fold label="Taxonomy · other keys" tail={`${extras.length} keys`}><KeyRows items={extras} /></Fold>}
        {d.ig_caption && <Fold label="IG caption" tail={`${d.ig_caption.length.toLocaleString()} chars`}><pre className="cn-pre">{d.ig_caption}</pre></Fold>}
        {d.slide_metadata !== undefined && d.slide_metadata !== null && (
          <Fold label="Slides" tail="slide metadata"><Val v={d.slide_metadata} /></Fold>
        )}
      </div>
      {d.pdf_url && <p><a href={d.pdf_url} target="_blank" rel="noreferrer" data-verb="pdf">Open PDF</a></p>}
      <KV items={[['Id', <span className="cn-mono">{d.id}</span>]]} />
    </div>
  )
}

/** Today's "Post note" (⌘↵ posts): rpc append_agent_log through lib/studioActions.appendAgentNote. */
export function NoteBox({ id, onDone }: { id: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true); setErr('')
    try { await appendAgentNote('carousel_drafts', id, body); setText(''); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the note') }
    finally { setBusy(false) }
  }
  return (
    <div className="cn-notec">
      {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
      <textarea className="cn-note" aria-label="Add a note to the generation register" placeholder="Add a note for future-you…" value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }} />
      <div className="cn-ia"><Btn verb="note" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post note'}</Btn><small className="cn-dim">⌘↵ posts</small></div>
    </div>
  )
}
