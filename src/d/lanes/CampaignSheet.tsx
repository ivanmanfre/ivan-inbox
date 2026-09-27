/* The campaign sheet: what opens when a campaign is tapped on Lanes. Read-only.
   Desktop: right sheet over the Arch column. Phone: bottom sheet. */
import { useEffect, useState, type ReactNode } from 'react'
import { shortName, type CampaignPerf } from '../../lib/campaignPerf'
import { loadPerf, stepLabel, type PerfState } from '../../lib/outreachPerf'
import { fetchCampaignRecent, type CampaignRecentSend } from '../../lib/sends'
import { SEAT_NAME, seatOf } from '../seats'
import { Sheet } from '../ui/Sheet'
import { acceptShort } from './bandCells'
import { LIVE_STAGES, OFF_STAGES, STAGE_LABEL, laneLabel } from './labels'
import { ago } from './model'
import { fetchCampaignReplies, fetchInviteArms, fetchStageCounts, fetchStoppedBrands, laneMixOnce, type LaneMix, type Reply } from './reads'
import { SheetNotes } from './SheetNotes'

export type Load<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }
export function useRead<T>(fn: (() => Promise<T>) | null, key: string): Load<T> {
  const [s, set] = useState<Load<T>>({ kind: 'loading' })
  useEffect(() => {
    if (!fn) return
    let live = true
    set({ kind: 'loading' })
    fn().then(data => { if (live) set({ kind: 'ready', data }) }, e => { if (live) set({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the read
  }, [key])
  return s
}

export function Shs({ children, tail }: { children: ReactNode; tail?: ReactNode }) {
  return <div className="dl-shs"><span>{children}</span><span>{tail}</span></div>
}
export function LoadLine<T>({ l, what, children }: { l: Load<T>; what: string; children: (d: T) => ReactNode }) {
  if (l.kind === 'loading') return <p className="dl-sl dl-unk">Reading {what}…</p>
  if (l.kind === 'failed') return <p className="dl-sl dl-bad">Could not read {what}: {l.message}</p>
  return <>{children(l.data)}</>
}

function Perf({ state, c }: { state: Load<PerfState>; c: CampaignPerf }) {
  return (
    <LoadLine l={state} what="reply rates">{s => {
      if (s.kind === 'failed') return <p className="dl-sl dl-bad">Could not read reply rates: {s.message}</p>
      const lane = s.kind === 'ready' ? s.data.lanes.find(l => l.campaigns.includes(c.campaign_name)) : null
      if (!lane) return <p className="dl-sl">No DM from this campaign is old enough to judge yet. A DM counts 7 days after it went out.</p>
      const others = lane.campaigns.filter(n => n !== c.campaign_name).map(shortName)
      return <>
        <p className="dl-sl">Measured on the {lane.lane} lane{others.length ? `, shared with ${others.join(', ')}` : ''}. Last 14 matured days against the 60 before.</p>
        <table className="dl-steps"><thead><tr><th>Step</th><th>Sent</th><th>Replied</th><th>Prior 60d</th><th /></tr></thead><tbody>
          {lane.cells.map(x => (
            <tr key={x.step}><td>{stepLabel(x.step)}</td><td className="dl-m">{x.n}</td><td className="dl-m">{(x.rate * 100).toFixed(1)}%</td><td className="dl-m">{(x.base_rate * 100).toFixed(1)}%</td>
              <td className={x.status === 'drift' ? 'dl-al' : 'dl-m dl-dimt'}>{x.status === 'drift' ? 'below prior' : x.status === 'thin' ? 'too few' : ''}</td></tr>
          ))}
        </tbody></table>
        {lane.variants.length > 0 && <p className="dl-sl">{lane.variants.length} copy variants on this lane.</p>}
      </>
    }}</LoadLine>
  )
}

export function CampaignSheet({ c, onClose, now }: { c: CampaignPerf; onClose: () => void; now: number }) {
  const seat = seatOf(c.client_id) ?? 'ivan'
  const stages = useRead(() => fetchStageCounts(c.campaign_id), `st:${c.campaign_id}`)
  const mix = useRead<LaneMix>(() => laneMixOnce(c.campaign_id), `mx:${c.campaign_id}`)
  const perf = useRead<PerfState>(() => loadPerf(seat), `pf:${seat}`)
  const replies = useRead<Reply[]>(() => fetchCampaignReplies(c.campaign_name), `rp:${c.campaign_id}`)
  const sends = useRead<CampaignRecentSend[]>(() => fetchCampaignRecent(c.campaign_name, 6), `sd:${c.campaign_id}`)
  const lanes = mix.kind === 'ready' ? mix.data.lanes.map(l => l.lane) : []
  const arms = useRead(seat === 'arch' && lanes.includes('company_expansion') ? () => fetchInviteArms(c.campaign_name) : null, `ar:${c.campaign_id}:${lanes.includes('company_expansion')}`)
  const riseExp = seat === 'risedtc' && /company expansion/i.test(c.campaign_name)
  const stopped = useRead(riseExp ? () => fetchStoppedBrands(c.campaign_id) : null, `sb:${c.campaign_id}`)
  const fig = (label: string, v: number) => <div><small>{label}</small><em className={v ? '' : 'dl-z'}>{v}</em></div>
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title={shortName(c.campaign_name)}
      sub={`${SEAT_NAME[seat]} · ${c.is_active ? 'Active' : 'Paused'}${c.last_send ? ` · last send ${ago(c.last_send, now)}` : ''}`}>
      <div className="dl-wk4">{fig('Invites 7d', c.invites_7d)}{fig('DMs 7d', c.dms_7d)}{fig('Replied 7d', c.replied_7d)}{fig('Calls 30d', c.calls_30d)}</div>
      <p className="dl-sl">{c.positive_7d} positive of {c.replied_7d} replies. {acceptShort(c)}.</p>
      <SheetNotes seat={seat} lanes={lanes} arms={arms} stopped={riseExp ? stopped : null} />
      <LoadLine l={stages} what="the stage counts">{st => {
        const tot = st.reduce((a, s) => a + s.n, 0)
        return <>
          <Shs tail={`${tot.toLocaleString('en-US')} people`}>Where everyone in it stands</Shs>
          {tot > 0 && <div className="dl-ladder">{st.map(s => <i key={s.stage} title={STAGE_LABEL[s.stage] ?? s.stage} className={LIVE_STAGES.has(s.stage) ? 'dl-lv' : OFF_STAGES.has(s.stage) ? 'dl-off' : ''} style={{ width: `${(s.n / tot) * 100}%` }} />)}</div>}
          <div className="dl-stg">{st.map(s => <div key={s.stage} className={LIVE_STAGES.has(s.stage) ? 'dl-lv' : ''}><span>{STAGE_LABEL[s.stage] ?? s.stage}</span><b>{s.n.toLocaleString('en-US')}</b></div>)}</div>
        </>
      }}</LoadLine>
      {mix.kind === 'ready' && mix.data.lanes.length > 0 && <>
        <Shs>Lanes inside, touched in 30 days</Shs>
        <div className="dl-lanemix">{mix.data.lanes.slice(0, 8).map(l => <span key={l.lane}>{laneLabel(l.lane)} <b>{mix.data.capped ? '≥' : ''}{l.n}</b></span>)}</div>
      </>}
      <Shs>Reply rate by DM step</Shs>
      <Perf state={perf} c={c} />
      <LoadLine l={replies} what="the newest replies">{rs => <>
        <Shs tail={rs.length}>Newest replies</Shs>
        {rs.length ? rs.map(m => <div className="dl-msg dl-in" key={m.id}><div className="dl-mh"><b>{m.prospect_name}</b><em>{ago(m.sent_at, now)}</em></div><p>{m.message_text}</p></div>)
          : <p className="dl-sl">No replies in 14 days.</p>}
      </>}</LoadLine>
      <LoadLine l={sends} what="the newest sends">{ss => <>
        <Shs tail={ss.length}>Newest sends</Shs>
        {ss.length ? ss.map(m => {
          const blank = !m.message_text || /^\(blank invite/i.test(m.message_text)
          const kind = m.message_type === 'connection_note' ? 'Invite' : m.channel === 'linkedin_inmail' || m.message_type === 'inmail' ? 'InMail' : m.message_type === 'email' ? 'Email' : 'DM'
          return <div className="dl-msg" key={m.id}><div className="dl-mh"><b>{m.prospect_name}</b><span className="dl-tag">{kind}</span><em>{ago(m.sent_at, now)}</em></div>{blank ? <p className="dl-none">No note</p> : <p>{m.message_text.replace(/\n?---\n?/g, ' / ')}</p>}</div>
        }) : <p className="dl-sl">Nothing sent from this campaign yet.</p>}
      </>}</LoadLine>
    </Sheet>
  )
}
