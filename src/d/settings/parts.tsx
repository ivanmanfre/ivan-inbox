// Settings parts shared by the legacy plates and the Brief 4 grouped list (same components, same handlers).
import { fmtUsd, PLAIN_UNVERIFIED, plainNote, plainProvenance } from '../../lib/money'
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


const CLIENT_NAME: Record<string, string> = { risedtc: 'Rise', arch: 'Arch' }

export function MoneyCells({ m }: { m: MoneyPlate }) {
  // Every client the ledger carries an MRR row for (Rise and Arch first), never a typed-in pair.
  const ids = [...new Set(['risedtc', 'arch', ...m.mrr.map(r => r.clientId).filter((x): x is string => Boolean(x))])]
  const cell = (id: string) => {
    const r = m.mrr.find(x => x.clientId === id)
    const a = r?.amountRow
    const label = CLIENT_NAME[id] ?? id
    return (
      <div key={id}><small>{label} MRR</small>
        {a ? <><em>{fmtUsd(a.amount_usd)}</em><u>{a.verified ? 'verified' : PLAIN_UNVERIFIED} · {plainProvenance(a)}</u></>
          : r ? <><em className="ds2-z">not recorded</em><u>{plainNote(r.latestRow.note)}</u></>
            : <><em className="ds2-z">not recorded</em><u>no MRR row on file</u></>}
      </div>
    )
  }
  return (
    <div className="ds2-money">
      {ids.map(cell)}
      <div><small>Runway</small>{m.cash == null ? <><em className="ds2-z">not computed</em><u>no cash on hand recorded</u></> : <><em className="ds2-z">in Money</em><u>cash as of {m.cashAsOf ?? 'unknown'}</u></>}</div>
    </div>
  )
}

