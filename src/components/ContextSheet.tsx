import { useEffect, useRef, useState } from 'react'
import {
  fetchProspectContext, fetchScan, saveOperatorNote,
  type ProspectContext, type ScanInfo,
} from '../lib/context'
import type { Thread } from '../lib/inbox'

function ago(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function icpTone(score: number | null): string {
  if (score == null) return 'var(--sub)'
  if (score >= 8) return '#30D158'
  if (score >= 6) return '#FFD60A'
  return '#FF9F0A'
}

// Slide-up sheet with everything needed to decide a reply without leaving the
// app: who they are, how warm the thread is, whether a scan exists, plus an
// editable operator note that the drafters read on their next pass.
export function ContextSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const [ctx, setCtx] = useState<ProspectContext | null>(null)
  const [scan, setScan] = useState<ScanInfo | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [note, setNote] = useState('')
  const [noteState, setNoteState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const loadedNote = useRef('')

  useEffect(() => {
    let alive = true
    fetchProspectContext(thread.prospect_id)
      .then(c => {
        if (!alive) return
        setCtx(c)
        loadedNote.current = c.operator_note ?? ''
        setNote(loadedNote.current)
        return fetchScan(thread.prospect_name, c.company_domain)
      })
      .then(s => { if (alive && s) setScan(s) })
      .catch(e => { if (alive) setLoadErr(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [thread.prospect_id])

  async function onSave() {
    setNoteState('saving')
    try {
      await saveOperatorNote(thread.prospect_id, note)
      loadedNote.current = note.trim()
      setNoteState('saved')
    } catch { setNoteState('error') }
  }

  const rows: Array<[string, string]> = ctx ? [
    ['Lane', thread.last.campaign_name || '—'],
    ['Stage', thread.stage || '—'],
    ['DMs sent', String(ctx.dm_count ?? 0)],
    ['Replies', `${ctx.reply_count ?? 0}${ctx.last_reply_at ? ` · last ${ago(ctx.last_reply_at)}` : ''}`],
    ['Connected', ctx.connected_at ? ago(ctx.connected_at) : ctx.connection_sent_at ? `invited ${ago(ctx.connection_sent_at)}` : '—'],
    ['Location', ctx.location || '—'],
    ['Industry', ctx.industry || '—'],
  ] : []

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-card ctx-card">
        <div className="ctx-head">
          <div className="ctx-name">{thread.prospect_name}</div>
          {ctx?.icp_score != null && (
            <div className="ctx-icp" style={{ color: icpTone(ctx.icp_score) }}>
              ICP {ctx.icp_score}/10
            </div>
          )}
        </div>
        {ctx?.title || ctx?.headline
          ? <div className="ctx-title">{ctx.title || ctx.headline}</div>
          : null}

        {loadErr && <div className="err" style={{ padding: '8px 0' }}>{loadErr}</div>}
        {!ctx && !loadErr && <div className="ctx-loading">Loading…</div>}

        {ctx && (
          <>
            <div className="ctx-grid">
              {rows.map(([k, v]) => (
                <div className="ctx-row" key={k}>
                  <span className="k">{k}</span><span className="v">{v}</span>
                </div>
              ))}
            </div>

            {ctx.icp_reasoning && (
              <div className="ctx-block">
                <div className="ctx-lbl">Why this score</div>
                <div className="ctx-txt">{ctx.icp_reasoning}</div>
              </div>
            )}

            {ctx.notes && (
              <div className="ctx-block">
                <div className="ctx-lbl">System note</div>
                <div className="ctx-txt sys">{ctx.notes}</div>
              </div>
            )}

            <div className="ctx-links">
              {ctx.linkedin_url && (
                <a href={ctx.linkedin_url} target="_blank" rel="noreferrer" className="ctx-link">LinkedIn profile ↗</a>
              )}
              {scan?.report_url ? (
                <a href={scan.report_url} target="_blank" rel="noreferrer" className="ctx-link scan">
                  Scan{scan.automation_grade ? ` · grade ${scan.automation_grade}` : ''} ↗
                </a>
              ) : (
                <span className="ctx-link none">No scan yet</span>
              )}
            </div>

            <div className="ctx-block">
              <div className="ctx-lbl">
                Your note
                {noteState === 'saved' && <span className="ok"> · saved — drafts will use it</span>}
                {noteState === 'error' && <span className="bad"> · save failed, retry</span>}
              </div>
              <textarea
                className="ctx-note"
                placeholder="e.g. wants Q4 start, prefers email…"
                value={note}
                onChange={e => { setNote(e.target.value); setNoteState(e.target.value.trim() === loadedNote.current ? 'idle' : 'dirty') }}
              />
              {(noteState === 'dirty' || noteState === 'saving' || noteState === 'error') && (
                <div className="btn p ctx-save" onClick={noteState === 'saving' ? undefined : onSave}>
                  {noteState === 'saving' ? 'Saving…' : 'Save note'}
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
