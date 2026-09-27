// Search (/) and the + Filter tokens. The question is today's: searchThreads over every loaded
// message of every conversation, narrowed by DM_FIELDS tokens (lib/filterTokens). Tokens live in
// sessionStorage like today's (readTokens/writeTokens 'dms'), so a refresh keeps the question.
import { forwardRef, useState } from 'react'
import { DM_FIELDS, OP_LABEL, findField, tokenId, tokenSentence, valueLabel, type FieldSpec, type FilterToken, type TokenOp } from '../../lib/filterTokens'
import type { Thread } from '../../lib/inbox'
import { DIcon } from '../ui/icons'

export const SearchField = forwardRef<HTMLInputElement, { q: string; setQ: (s: string) => void; reach: number | null; phone?: boolean }>(
  function SearchField({ q, setQ, reach, phone }, ref) {
    return (
      <label className={`dm-search${q ? ' dm-on' : ''}${phone ? ' dm-search-phone' : ''}`}>
        <DIcon name="search" />
        <input ref={ref} type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder={`Search ${reach != null ? reach.toLocaleString('en-US') + ' ' : ''}people and messages`} aria-label="Search people and messages"
          onKeyDown={e => { if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur() } }} />
        {!phone && <kbd>/</kbd>}
      </label>
    )
  })

const DAYS = ['3', '7', '14', '30']

function choices(f: FieldSpec<Thread>): { op: TokenOp; value: string; label: string }[] {
  if (f.kind === 'flag') return f.ops.map(op => ({ op, value: '', label: `${OP_LABEL[op]} ${f.label}` }))
  if (f.kind === 'days') return f.ops.flatMap(op => DAYS.map(d => ({ op, value: d, label: `${OP_LABEL[op]} ${d} days` })))
  return (f.values ?? []).map(v => ({ op: f.ops[0], value: v.value, label: v.label }))
}

export function TokenBar({ tokens, setTokens }: { tokens: FilterToken[]; setTokens: (t: FilterToken[]) => void }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string | null>(null)
  const f = field ? findField(DM_FIELDS, field) : null
  const add = (op: TokenOp, value: string) => {
    if (!f) return
    setTokens([...tokens.filter(t => t.field !== f.key), { id: tokenId(), field: f.key, op, value }])
    setOpen(false); setField(null)
  }
  return (
    <span className="dm-tokens">
      {tokens.map(t => {
        const fs = findField(DM_FIELDS, t.field)
        if (!fs) return null
        const v = valueLabel(fs, t)
        return (
          <button key={t.id} type="button" className="dm-tok dm-tok-set" aria-label={`Remove ${tokenSentence(fs, t)}`} title="Remove"
            onClick={() => setTokens(tokens.filter(x => x.id !== t.id))}>
            {fs.label} <i>{OP_LABEL[t.op]}</i>{v ? ` ${v}` : ''} ×
          </button>
        )
      })}
      <span className="dm-tokwrap">
        <button type="button" className={`dm-tok${open ? ' dm-tok-set' : ''}`} aria-expanded={open} onClick={() => { setOpen(o => !o); setField(null) }}>+ Filter</button>
        {open && (
          <div className="dm-tmenu" role="menu">
            {!f ? DM_FIELDS.map(x => (
              <button key={x.key} type="button" role="menuitem" className="dm-mi" onClick={() => setField(x.key)}>
                <b>{x.label}</b><span>{choices(x).slice(0, 5).map(c => c.label).join(', ')}{choices(x).length > 5 ? '…' : ''}</span>
              </button>
            )) : <>
              <button type="button" className="dm-mi dm-mi-back" onClick={() => setField(null)}><b>‹ {f.label}</b><span /></button>
              {choices(f).map(c => (
                <button key={`${c.op}:${c.value}`} type="button" role="menuitem" className="dm-mi" onClick={() => add(c.op, c.value)}><span>{c.label}</span></button>
              ))}
            </>}
          </div>
        )}
      </span>
    </span>
  )
}
