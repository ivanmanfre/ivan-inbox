/* ==========================================================================
   src/wb/sheets/Context.tsx — S21, the prospect context sheet, on the design
   system.

   Rebuilt from src/components/ContextSheet.tsx. Every read (fetchProspectContext,
   fetchScan), the one write (saveOperatorNote), the dirty tracking against the
   last-loaded value, every row, every string and the alive-guard on the load
   are the ones that were there. The old file stays for `#exp/stock` (D2).

   The view is `kavikatiyar/project-detail-view` from the panes PICKS: a
   key/value grid where the key is an eyebrow ABOVE its value rather than a
   label in a left column, so the values share a baseline and the eye reads
   down one column of facts instead of zig-zagging.

   ONE THING CHANGED SHAPE. The ICP score was three hexes by band (green /
   yellow / amber), which is a CATEGORY DRAWN AS A COLOUR and a fourth, fifth
   and sixth hue on a screen whose severity trio already means something live.
   It is now the figure with its denominator and a measured bar under it: the
   same band, read as a length, legible to a reader who cannot see hue.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Button, Sheet } from '../../ds'
import { BarLine } from '../kit'
import {
  fetchProspectContext, fetchScan, saveOperatorNote,
  type ProspectContext, type ScanInfo,
} from '../../lib/context'
import type { Thread } from '../../lib/inbox'
import { inlineLabel, label } from '../../lib/labels'
import './sheets.css'

function ago(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="a-ctx-f">
      <span className="a-eyebrow">{k}</span>
      <span className="a-ctx-v">{v}</span>
    </div>
  )
}

function Block({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="a-ctx-block">
      <span className="a-eyebrow">{k}</span>
      {children}
    </div>
  )
}

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
  }, [thread.prospect_id, thread.prospect_name])

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
    ['Stage', thread.stage ? label(thread.stage) : '—'],
    ['DMs sent', String(ctx.dm_count ?? 0)],
    ['Replies', `${ctx.reply_count ?? 0}${ctx.last_reply_at ? ` · last ${ago(ctx.last_reply_at)}` : ''}`],
    ['Connected', ctx.connected_at ? ago(ctx.connected_at) : ctx.connection_sent_at ? `invited ${ago(ctx.connection_sent_at)}` : '—'],
    ['Location', ctx.location || '—'],
    ['Industry', ctx.industry || '—'],
  ] : []

  const icp = ctx?.icp_score ?? null

  return (
    <Sheet
      open
      onClose={onClose}
      title={thread.prospect_name}
      sub={ctx?.title || ctx?.headline || undefined}
    >
      <div className="a-ctx">
        {icp != null && (
          <div className="a-ctx-icp">
            <span className="a-eyebrow">ICP fit</span>
            <span className="a-ctx-score a-mono">{icp}<span className="a-dim">/10</span></span>
            <BarLine pct={Math.max(0, Math.min(100, icp * 10))} />
          </div>
        )}

        {loadErr && <div className="a-ctx-err">{loadErr}</div>}
        {!ctx && !loadErr && <div className="a-dim">Loading…</div>}

        {ctx && (
          <>
            <div className="a-ctx-grid">
              {rows.map(([k, v]) => <Field key={k} k={k} v={v} />)}
            </div>

            {ctx.icp_reasoning && (
              <Block k="Why this score">
                <span className="a-ctx-txt">{inlineLabel(ctx.icp_reasoning)}</span>
              </Block>
            )}

            {ctx.notes && (
              <Block k="System note">
                <span className="a-ctx-txt a-dim">{ctx.notes}</span>
              </Block>
            )}

            <div className="a-ctx-links">
              {ctx.linkedin_url && (
                <a href={ctx.linkedin_url} target="_blank" rel="noreferrer" className="a-ctx-link">
                  LinkedIn profile
                </a>
              )}
              {scan?.report_url ? (
                <a href={scan.report_url} target="_blank" rel="noreferrer" className="a-ctx-link">
                  Scan{scan.automation_grade ? ` · grade ${scan.automation_grade}` : ''}
                </a>
              ) : (
                <span className="a-ctx-link a-dim">No scan yet</span>
              )}
            </div>

            <Block k="Your note">
              <textarea
                className="ds-textarea a-ctx-note"
                aria-label="Your note"
                placeholder="e.g. wants Q4 start, prefers email…"
                value={note}
                onChange={e => {
                  setNote(e.target.value)
                  setNoteState(e.target.value.trim() === loadedNote.current ? 'idle' : 'dirty')
                }}
              />
              <span className="a-ctx-notefoot">
                {noteState === 'saved' && <span className="a-mono a-dim">saved, drafts will use it</span>}
                {noteState === 'error' && <span className="a-mono a-ctx-bad">save failed, retry</span>}
                {(noteState === 'dirty' || noteState === 'saving' || noteState === 'error') && (
                  <Button
                    variant="primary"
                    size="sm"
                    busy={noteState === 'saving'}
                    onClick={noteState === 'saving' ? undefined : onSave}
                  >
                    {noteState === 'saving' ? 'Saving…' : 'Save note'}
                  </Button>
                )}
              </span>
            </Block>
          </>
        )}
      </div>
    </Sheet>
  )
}
