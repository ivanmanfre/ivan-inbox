import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Takeover } from './Takeover'
import { Failed } from './Surface'
import { label } from '../../lib/labels'
import {
  actionItems, callTopics, fetchCallBody, hasOpenBusiness, people, splitBody,
  type ActionItem, type CallRow,
} from '../../lib/transcripts'

// The call transcript reader (port #2, dashboard-port-audit.md).
//
// WHERE THIS LIVES, AND WHY IT IS NOT THE PEER THE AUDIT ASKED FOR.
//
// The audit recommends a third context peer beside the Thread peer and the
// Chat peer, and it priced the cost honestly: "a third peer type competes for
// the same 1 or 2 peer slots, so on the desktop canvas opening a transcript
// evicts the thread or Claude". It then accepted that cost. This ships as a
// takeover window instead, and the disagreement is with the acceptance, not
// with the reasoning.
//
// 1. That cost is avoidable rather than inherent, and this repo already
//    proved it. A `draft` peer once existed and was DELETED after Ivan said a
//    420px side pane made a long reading surface "literally impossible to
//    read" (Takeover.tsx:5-11); Shell.tsx records that drafts now open as a
//    takeover and that the peer kind survives only so the pure layout
//    functions stay general. A call transcript averages 39 minutes of
//    dialogue. It is longer than any draft in the app. Putting it into the
//    exact surface he rejected for shorter material would be porting the
//    recommendation and reproducing a defect he has already named once.
// 2. The audit's own fallback if the peer proves cramped is "a tenth rail
//    job". The takeover is the third option, and it was not priced because
//    the draft window shipped after the peer model was written down. It costs
//    zero rail jobs AND zero peer slots.
// 3. The audit's structural point is honoured in full: the reader is reachable
//    from the Calls area on Today, which is where the next-call card already
//    lives, and the list of everything that is not the next call sits in the
//    same place. That was the audit's own cheapest suggestion.
// 4. The one thing a peer would genuinely buy - the transcript beside the
//    conversation it belongs to - is worth nothing here, because the linking
//    measurement in lib/transcripts.ts found that ZERO of the 96 transcripts
//    resolve to an inbox prospect. There is no thread to keep beside it.
//
// WHAT IT COSTS, stated rather than buried. The window is modal: while a
// transcript is open the DMs list and Claude are both behind the scrim, so
// "ask Claude about this call" is not available from here. The draft window
// pays exactly the same price and has since it shipped. And Today grows a
// second block under the next-call card.
//
// READ ONLY. Nothing on this surface writes anything or contacts anybody. The
// old dashboard's Calls section has four write paths (reclassify a meeting
// type, edit the live sales script, mint a tokenised intake link, fire an n8n
// proposal build off the transcript) and not one of them travels. The
// follow-up draft that exists on the row is rendered as text and says so.

// A disclosure, in the same shape the draft and magnet windows already use, so
// the reader does not learn a second gesture for the same idea.
function Fold({ k, title, tail, open, toggle, children }: {
  k: string; title: string; tail?: ReactNode
  open: string[]; toggle: (k: string) => void; children: ReactNode
}) {
  const on = open.includes(k)
  return (
    <div className={`dw-sec${on ? ' on' : ''}`}>
      <button type="button" className="dw-sec-b" onClick={() => toggle(k)} aria-expanded={on}>
        <span className="dw-sec-n">{title}</span>
        {tail && <span className="dw-sec-t">{tail}</span>}
        <span className="dw-sec-c" aria-hidden>›</span>
      </button>
      {on && <div className="dw-sec-body">{children}</div>}
    </div>
  )
}

// The phase-1 metadata primitive, used as specified: the key and the value are
// DIRECT children of the grid, never wrapped in a per-pair box. Wrapping them
// would break both the two-column track and the `:has(> :nth-child(9))` rule
// that draws hairlines only past four rows (wbsys.css:403-441).
function Kv({ items }: { items: [string, ReactNode][] }) {
  if (items.length === 0) return null
  return (
    <div className="wbkv">
      {items.map(([k, v], i) => (
        <Fragment key={`${k}-${i}`}>
          <div className="wbkv-k">{k}</div>
          <div className="wbkv-v">{v}</div>
        </Fragment>
      ))}
    </div>
  )
}

export function callWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'date not recorded'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// The two halves of the promise ledger, drawn apart rather than interleaved.
// After a call the question is "what did I say I would do", and an owner
// column inside a flat list makes that a scan instead of an answer.
function Promises({ items }: { items: ActionItem[] }) {
  const mine = items.filter(i => i.mine)
  const theirs = items.filter(i => !i.mine)
  const group = (list: ActionItem[], heading: string) => list.length === 0 ? null : (
    <>
      <div className="cw-grp">{heading}</div>
      {list.map((it, i) => (
        <div className="cw-ai" key={`${heading}-${i}`}>
          <div className="cw-ai-t">{it.action}</div>
          {(it.owner || it.due || it.why) && (
            <div className="cw-ai-m">
              {it.owner && !it.mine && <span className="cw-own">{it.owner}</span>}
              {it.due && <span className="cw-due">Due {it.due}</span>}
              {it.why && <span className="cw-why">{it.why}</span>}
            </div>
          )}
        </div>
      ))}
    </>
  )
  return (
    <div className="cw-block">
      {group(mine, mine.length === 1 ? 'You said you would' : `You said you would (${mine.length})`)}
      {group(theirs, theirs.length === 1 ? 'They said they would' : `They said they would (${theirs.length})`)}
    </div>
  )
}

function listBlock(heading: string, values: (string | null | undefined)[] | null | undefined): ReactNode {
  const clean = (values ?? []).map(v => (v ?? '').trim()).filter(v => v !== '')
  if (clean.length === 0) return null
  return (
    <div className="cw-block">
      <div className="cw-grp">{heading}</div>
      {clean.map((v, i) => <div className="cw-li" key={i}>{v}</div>)}
    </div>
  )
}

function textBlock(heading: string, value: string | null | undefined, note?: string): ReactNode {
  const s = (value ?? '').trim()
  if (s === '') return null
  return (
    <div className="cw-block">
      <div className="cw-grp">{heading}</div>
      <div className="cw-text">{s}</div>
      {note && <div className="cw-note">{note}</div>}
    </div>
  )
}

// The queue rail, same primitive and same j/k affordance as the draft window's.
function CallQueue({ queue, id, onPick }: {
  queue: CallRow[]; id: string; onPick: (id: string) => void
}) {
  const at = queue.findIndex(q => q.id === id)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    el.querySelector('.dw-qrow.on')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <aside className="dw-queue" ref={ref}>
      <div className="dw-queue-h">
        <span>In this queue</span>
        <b>{at >= 0 ? at + 1 : '–'}/{queue.length}</b>
      </div>
      {queue.map(q => {
        const n = actionItems(q).length
        return (
          <button type="button" key={q.id} className={`dw-qrow${q.id === id ? ' on' : ''}`}
            onClick={() => onPick(q.id)}>
            <div className="dw-qrow-t">{q.title || 'Untitled call'}</div>
            <div className="dw-qrow-m">
              {callWhen(q.date)}
              {n > 0 && ` · ${n} action${n === 1 ? '' : 's'}`}
            </div>
          </button>
        )
      })}
    </aside>
  )
}

// The raw body, deferred. It is not fetched at all until the fold is opened,
// which is the whole reason the list query leaves transcript_text behind.
function Body({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setText(null); setError(''); setLoading(true)
    fetchCallBody(id)
      .then(t => { if (alive) setText(t) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not read it') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  if (loading) return <div className="cw-note">Reading the transcript…</div>
  if (error) return <div className="ops-err">{error}</div>
  const t = (text ?? '').trim()
  if (t === '') return <div className="cw-note">This call has no written transcript on the row.</div>
  const { spoken, screen } = splitBody(t)
  return (
    <>
      {spoken && <pre className="cw-pre">{spoken}</pre>}
      {screen && (
        <>
          <div className="cw-grp">What was on screen</div>
          <pre className="cw-pre">{screen}</pre>
        </>
      )}
    </>
  )
}

function CallBody({ row, queue, onPick }: {
  row: CallRow; queue: CallRow[]; onPick: (id: string) => void
}) {
  const [open, setOpen] = useState<string[]>(['brief'])
  const toggle = (k: string) => setOpen(o => (o.includes(k) ? o.filter(x => x !== k) : [...o, k]))

  const items = actionItems(row)
  const topics = callTopics(row)
  const who = people(row.participants)
  const b = row.brief
  const hasRail = queue.length > 1

  // What "extracted" means for this row, so the empty case can be honest
  // rather than eight collapsed headings over nothing. 84 of the 96 rows carry
  // no action items, 80 carry no summary and 95 carry no brief, so this is the
  // common case and not the edge one.
  const extracted = items.length > 0 || topics.length > 0
    || (row.summary ?? '').trim() !== '' || (row.follow_up_draft ?? '').trim() !== ''
    || b != null

  const meta: [string, ReactNode][] = [['When', callWhen(row.date)]]
  if (row.duration_minutes) meta.push(['Length', `${row.duration_minutes} minutes`])
  if (row.meeting_type) meta.push(['Kind', label(row.meeting_type)])
  if (who.length > 0) meta.push(['Who was on it', who.join(', ')])

  const briefRows: [string, ReactNode][] = []
  if (b?.fit_score != null) briefRows.push(['Fit', `${b.fit_score} out of 5`])
  if (b?.decision_maker) briefRows.push(['Decision maker', b.decision_maker])
  if (b?.industry) briefRows.push(['Industry', b.industry])
  if (b?.team_size) briefRows.push(['Team size', b.team_size])
  if (b?.automation_maturity) briefRows.push(['Automation maturity', label(b.automation_maturity)])
  if (b?.timeline) briefRows.push(['Timeline', b.timeline])
  if (b?.budget_signal) briefRows.push(['Budget signal', label(b.budget_signal)])

  const main = (
    <div className="dw-main">
      <div className="dw-main-in cw-main">
        <h3 className="cw-ttl">{row.title || 'Untitled call'}</h3>
        <div className="cw-sub">
          {callWhen(row.date)}
          {row.duration_minutes ? ` · ${row.duration_minutes} minutes` : ''}
          {who.length > 0 ? ` · ${who.join(', ')}` : ''}
        </div>

        {/* Lead with what was extracted. The order is what would change what
            he does next: what was promised, then what happens next, then what
            they pushed back on. The raw body is last and folded. */}
        {items.length > 0 && <Promises items={items} />}
        {textBlock('Next step', b?.next_step)}
        {listBlock('They pushed back on', b?.objections)}
        {textBlock('The hook to open a proposal with', b?.proposal_hook)}

        {textBlock(
          'Follow-up written after the call',
          row.follow_up_draft,
          'Text on the row, nothing more. This app never sends it, never queues it and has no approve button for it.',
        )}

        {textBlock('Summary', row.summary)}

        {topics.length > 0 && (
          <div className="cw-block">
            <div className="cw-grp">Content pulled out of this call ({topics.length})</div>
            {topics.map((t, i) => (
              <div className="cw-li" key={i}>
                {t.title}
                {t.format && <span className="cw-fmt">{t.format}</span>}
              </div>
            ))}
          </div>
        )}

        {!extracted && (
          <div className="cw-block">
            <div className="cw-empty">Nothing was pulled out of this call.</div>
            <div className="cw-note">
              No action items, no summary and no read of the room were written for it. The words
              are still here, below.
            </div>
          </div>
        )}

        <div className="cw-fold">
          <Fold k="raw" title="What was said" tail="the whole thing" open={open} toggle={toggle}>
            {open.includes('raw') && <Body id={row.id} />}
          </Fold>
        </div>
      </div>
    </div>
  )

  const insp = (
    <aside className="dw-insp">
      <div className="dw-insp-h">The call</div>
      <div className="cw-insp-pad"><Kv items={meta} /></div>

      <Fold
        k="brief"
        title="Read of the room"
        tail={b ? undefined : 'none written'}
        open={open}
        toggle={toggle}
      >
        {b ? (
          <div className="cw-insp-pad">
            <Kv items={briefRows} />
            {listBlock('What hurts', b.pain)}
            {listBlock('What they run on', b.stack)}
            {listBlock('What set this off', b.triggers)}
          </div>
        ) : (
          <div className="cw-note">
            The extractor writes this for sales calls and it never ran on this one. Only 1 of the
            96 calls on record carries it, so an empty panel here is the normal state and not a
            failure.
          </div>
        )}
      </Fold>

      <div className="cw-insp-foot">
        Reading only. Nothing on this screen writes to the database, and nothing here can reach
        the people who were on the call.
      </div>
    </aside>
  )

  return (
    <div className="dw cw">
      <div className={`dw-cols${hasRail ? '' : ' dw-norail'}`}>
        {main}
        {insp}
        {hasRail && <CallQueue queue={queue} id={row.id} onPick={onPick} />}
      </div>
    </div>
  )
}

export function CallWindow({ id, queue, onClose, onPick, mobile }: {
  id: string
  queue: CallRow[]
  onClose: () => void
  onPick: (id: string) => void
  mobile: boolean
}) {
  const row = queue.find(q => q.id === id) ?? null

  // j/k walks the queue, the same two keys the draft window binds, and nothing
  // else: no bare-key write exists on this surface because no write exists on
  // this surface at all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      const at = queue.findIndex(q => q.id === id)
      if (at < 0) return
      const next = e.key === 'j' ? at + 1 : at - 1
      if (next < 0 || next >= queue.length) return
      e.preventDefault()
      onPick(queue[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, queue, onPick])

  const sub = row
    ? `${callWhen(row.date)}${hasOpenBusiness(row) ? ` · ${actionItems(row).length} still open` : ''}`
    : null

  return (
    <Takeover label="Call" sub={sub} onClose={onClose} mobile={mobile} bodyClass="dw-body">
      {!row ? (
        <Failed
          what="This call"
          message="It is not in the list this window was opened from."
          loadedAt={null}
        />
      ) : (
        <CallBody key={row.id} row={row} queue={queue} onPick={onPick} />
      )}
    </Takeover>
  )
}
