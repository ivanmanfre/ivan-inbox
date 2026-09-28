import { useEffect, useMemo, useState } from 'react'
import { useClientIdeas, useIdeaCandidates } from '../../hooks/useContent'
import { fetchIdeaScores, sortByScore, type IdeaScoreRead } from '../../lib/ideaScores'
import { banditChipLine, currentIsoWeekMonday, fetchBanditChip, personalFloorLine, type BanditChipRead } from '../../lib/banditChip'
import { applyFilters, buildFacets, CLIENT_IDEA_SPECS, IDEA_PROMINENT, IDEA_SPECS, splitFacets, type Facet, type FilterState } from '../../lib/contentFilters'
import type { IdeaCandidate } from '../../lib/content'
import type { ClientIdea } from '../../lib/clientIdeas'
import { dHash } from '../route'
import { Failed, Skeleton } from '../ui/states'
import { IDEA_OWNER, LANES, LANE_NAME, type Lane } from './model'
import { byScore, fromCandidate, fromClient, scoreText, type IdeaItem } from './ideaModel'
import { IdeaDetail, outlierLine } from './IdeaDetail'

// Ideas: one channel per seat (Ivan's POST ideas + each client's bank), the
// picked idea's detail beside them (desktop) or under its row (phone). Counts
// per seat, never added. As today: Ivan's lead-magnet ideas are NOT here (they
// are Magnets' ideas, counted apart), a row with no content type rides with the
// posts labelled, the outlier score orders a validated bank, filters narrow a
// channel, and every row is reachable (pages of 40, no cap).
export type IdeaBank = {
  items: IdeaItem[]; n: number | null; loading: boolean; error: string | null; refresh: () => void
  scores: IdeaScoreRead; facets: Facet[]; lm?: number | null; unclassified?: number
  /** CB-19 P4(b) reach-slot bandit chip (D2 grant), read-only, fail-quiet. */
  chip: BanditChipRead
}
export type IdeaBanks = Record<Lane, IdeaBank>

const NO_SCORES: IdeaScoreRead = { ok: false, byRef: new Map(), validated: false }
const NO_CHIP: BanditChipRead = { ok: false, weekStart: null, byRef: new Map(), slots: [] }

function useScores(lane: Lane, loadedAt: string | null): IdeaScoreRead {
  const [s, setS] = useState<IdeaScoreRead>(NO_SCORES)
  useEffect(() => {
    let live = true
    void fetchIdeaScores(lane, lane === 'ivan' ? 'lm_idea_candidates' : 'client_ideas').then(r => { if (live) setS(r) })
    return () => { live = false }
  }, [lane, loadedAt])
  return s
}

// One RPC call per lane per list render (never per row): fetched exactly
// where useScores is, keyed on the same loadedAt so a refresh re-reads both
// together. The RPC does not exist live until CB-19 applies; fetchBanditChip
// fails quiet to NO_CHIP and every render site below renders nothing extra.
function useBanditChip(lane: Lane, loadedAt: string | null): BanditChipRead {
  const [c, setC] = useState<BanditChipRead>(NO_CHIP)
  useEffect(() => {
    let live = true
    void fetchBanditChip(lane, lane === 'ivan' ? 'lm_idea_candidates' : 'client_ideas', currentIsoWeekMonday()).then(r => { if (live) setC(r) })
    return () => { live = false }
  }, [lane, loadedAt])
  return c
}

export function useIdeaBanks(): IdeaBanks {
  const ivan = useIdeaCandidates(true)
  const rise = useClientIdeas('risedtc', true)
  const arch = useClientIdeas('arch', true)
  const sIvan = useScores('ivan', ivan.loadedAt)
  const sRise = useScores('risedtc', rise.loadedAt)
  const sArch = useScores('arch', arch.loadedAt)
  const cIvan = useBanditChip('ivan', ivan.loadedAt)
  const cRise = useBanditChip('risedtc', rise.loadedAt)
  const cArch = useBanditChip('arch', arch.loadedAt)
  return useMemo(() => {
    const ivanRows = [...ivan.split.post, ...ivan.split.other]
    const other = new Set(ivan.split.other.map(i => i.id))
    const ivanItems = sortByScore(ivanRows.map(i => fromCandidate(i, undefined, other.has(i.id))).sort(byScore), sIvan, x => x.id)
    const client = (rows: ClientIdea[], lane: Lane, scores: IdeaScoreRead) => sortByScore(rows.map(i => fromClient(i, lane)).sort(byScore), scores, x => x.id)
    const { prominent } = splitFacets(buildFacets(ivanRows, IDEA_SPECS), IDEA_PROMINENT)
    return {
      ivan: {
        items: ivanItems, n: ivan.loadedAt ? ivan.counts.post ?? ivan.split.post.length : null, loading: ivan.loading, error: ivan.error, refresh: ivan.refresh,
        scores: sIvan, facets: prominent, lm: ivan.loadedAt ? ivan.counts.lead_magnet : null, unclassified: ivan.split.other.length, chip: cIvan,
      },
      risedtc: { items: client(rise.rows, 'risedtc', sRise), n: rise.loadedAt ? rise.rows.length : null, loading: rise.loading, error: rise.error, refresh: rise.refresh, scores: sRise, facets: splitFacets(buildFacets(rise.rows, CLIENT_IDEA_SPECS), ['source']).prominent, chip: cRise },
      arch: { items: client(arch.rows, 'arch', sArch), n: arch.loadedAt ? arch.rows.length : null, loading: arch.loading, error: arch.error, refresh: arch.refresh, scores: sArch, facets: splitFacets(buildFacets(arch.rows, CLIENT_IDEA_SPECS), ['source']).prominent, chip: cArch },
    }
  }, [ivan.split, ivan.counts, ivan.loadedAt, ivan.loading, ivan.error, ivan.refresh, rise.rows, rise.loadedAt, rise.loading, rise.error, rise.refresh, arch.rows, arch.loadedAt, arch.loading, arch.error, arch.refresh, sIvan, sRise, sArch, cIvan, cRise, cArch])
}

/** A channel's rows after its filters (today's facet specs, applied to the raw rows). */
export function filtered(items: IdeaItem[], lane: Lane, f: FilterState): IdeaItem[] {
  if (!Object.keys(f).length) return items
  if (lane === 'ivan') {
    const keep = new Set(applyFilters(items.map(i => i.ivan).filter((x): x is IdeaCandidate => !!x), IDEA_SPECS, f).map(i => i.id))
    return items.filter(i => keep.has(i.id))
  }
  const keep = new Set(applyFilters(items.map(i => i.client).filter((x): x is ClientIdea => !!x), CLIENT_IDEA_SPECS, f).map(i => i.id))
  return items.filter(i => keep.has(i.id))
}

const PLATE: Record<Lane, string> = { ivan: 'your post ideas', risedtc: 'Mattan’s ideas', arch: 'Davorin’s ideas' }
export const PAGE = 40

function Row({ it, on, pick, scores, chip }: { it: IdeaItem; on: boolean; pick: () => void; scores: IdeaScoreRead; chip: BanditChipRead }) {
  const line = outlierLine(scores.byRef.get(it.id), scores.ok && !scores.validated)
  const bandit = banditChipLine(chip.byRef.get(it.id))
  return (
    <button type="button" className={`cn-iq${on ? ' cn-sel' : ''}`} aria-current={on ? 'true' : undefined} onClick={pick} data-verb="open">
      <span className="cn-sc">{scoreText(it.score)}</span>
      <span className="cn-n">{it.title}</span>
      <time>{it.age}</time>
      <span className="cn-s">{it.unclassified ? 'no content type · ' : ''}{it.src}</span>
      {line && <span className="cn-s cn-ol">{line}</span>}
      {bandit && <span className="cn-s cn-bd">{bandit}</span>}
    </button>
  )
}

function Filters({ facets, f, set }: { facets: Facet[]; f: FilterState; set: (f: FilterState) => void }) {
  if (!facets.length) return null
  return (
    <div className="cn-flt" aria-label="Idea filters">
      {facets.map(fc => (
        <select key={fc.key} aria-label={fc.label} value={f[fc.key] ?? ''} onChange={e => {
          const n = { ...f }; if (e.target.value) n[fc.key] = e.target.value; else delete n[fc.key]; set(n)
        }}>
          <option value="">{fc.label}: all</option>
          {fc.options.map(o => <option key={o.value} value={o.value}>{o.label} ({o.n})</option>)}
        </select>
      ))}
      {Object.keys(f).length > 0 && <button type="button" onClick={() => set({})}>Clear</button>}
    </div>
  )
}

export function Ideas({ banks, phone }: { banks: IdeaBanks; phone: boolean }) {
  const [sel, setSel] = useState<{ lane: Lane; id: string } | null>(null)
  const [seat, setSeat] = useState<Lane>('ivan')
  const [flt, setFlt] = useState<Record<Lane, FilterState>>({ ivan: {}, risedtc: {}, arch: {} })
  const [pages, setPages] = useState<Record<Lane, number>>({ ivan: 1, risedtc: 1, arch: 1 })
  const view = (l: Lane) => filtered(banks[l].items, l, flt[l])
  const current = sel ? banks[sel.lane].items.find(i => i.id === sel.id) ?? null : null
  const shown = current ?? view(seat)[0] ?? view('ivan')[0] ?? null

  const done = (lane: Lane) => (id: string) => {
    const list = view(lane)
    const at = list.findIndex(i => i.id === id)
    const next = list[at + 1] ?? list[at - 1] ?? null
    setSel(next ? { lane, id: next.id } : null)
    banks[lane].refresh()
  }

  const channel = (l: Lane) => {
    const b = banks[l]
    const rows = view(l)
    const upto = pages[l] * PAGE
    const sortWord = b.scores.ok && b.scores.validated ? 'Outlier score first' : 'Highest score first'
    const floorLine = personalFloorLine(b.chip.slots)
    return (
      <div className="cn-ch" key={l}>
        {!phone && <div className="cn-plate"><b>{LANE_NAME[l]}</b><span>{PLATE[l]}</span></div>}
        {!phone && (
          <div className="cn-read">
            <div><small>To decide</small><em className={b.n ? 'cn-hot' : ''}>{b.n ?? (b.error ? '?' : '…')}</em></div>
            <div><small>Top score</small><em>{b.items.length ? scoreText(Math.max(...b.items.map(i => i.score ?? -1))) : '0'}</em></div>
          </div>
        )}
        {l === 'ivan' && (b.lm != null || !!b.unclassified) && (
          <p className="cn-lmline">
            {b.lm != null && <>{b.lm} lead-magnet idea{b.lm === 1 ? '' : 's'} decide{b.lm === 1 ? 's' : ''} in <a href={dHash('content', 'magnets')}>Magnets</a>, not here. </>}
            {b.unclassified ? `${b.unclassified} with no content type are shown here rather than dropped.` : ''}
          </p>
        )}
        {floorLine && (
          <p className="cn-lmline cn-bd">{floorLine}: one of this week's reach posts is your own pick from the bank below, not an arm recommendation.</p>
        )}
        <Filters facets={b.facets} f={flt[l]} set={f => { setFlt(p => ({ ...p, [l]: f })); setPages(p => ({ ...p, [l]: 1 })) }} />
        <div className="cn-sec"><span>{phone ? `${PLATE[l]}, ${sortWord.toLowerCase()}` : sortWord}</span><span>{Math.min(upto, rows.length)} of {rows.length} shown</span></div>
        <div className="cn-iqs">
          {b.error ? <Failed what={`${IDEA_OWNER[l]} ideas`} detail={b.error} onRetry={b.refresh} />
            : b.loading && b.items.length === 0 ? <Skeleton lines={5} title={false} label="Reading ideas" />
              : b.items.length === 0 ? <p className="cn-say">Nothing to decide. Every staged idea here has been approved or rejected.</p>
                : rows.length === 0 ? <p className="cn-say">No idea matches these filters. <button type="button" onClick={() => setFlt(p => ({ ...p, [l]: {} }))}>Clear the filters</button></p>
                  : rows.slice(0, upto).map(it => {
                    const on = shown?.id === it.id
                    return (
                      <div key={it.id}>
                        <Row it={it} on={on} pick={() => setSel({ lane: l, id: it.id })} scores={b.scores} chip={b.chip} />
                        {phone && on && <IdeaDetail it={it} onDone={done(l)} compact scores={b.scores} />}
                      </div>
                    )
                  })}
          {rows.length > upto && (
            <button type="button" className="cn-pagemore" data-verb="more" onClick={() => setPages(p => ({ ...p, [l]: p[l] + 1 }))}>
              Show {Math.min(PAGE, rows.length - upto)} more of {rows.length - upto}
            </button>
          )}
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
      {shown ? <IdeaDetail key={shown.id} it={shown} onDone={done(shown.lane)} scores={banks[shown.lane].scores} /> : <div className="cn-idm"><p className="cn-say">Pick an idea to read it.</p></div>}
    </div>
  )
}
