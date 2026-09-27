import { useCallback, useState } from 'react'
import { readTokens, salesRowMatches, SALES_WHEN_VALUES, writeTokens, type FilterToken, type TokenOp } from '../../lib/filterTokens'
import { Btn } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import type { CallEvent, Fortnight } from './model'

// Today's Sales filter (when is / is not, pack has / has no, report has / has
// no), the same tokens in the same sessionStorage slot (`wb-filters:sales`),
// matched by today's salesRowMatches. D draws it as ONE key that opens a sheet
// and one line saying what is on, never a chip row.

const SURFACE = 'sales'
const id = () => Math.random().toString(36).slice(2, 10)

export function useSalesTokens(): [FilterToken[], (t: FilterToken[]) => void] {
  const [tokens, set] = useState<FilterToken[]>(() => readTokens(SURFACE))
  const setTokens = useCallback((t: FilterToken[]) => { set(t); writeTokens(SURFACE, t) }, [])
  return [tokens, setTokens]
}

/** The fortnight narrowed inside each group (group headers keep counting what is under them). */
export function filterFortnight(f: Fortnight, tokens: FilterToken[]): Fortnight {
  if (tokens.length === 0) return f
  const keep = (when: keyof Fortnight) => (r: CallEvent) =>
    salesRowMatches({ when, pack: r.slug !== null, report: r.reportId !== null }, tokens)
  return { today: f.today.filter(keep('today')), later: f.later.filter(keep('later')), next: f.next.filter(keep('next')), earlier: f.earlier.filter(keep('earlier')) }
}

const WHEN_LABEL = Object.fromEntries(SALES_WHEN_VALUES.map(v => [v.value, v.label]))

export function tokenLine(tokens: FilterToken[]): string {
  return tokens.map(t => (t.field === 'when' ? `when ${t.op} ${WHEN_LABEL[t.value] ?? t.value}` : `${t.field} ${t.op}`)).join(' · ')
}

function pick(tokens: FilterToken[], field: string): string {
  const t = tokens.find(x => x.field === field)
  return t ? (t.value ? `${t.op}|${t.value}` : t.op) : ''
}

export function SalesFilter({ tokens, setTokens }: { tokens: FilterToken[]; setTokens: (t: FilterToken[]) => void }) {
  const [open, setOpen] = useState(false)
  const put = (field: string, v: string) => {
    const rest = tokens.filter(t => t.field !== field)
    if (!v) { setTokens(rest); return }
    const [op, value = ''] = v.split('|')
    setTokens([...rest, { id: id(), field, op: op as TokenOp, value }])
  }
  const flag = (field: 'pack' | 'report', label: string) => (
    <label className="sl-flt">
      <span>{label}</span>
      <select value={pick(tokens, field)} onChange={e => put(field, e.target.value)} data-filter={field}>
        <option value="">any</option><option value="has">has one</option><option value="has no">has none</option>
      </select>
    </label>
  )
  return (
    <>
      <Btn verb="filter" aria-expanded={open} onClick={() => setOpen(true)}>{tokens.length ? `Filter · ${tokens.length}` : 'Filter'}</Btn>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filter the calls" sub="Kept for this browser session."
        foot={<><Btn verb="filter-clear" disabled={tokens.length === 0} onClick={() => setTokens([])}>Clear</Btn><Btn primary onClick={() => setOpen(false)}>Done</Btn></>}>
        <label className="sl-flt">
          <span>When</span>
          <select value={pick(tokens, 'when')} onChange={e => put('when', e.target.value)} data-filter="when">
            <option value="">any time</option>
            {SALES_WHEN_VALUES.map(v => <option key={`is|${v.value}`} value={`is|${v.value}`}>is {v.label}</option>)}
            {SALES_WHEN_VALUES.map(v => <option key={`not|${v.value}`} value={`is not|${v.value}`}>is not {v.label}</option>)}
          </select>
        </label>
        {flag('pack', 'Pack')}
        {flag('report', 'Report')}
      </Sheet>
    </>
  )
}
