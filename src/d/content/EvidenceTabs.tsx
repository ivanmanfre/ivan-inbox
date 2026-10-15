import { useState, type ReactNode } from 'react'
import {
  STAGE_LABEL, normalizeKeyPoints, normalizeSourceDetail, stageOf, taxonomyExtras, taxonomyFields, taxonomyValue,
  type ContentDraftDetail,
} from '../../lib/content'
import { kindOf } from './model'
import { sourceTag } from './v2/sourceTag'
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

/** The Fields tab, grouped and readable (Ivan 2026-10-15: "Fields dumps every raw field"): the key facts and the
 *  dates first, every other field behind "Show all fields". Empty values never print; monospace is for ids only. */
export function FieldsTab({ d }: { d: ContentDraftDetail }) {
  const [all, setAll] = useState(false)
  const tax = taxonomyFields(d.taxonomy)
  const extras = taxonomyExtras(d.taxonomy)
  const reason = taxonomyValue(d.taxonomy, 'structure_reason')
  const strength = scalar(d.topic_strength)
  const src = sourceTag(d)
  const cap = (x: string) => x ? `${x[0].toUpperCase()}${x.slice(1)}` : x
  // A stored value in shouting caps ("BORROWED WINNER FORMAT") reads as a sentence; a code-like reason
  // ("cb51:borrowed_winner_format") is an internal key and waits behind "Show all fields".
  const human = (v: string) => { const t = label(v); return /[a-z]/.test(t) ? t : cap(t.toLowerCase()) }
  const codeLike = !!reason && /^[a-z0-9_]+:[a-z0-9_:-]+$/i.test(reason)
  const facts: [string, ReactNode][] = [['Status', STAGE_LABEL[stageOf(d)] ?? label(d.status)], ['Format', kindOf(d.type)]]
  if (d.source_label || src.key !== 'other') facts.push(['Source', <>{src.label}{d.source_label && d.source_label !== src.label && <small className="cn-fsub">{d.source_label}</small>}</>])
  if (d.funnel_stage) facts.push(['Aim', cap(d.funnel_stage)])
  if (tax.pillar) facts.push(['Pillar', human(String(tax.pillar))])
  if (tax.hook_type) facts.push(['Hook', human(String(tax.hook_type))])
  if (tax.structure_used) facts.push(['Structure', <>{human(String(tax.structure_used))}{reason && !codeLike && <small className="cn-fsub">{reason}</small>}</>])
  const dates: [string, ReactNode][] = [['Created', warsawDayTime(d.created_at)], ['Updated', warsawDayTime(d.updated_at)]]
  if (d.scheduled_at) dates.push(['Scheduled', `${warsawDayTime(d.scheduled_at)} Warsaw`])
  if (d.published_at) dates.push(['Published', `${warsawDayTime(d.published_at)} Warsaw`])
  const moreRows: [string, ReactNode][] = []
  if (tax.image_style) moreRows.push(['Image style', human(String(tax.image_style))])
  if (reason && codeLike) moreRows.push(['Structure key', <span className="cn-mono">{reason}</span>])
  if (tax.arm) moreRows.push(['Experiment arm', String(tax.arm)])
  if (strength) moreRows.push(['Topic strength', strength])
  const hidden = moreRows.length + extras.length + (d.ig_caption ? 1 : 0) + (d.slide_metadata != null ? 1 : 0) + 1
  return (
    <div className="cn-fields">
      <section className="cn-fgroup" aria-label="Key facts"><h4 className="cn-cap">Key facts</h4><KV items={facts} /></section>
      <section className="cn-fgroup" aria-label="Dates"><h4 className="cn-cap">Dates</h4><KV items={dates} /></section>
      {d.pdf_url && <p className="cn-fgroup"><a href={d.pdf_url} target="_blank" rel="noreferrer" data-verb="pdf">Open PDF</a></p>}
      <button type="button" className="cn-fall" aria-expanded={all} data-verb="fields-all" onClick={() => setAll(v => !v)}>
        {all ? 'Hide the other fields' : `Show all fields (${hidden} more)`}
      </button>
      {all && (
        <>
          {moreRows.length > 0 && <section className="cn-fgroup" aria-label="More"><h4 className="cn-cap">More</h4><KV items={moreRows} /></section>}
          <div className="cn-reg app wb ds-shell">
            {extras.length > 0 && <Fold label="Other taxonomy keys" tail={`${extras.length} keys`}><KeyRows items={extras} /></Fold>}
            {d.ig_caption && <Fold label="IG caption" tail={`${d.ig_caption.length.toLocaleString()} chars`}><pre className="cn-pre">{d.ig_caption}</pre></Fold>}
            {d.slide_metadata !== undefined && d.slide_metadata !== null && (
              <Fold label="Slides" tail="slide metadata"><Val v={d.slide_metadata} /></Fold>
            )}
          </div>
          <section className="cn-fgroup" aria-label="Identifiers"><h4 className="cn-cap">Identifiers</h4><KV items={[['Draft id', <span className="cn-mono">{d.id}</span>]]} /></section>
        </>
      )}
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
