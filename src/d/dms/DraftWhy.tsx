// "Why this draft · written by …" (./Explain, today's DraftExplanation) and "Where this came from"
// (mock `.df-src`). Only the explicit display projection of the evidence; never raw reasoning.
import { useState } from 'react'
import { clientOwner, type InboxMessage, type Thread } from '../../lib/inbox'
import { normalizeDraftExplanation } from '../../lib/draftExplanation'
import { Explain } from './Explain'
import { SEAT_NAME, seatOf } from '../seats'
import { warsawDm } from '../ui/time'

const ORIGIN: [RegExp, string][] = [
  [/^rise_reply|reply_draft|warm_reply/, 'the reply drafter'], [/stall_bump|_bump_|bump_v/, 'the stall bump'], [/follow/, 'the follow-up drafter'],
  [/^dm1|_dm1|warm_signal_dm1/, 'the first-message drafter'], [/arch/, "Davorin's reply drafter"], [/./, 'the drafter'],
]
export const origin = (m: InboxMessage) => (ORIGIN.find(([re]) => re.test(m.ai_model ?? '')) ?? [null, 'the drafter'])[1]

const day = (iso: string | null | undefined) => (iso ? warsawDm(iso) : '')

export function DraftWhy({ t, draft, edited, onRetry }: { t: Thread; draft: InboxMessage; edited: string; onRetry: () => void }) {
  const [srcOpen, setSrcOpen] = useState(false)
  const x = normalizeDraftExplanation(draft.draft_evidence)
  const ev = draft.draft_evidence
  const owner = clientOwner(t.client_id)?.owner ?? null
  const seat = seatOf(t.client_id)
  const learned = ev?.learned ?? []
  const exemplars = ev?.exemplars ?? []
  const facts = ev?.facts && !Array.isArray(ev.facts) ? ev.facts : null
  const n = learned.length + exemplars.length + (facts ? 1 : 0) + x.sources.length
  return (
    <>
      <Explain messageId={draft.id} messageText={draft.message_text} editedText={edited} evidence={draft.draft_evidence}
        unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} by={origin(draft)} />
      {n > 0 && (
        <div className="dm-src">
          <button type="button" className="dm-src-h" aria-expanded={srcOpen} onClick={() => setSrcOpen(o => !o)}>
            <span>Where this came from</span><span>{n} source{n === 1 ? '' : 's'} · {srcOpen ? 'close' : 'open'}</span>
          </button>
          {srcOpen && <>
            {learned.length > 0 && <div className="dm-src-g"><small>Learned from {owner ?? 'your DMs'}</small>
              {learned.slice(0, 5).map(f => <div key={f.id} className="dm-src-r"><span>{f.fact}</span><span>{owner ? 'his' : 'your'} DM{f.from ? ` to ${f.from}` : ''}, {day(f.at)}</span></div>)}</div>}
            {facts && <div className="dm-src-g"><small>{seat ? SEAT_NAME[seat] : ''} notes</small><div className="dm-src-r"><span>Company facts</span><span>version {facts.version ?? '?'}</span></div></div>}
            {(ev?.store_fact || ev?.anchor || ev?.scan_finding) && <div className="dm-src-g"><small>Grounding</small>
              {ev?.store_fact && <div className="dm-src-r"><span>{ev.store_fact}</span><span>their store</span></div>}
              {ev?.anchor && <div className="dm-src-r"><span>{ev.anchor}</span><span>anchor client</span></div>}
              {ev?.scan_finding && <div className="dm-src-r"><span>{ev.scan_finding}</span><span>their scan</span></div>}</div>}
            {exemplars.length > 0 && <div className="dm-src-g"><small>Voice copied from</small>
              {exemplars.slice(0, 3).map((v, i) => <div key={i} className="dm-src-r"><span>{v.reply}</span><span>to {v.prospect || 'a lead'}, {day(v.at)}</span></div>)}</div>}
            {x.sources.length > 0 && <div className="dm-src-g"><small>Read on the web</small>
              {x.sources.slice(0, 5).map(s => <div key={s.url} className="dm-src-r"><a className="d-link" href={s.url} target="_blank" rel="noreferrer">{s.title}</a><span /></div>)}</div>}
          </>}
        </div>
      )}
    </>
  )
}
