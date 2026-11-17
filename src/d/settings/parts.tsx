// Settings parts shared by the legacy plates and the Brief 4 grouped list (same components, same handlers).
import { fmtUsd, PLAIN_UNVERIFIED, plainProvenance } from '../../lib/money'
import { Key } from '../ui/Key'
import type { MoneyPlate } from './reads'

export function Pair<T extends string>({ value, options, onPick, disabled, name }: {
  value: T | null; options: Array<{ id: T; label: string; verb: string }>; onPick: (v: T) => void; disabled?: boolean; name: string
}) {
  return (
    <div className="ds2-pair" role="group" aria-label={name}>
      {options.map(o => (
        <Key key={o.id} size="small" verb={o.verb} aria-pressed={value === o.id} className={value === o.id ? 'ds2-pressed' : ''}
          disabled={disabled} onClick={() => { if (value !== o.id) onPick(o.id) }}>{o.label}</Key>
      ))}
    </div>
  )
}


const CLIENT_NAME: Record<string, string> = { risedtc: 'Rise', arch: 'Arch', swishdm: 'SwishDM' }

type MoneyCell = { id: string; label: string; value: string; note: string }

// A cell with no value to show (no amount recorded, no MRR row, no runway) is left out, never drawn as a placeholder.
function moneyCells(m: MoneyPlate): MoneyCell[] {
  // Every client the ledger carries an MRR row for (Rise and Arch first), never a typed-in pair.
  const ids = [...new Set(['risedtc', 'arch', ...m.mrr.map(r => r.clientId).filter((x): x is string => Boolean(x))])]
  const cells: MoneyCell[] = []
  for (const id of ids) {
    const a = m.mrr.find(x => x.clientId === id)?.amountRow
    if (a) cells.push({ id, label: `${CLIENT_NAME[id] ?? id} MRR`, value: fmtUsd(a.amount_usd), note: `${a.verified ? 'verified' : PLAIN_UNVERIFIED} · ${plainProvenance(a)}` })
  }
  if (m.cash != null) cells.push({ id: 'runway', label: 'Runway', value: 'in Money', note: `cash as of ${m.cashAsOf ?? 'unknown'}` })
  return cells
}

export const hasMoneyCells = (m: MoneyPlate) => moneyCells(m).length > 0

export function MoneyCells({ m }: { m: MoneyPlate }) {
  const cells = moneyCells(m)
  if (cells.length === 0) return null
  return (
    <div className="ds2-money">
      {cells.map(c => <div key={c.id}><small>{c.label}</small><em className={c.id === 'runway' ? 'ds2-z' : undefined}>{c.value}</em><u>{c.note}</u></div>)}
    </div>
  )
}
