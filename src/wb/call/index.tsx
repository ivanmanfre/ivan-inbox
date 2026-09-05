/* ==========================================================================
   src/wb/call/index.tsx — S18, the call transcript reader.

   Rebuilt from `src/exp/v2c/CallWindow.tsx` onto `src/ds` and the wave kit.
   Every fetch, every derived value, every keyboard path and every user-visible
   string is the one that file already had; the reasoning it carried about WHY
   this is a takeover and not a peer is kept verbatim below, because it is the
   record of a decision and not decoration.

   THE SHELL. W2 owns the shared `src/wb/takeover`; it had not landed on this
   branch when this wave cut, so `./Takeover.tsx` is a local copy with the same
   three-pane structure and the same props. Named in NOTES.

   WHERE THIS LIVES, AND WHY IT IS NOT THE PEER THE AUDIT ASKED FOR.

   The audit recommends a third context peer beside the Thread peer and the
   Chat peer, and it priced the cost honestly: "a third peer type competes for
   the same 1 or 2 peer slots, so on the desktop canvas opening a transcript
   evicts the thread or Claude". It then accepted that cost. This ships as a
   takeover window instead, and the disagreement is with the acceptance, not
   with the reasoning.

   1. That cost is avoidable rather than inherent, and this repo already
      proved it. A `draft` peer once existed and was DELETED after Ivan said a
      420px side pane made a long reading surface "literally impossible to
      read"; drafts now open as a takeover and the peer kind survives only so
      the pure layout functions stay general. A call transcript averages 39
      minutes of dialogue. It is longer than any draft in the app. Putting it
      into the exact surface he rejected for shorter material would be porting
      the recommendation and reproducing a defect he has already named once.
   2. The audit's own fallback if the peer proves cramped is "a tenth rail
      job". The takeover is the third option, and it was not priced because
      the draft window shipped after the peer model was written down. It costs
      zero rail jobs AND zero peer slots.
   3. The audit's structural point is honoured in full: the reader is reachable
      from the Calls area on Today, which is where the next-call card already
      lives, and the list of everything that is not the next call sits in the
      same place.
   4. The one thing a peer would genuinely buy - the transcript beside the
      conversation it belongs to - is worth nothing here, because the linking
      measurement in lib/transcripts.ts found that ZERO of the 96 transcripts
      resolve to an inbox prospect. There is no thread to keep beside it.

   WHAT IT COSTS, stated rather than buried. The window is modal: while a
   transcript is open the DMs list and Claude are both behind the scrim, so
   "ask Claude about this call" is not available from here. The draft window
   pays exactly the same price and has since it shipped.

   READ ONLY. Nothing on this surface writes anything or contacts anybody. The
   old dashboard's Calls section has four write paths (reclassify a meeting
   type, edit the live sales script, mint a tokenised intake link, fire an n8n
   proposal build off the transcript) and not one of them travels. The
   follow-up draft that exists on the row is rendered as text and says so.
   ========================================================================== */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Chip, EmptyState, Icon } from '../../ds'
import { KV, Sep } from '../kit'
import { Takeover } from './Takeover'
import { label } from '../../lib/labels'
import {
  actionItems, callTitle, callTopics, fetchCallBody, hasOpenBusiness, people, splitBody,
  type ActionItem, type CallRow,
} from '../../lib/transcripts'
import './call.css'

// A disclosure, in the same shape the draft and magnet windows already use, so
// the reader does not learn a second gesture for the same idea. The glyph the
// old file drew inline is the system's `disclose` mark now.
function Fold({ k, title, tail, open, toggle, children }: {
  k: string; title: string; tail?: ReactNode
  open: string[]; toggle: (k: string) => void; children: ReactNode
}) {
  const on = open.includes(k)
  return (
    <div className="a-cw-fold" data-on={on ? '' : undefined}>
      <button type="button" className="a-cw-fold-b" onClick={() => toggle(k)} aria-expanded={on}>
        <span className="a-cw-fold-n a-title-t">{title}</span>
        {tail && <span className="a-cw-fold-t a-meta">{tail}</span>}
        <span className="a-cw-fold-c" aria-hidden="true"><Icon name="forward" size={16} /></span>
      </button>
      {on && <div className="a-cw-fold-body">{children}</div>}
    </div>
  )
}

export function callWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'date not recorded'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** One named block in the main column: an eyebrow, then what it holds. */
function Block({ heading, tail, children }: { heading: string; tail?: ReactNode; children: ReactNode }) {
  return (
    <section className="a-cw-block">
      <div className="a-cw-h">
        <span className="a-eyebrow">{heading}</span>
        {tail && <span className="a-cw-h-t a-meta">{tail}</span>}
      </div>
      {children}
    </section>
  )
}

// The two halves of the promise ledger, drawn apart rather than interleaved.
// After a call the question is "what did I say I would do", and an owner
// column inside a flat list makes that a scan instead of an answer.
function Promises({ items }: { items: ActionItem[] }) {
  const mine = items.filter(i => i.mine)
  const theirs = items.filter(i => !i.mine)
  const group = (list: ActionItem[], heading: string) => list.length === 0 ? null : (
    <Block heading={heading} key={heading}>
      <ul className="a-cw-ai">
        {list.map((it, i) => (
          <li className="a-cw-ai-i" key={`${heading}-${i}`}>
            <span className="a-cw-ai-t a-body-t">{it.action}</span>
            {(it.owner || it.due || it.why) && (
              <span className="a-wrapline a-meta">
                {it.owner && !it.mine && <span className="a-cw-own">{it.owner}</span>}
                {it.due && <Chip tone="quiet">Due {it.due}</Chip>}
                {it.why && <span className="a-dim">{it.why}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Block>
  )
  return (
    <>
      {group(mine, mine.length === 1 ? 'You said you would' : `You said you would (${mine.length})`)}
      {group(theirs, theirs.length === 1 ? 'They said they would' : `They said they would (${theirs.length})`)}
    </>
  )
}

function listBlock(heading: string, values: (string | null | undefined)[] | null | undefined): ReactNode {
  const clean = (values ?? []).map(v => (v ?? '').trim()).filter(v => v !== '')
  if (clean.length === 0) return null
  return (
    <Block heading={heading}>
      <ul className="a-cw-li">
        {clean.map((v, i) => <li className="a-body-t" key={i}>{v}</li>)}
      </ul>
    </Block>
  )
}

function textBlock(heading: string, value: string | null | undefined, note?: string): ReactNode {
  const s = (value ?? '').trim()
  if (s === '') return null
  return (
    <Block heading={heading}>
      <div className="a-body-t a-pre">{s}</div>
      {note && <div className="a-meta a-cw-note">{note}</div>}
    </Block>
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
    el.querySelector('.a-cw-q-r[data-on]')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <aside className="a-cw-q" ref={ref} aria-label="Call queue">
      <div className="a-cw-q-h">
        <span className="a-eyebrow">In this queue</span>
        <Badge label={`${at >= 0 ? at + 1 : 0} of ${queue.length}`}>{`${at >= 0 ? at + 1 : '–'}/${queue.length}`}</Badge>
      </div>
      {queue.map(q => {
        const n = actionItems(q).length
        return (
          <button
            type="button"
            key={q.id}
            className="a-cw-q-r"
            data-on={q.id === id ? '' : undefined}
            aria-current={q.id === id ? 'true' : undefined}
            onClick={() => onPick(q.id)}
          >
            <span className="a-cw-q-t">{callTitle(q.title)}</span>
            <span className="a-cw-q-m a-mono">
              {callWhen(q.date)}
              {n > 0 && <><Sep />{n} action{n === 1 ? '' : 's'}</>}
            </span>
          </button>
        )
      })}
    </aside>
  )
}

// The raw body, deferred. It is not fetched at all until the fold is opened,
// which is the whole reason the list query leaves transcript_text behind.
function RawBody({ id }: { id: string }) {
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

  if (loading) return <div className="a-meta a-cw-note">Reading the transcript…</div>
  if (error) return <div className="a-meta a-sev-urgent">{error}</div>
  const t = (text ?? '').trim()
  if (t === '') return <div className="a-meta a-cw-note">This call has no written transcript on the row.</div>
  const { spoken, screen } = splitBody(t)
  return (
    <>
      {spoken && <pre className="a-cw-pre a-mono">{spoken}</pre>}
      {screen && (
        <>
          <div className="a-eyebrow a-cw-pre-h">What was on screen</div>
          <pre className="a-cw-pre a-mono">{screen}</pre>
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

  const meta: Array<[ReactNode, ReactNode]> = [['When', callWhen(row.date)]]
  if (row.duration_minutes) meta.push(['Length', `${row.duration_minutes} minutes`])
  if (row.meeting_type) meta.push(['Kind', label(row.meeting_type)])
  if (who.length > 0) meta.push(['Who was on it', who.join(', ')])

  const briefRows: Array<[ReactNode, ReactNode]> = []
  if (b?.fit_score != null) briefRows.push(['Fit', `${b.fit_score} out of 5`])
  if (b?.decision_maker) briefRows.push(['Decision maker', b.decision_maker])
  if (b?.industry) briefRows.push(['Industry', b.industry])
  if (b?.team_size) briefRows.push(['Team size', b.team_size])
  if (b?.automation_maturity) briefRows.push(['Automation maturity', label(b.automation_maturity)])
  if (b?.timeline) briefRows.push(['Timeline', b.timeline])
  if (b?.budget_signal) briefRows.push(['Budget signal', label(b.budget_signal)])

  return (
    <div className="a-cw" data-rail={hasRail ? '' : undefined}>
      <div className="a-cw-main">
        <div className="a-cw-col">
          <h3 className="a-page-t">{callTitle(row.title)}</h3>
          <div className="a-cw-sub a-mono a-dim">
            {callWhen(row.date)}
            {row.duration_minutes ? <><Sep />{row.duration_minutes} minutes</> : null}
            {who.length > 0 ? <><Sep />{who.join(', ')}</> : null}
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
            <Block heading={`Content pulled out of this call (${topics.length})`}>
              <ul className="a-cw-li">
                {topics.map((t, i) => (
                  <li className="a-body-t" key={i}>
                    {t.title}
                    {t.format && <span className="a-cw-fmt a-meta">{t.format}</span>}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {!extracted && (
            <EmptyState
              icon="quote"
              title="Nothing was pulled out of this call."
              sub="No action items, no summary and no read of the room were written for it. The words are still here, below."
            />
          )}

          <Fold k="raw" title="What was said" tail="the whole thing" open={open} toggle={toggle}>
            {open.includes('raw') && <RawBody id={row.id} />}
          </Fold>
        </div>
      </div>

      <aside className="a-cw-insp" aria-label="The call">
        <div className="a-cw-insp-h"><span className="a-eyebrow">The call</span></div>
        <div className="a-cw-insp-pad"><KV rows={meta} /></div>

        <Fold
          k="brief"
          title="Read of the room"
          tail={b ? undefined : 'none written'}
          open={open}
          toggle={toggle}
        >
          {b ? (
            <div className="a-cw-insp-pad">
              <KV rows={briefRows} />
              {listBlock('What hurts', b.pain)}
              {listBlock('What they run on', b.stack)}
              {listBlock('What set this off', b.triggers)}
            </div>
          ) : (
            <div className="a-meta a-cw-note">
              The extractor writes this for sales calls and it never ran on this one. Only 1 of the
              96 calls on record carries it, so an empty panel here is the normal state and not a
              failure.
            </div>
          )}
        </Fold>

        <div className="a-cw-foot a-meta">
          Reading only. Nothing on this screen writes to the database, and nothing here can reach
          the people who were on the call.
        </div>
      </aside>

      {hasRail && <CallQueue queue={queue} id={row.id} onPick={onPick} />}
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
    <Takeover label="Call" sub={sub} onClose={onClose} mobile={mobile}>
      {!row ? (
        <div className="a-cw-failed">
          <EmptyState
            icon="error"
            title="This call didn’t load"
            sub="It is not in the list this window was opened from."
          />
        </div>
      ) : (
        <CallBody key={row.id} row={row} queue={queue} onPick={onPick} />
      )}
    </Takeover>
  )
}
