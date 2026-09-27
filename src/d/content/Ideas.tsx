import { useMemo, useState } from 'react'
import { useClientIdeas, useIdeaCandidates } from '../../hooks/useContent'
import { Failed, Skeleton } from '../ui/states'
import { IDEA_OWNER, LANES, LANE_NAME, type Lane } from './model'
import { byScore, fromCandidate, fromClient, scoreText, type IdeaItem } from './ideaModel'
import { IdeaDetail } from './IdeaDetail'

// Ideas: one channel per seat (Ivan's bank + each client's), highest score
// first, and the picked idea's detail beside them (desktop) or under its row
// (phone). Counts per seat, never added.
export type IdeaBank = { items: IdeaItem[]; n: number | null; loading: boolean; error: string | null; refresh: () => void }
export type IdeaBanks = Record<Lane, IdeaBank>

export function useIdeaBanks(): IdeaBanks {
  const ivan = useIdeaCandidates(true)
  const rise = useClientIdeas('risedtc', true)
  const arch = useClientIdeas('arch', true)
  return useMemo(() => ({
    ivan: { items: ivan.rows.map(i => fromCandidate(i)).sort(byScore), n: ivan.loadedAt ? ivan.count ?? ivan.rows.length : null, loading: ivan.loading, error: ivan.error, refresh: ivan.refresh },
    risedtc: { items: rise.rows.map(i => fromClient(i, 'risedtc')).sort(byScore), n: rise.loadedAt ? rise.rows.length : null, loading: rise.loading, error: rise.error, refresh: rise.refresh },
    arch: { items: arch.rows.map(i => fromClient(i, 'arch')).sort(byScore), n: arch.loadedAt ? arch.rows.length : null, loading: arch.loading, error: arch.error, refresh: arch.refresh },
  }), [ivan.rows, ivan.count, ivan.loadedAt, ivan.loading, ivan.error, ivan.refresh, rise.rows, rise.loadedAt, rise.loading, rise.error, rise.refresh, arch.rows, arch.loadedAt, arch.loading, arch.error, arch.refresh])
}

const PLATE: Record<Lane, string> = { ivan: 'your idea bank', risedtc: 'Mattan’s ideas', arch: 'Davorin’s ideas' }
const SHOWN = 40

function Row({ it, on, pick }: { it: IdeaItem; on: boolean; pick: () => void }) {
  return (
    <button type="button" className={`cn-iq${on ? ' cn-sel' : ''}`} aria-current={on ? 'true' : undefined} onClick={pick}>
      <span className="cn-sc">{scoreText(it.score)}</span>
      <span className="cn-n">{it.title}</span>
      <time>{it.age}</time>
      <span className="cn-s">{it.src}</span>
    </button>
  )
}

export function Ideas({ banks, phone }: { banks: IdeaBanks; phone: boolean }) {
  const [sel, setSel] = useState<{ lane: Lane; id: string } | null>(null)
  const [seat, setSeat] = useState<Lane>('ivan')
  const current = sel ? banks[sel.lane].items.find(i => i.id === sel.id) ?? null : null
  const shown = current ?? banks[seat].items[0] ?? banks.ivan.items[0] ?? null

  const done = (lane: Lane) => (id: string) => {
    const list = banks[lane].items
    const at = list.findIndex(i => i.id === id)
    const next = list[at + 1] ?? list[at - 1] ?? null
    setSel(next ? { lane, id: next.id } : null)
    banks[lane].refresh()
  }

  const channel = (l: Lane) => {
    const b = banks[l]
    return (
      <div className="cn-ch" key={l}>
        <div className="cn-plate"><b>{LANE_NAME[l]}</b><span>{PLATE[l]}</span></div>
        <div className="cn-read">
          <div><small>To decide</small><em className={b.n ? 'cn-hot' : ''}>{b.n ?? (b.error ? '?' : '…')}</em></div>
          <div><small>Top score</small><em>{b.items[0] ? scoreText(b.items[0].score) : '0'}</em></div>
        </div>
        <div className="cn-sec"><span>Highest score first</span><span>{Math.min(SHOWN, b.items.length)} shown</span></div>
        <div className="cn-iqs">
          {b.error ? <Failed what={`${IDEA_OWNER[l]} ideas`} detail={b.error} onRetry={b.refresh} />
            : b.loading && b.items.length === 0 ? <Skeleton lines={5} title={false} label="Reading ideas" />
              : b.items.length === 0 ? <p className="cn-say">Nothing to decide. Every staged idea here has been approved or rejected.</p>
                : b.items.slice(0, SHOWN).map(it => {
                  const on = shown?.id === it.id
                  return (
                    <div key={it.id}>
                      <Row it={it} on={on} pick={() => setSel({ lane: l, id: it.id })} />
                      {phone && on && <IdeaDetail it={it} onDone={done(l)} />}
                    </div>
                  )
                })}
        </div>
      </div>
    )
  }

  if (phone) {
    return (
      <div>
        <div className="cn-read" style={{ gridTemplateColumns: 'repeat(3,1fr)' }} role="tablist" aria-label="Seat">
          {LANES.map(l => (
            <button key={l} type="button" role="tab" aria-selected={seat === l} onClick={() => { setSeat(l); setSel(null) }}
              style={{ textAlign: 'left', padding: '8px 14px', boxShadow: seat === l ? 'inset 0 -2px 0 var(--t1)' : undefined }}>
              <b style={{ display: 'block', fontSize: 18 }}>{LANE_NAME[l]}</b><small>To decide</small>
              <em className={seat === l && banks[l].n ? 'cn-hot' : ''}>{banks[l].n ?? '…'}</em>
            </button>
          ))}
        </div>
        {channel(seat)}
      </div>
    )
  }
  return (
    <div className="cn-ideas">
      {LANES.map(channel)}
      {shown ? <IdeaDetail key={shown.id} it={shown} onDone={done(shown.lane)} /> : <div className="cn-idm"><p className="cn-say">Pick an idea to read it.</p></div>}
    </div>
  )
}
