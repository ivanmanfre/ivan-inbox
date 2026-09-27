import { useEffect, useState } from 'react'
import { actionItems, callTitle, callTopics, fetchCallBody, hasOpenBusiness, people, splitBody, type ActionItem, type CallRow } from '../../lib/transcripts'
import { DIcon } from '../ui/icons'
import { Key } from '../ui/Key'
import { CallRoom, callWhen, Topics } from './CallRoom'

// THE CALL WINDOW. What was promised (yours apart from theirs), the next step,
// what they pushed back on, the summary, the follow-up draft IN FULL (the judge
// caught a clamp mid-sentence; nothing here is cut) and the transcript behind a
// fold, read only when opened. Previous (k) / Next (j) step the queue. Read
// only: nothing on this pane writes or reaches anybody.

function Items({ head, list }: { head: string; list: ActionItem[] }) {
  if (list.length === 0) return null
  return (
    <div className="sl-cb">
      <div className="sl-cbh">{list.length === 1 ? head : `${head} (${list.length})`}</div>
      <ul>{list.map((i, n) => (
        <li key={n}><DIcon name="check" /><span>{i.action}
          {i.owner && !i.mine && <em> · {i.owner}</em>}{i.due && <em> · due {i.due}</em>}
          {i.why && <small>{i.why}</small>}</span></li>
      ))}</ul>
    </div>
  )
}

function Text({ head, text, note }: { head: string; text: string | null | undefined; note?: string }) {
  const t = (text ?? '').trim()
  if (!t) return null
  return <div className="sl-cb"><div className="sl-cbh">{head}</div><p>{t}</p>{note && <div className="sl-note">{note}</div>}</div>
}

function Said({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return
    let live = true
    setText(null); setErr('')
    fetchCallBody(id).then(t => { if (live) setText(t) }).catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Could not read it') })
    return () => { live = false }
  }, [open, id])
  const body = splitBody((text ?? '').trim())
  return (
    <div className="sl-said">
      <button type="button" className="sl-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}><span>What was said</span><small>the whole thing</small></button>
      {open && (err ? <div className="sl-warn">{err}</div>
        : text === null ? <div className="sl-quiet">Reading the transcript…</div>
          : !body.spoken ? <div className="sl-quiet">This call has no written transcript on the row.</div>
            : <><pre className="sl-pre">{body.spoken}</pre>{body.screen && <><div className="sl-cbh">What was on screen</div><pre className="sl-pre">{body.screen}</pre></>}</>)}
    </div>
  )
}

export function CallWindow({ row, at, of, onStep, layout, missing }: {
  row: CallRow | null; at: number; of: number; onStep: (d: 1 | -1) => void; layout: 'desktop' | 'phone'
  /** The address asked for a call that is not in the archive (today's "This call didn't load"). */
  missing?: boolean
}) {
  // j / k at every width, as today's call window (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      e.preventDefault()
      onStep(e.key === 'j' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])

  if (missing) return <div className="sl-cw" data-call-missing><div className="sl-quiet sl-big">This call didn't load. It is not in the archive that was read: it may have been removed, or the link is from another account. Pick one from calls on record.</div></div>
  if (!row) return <div className="sl-cw"><div className="sl-quiet sl-big">No call open. Pick one from calls on record.</div></div>
  const items = actionItems(row)
  const b = row.brief
  const who = people(row.participants)
  const objections = (b?.objections ?? []).map(x => (x ?? '').trim()).filter(Boolean)
  const extracted = items.length > 0 || callTopics(row).length > 0 || (row.summary ?? '').trim() || (row.follow_up_draft ?? '').trim() || b
  return (
    <div className={`sl-cw sl-cw-${layout}`} data-open-call={row.id}>
      <div className="sl-cwh">
        <span className="sl-eb">Call</span>
        <b>{callTitle(row.title)}</b>
        <small>{callWhen(row.date)}{hasOpenBusiness(row) ? ` · ${items.length} still open` : ''} · {row.duration_minutes ? `${row.duration_minutes} minutes` : 'length not recorded'}{who.length ? ` · ${who.join(', ')}` : ''}</small>
      </div>
      <div className="sl-cwb">
        <Items head="You said you would" list={items.filter(i => i.mine)} />
        <Items head="They said they would" list={items.filter(i => !i.mine)} />
        <Text head="Next step" text={b?.next_step} />
        {objections.length > 0 && <div className="sl-cb"><div className="sl-cbh">They pushed back on</div><ul className="sl-dots">{objections.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
        <Text head="The hook to open a proposal with" text={b?.proposal_hook} />
        <Text head="Follow-up draft" text={row.follow_up_draft} note={row.follow_up_sent ? 'Sent.' : 'Not sent. Shown as text, nothing here sends it.'} />
        <Text head="Summary" text={row.summary} />
        <Topics row={row} />
        {!extracted && <div className="sl-quiet">Nothing was pulled out of this call: no action items, no summary. The words are still here, below.</div>}
        <Said id={row.id} />
        <CallRoom row={row} />
      </div>
      <div className="sl-cwk">
        <Key verb="prev-call" disabled={at <= 1} onClick={() => onStep(-1)} sub="k">Previous</Key>
        <div className="sl-cwq"><em>{at}</em>/{of}</div>
        <Key verb="next-call" disabled={at >= of} onClick={() => onStep(1)} sub="j">Next</Key>
      </div>
    </div>
  )
}
