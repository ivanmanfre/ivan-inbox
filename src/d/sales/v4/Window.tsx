import { useEffect, useRef, useState } from 'react'
import { actionItems, callTopics, people, type CallRow } from '../../../lib/transcripts'
import { Items, Text, Said } from '../CallWindow'
import { CallRoom, callWhen } from '../CallRoom'
import { otherPerson } from './model'

// An item with no owner, or one the notes call "Unclear", is nobody's yet: it is not theirs.
const unowned = (o: string | null) => !o || /^(?:unclear|unknown|tbd)$/i.test(o.trim())

export function Window({ row, at, of, onStep, layout, missing }: { row: CallRow | null; at: number; of: number; onStep: (d: 1 | -1) => void; layout: 'phone' | 'desktop'; missing?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const timer = useRef<number | null>(null)
  useEffect(() => { setCopied(false); setCopyError(''); return () => { if (timer.current != null) window.clearTimeout(timer.current) } }, [row?.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      e.preventDefault(); onStep(e.key === 'j' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])
  async function copy() {
    try {
      await navigator.clipboard.writeText(row?.follow_up_draft ?? '')
      setCopied(true); setCopyError('')
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch { setCopyError('Could not copy. Select the draft text to copy it.') }
  }
  if (missing) return <div className="sl4-window" data-call-missing><p className="sl4-empty">This call didn't load. It is not in the archive that was read. Pick one from calls on record.</p></div>
  if (!row) return <div className="sl4-window"><p className="sl4-empty">No call open. Pick one from calls on record.</p></div>
  const items = actionItems(row), b = row.brief, who = people(row.participants), topics = callTopics(row)
  const objections = (b?.objections ?? []).map(x => (x ?? '').trim()).filter(Boolean)
  return <div className={`sl4-window sl4-window-${layout}`} data-open-call={row.id}>
    <header className="sl4-window-head"><div className="sl4-eyebrow">Call · {callWhen(row.date)}</div>
      <nav aria-label="Step through calls"><button type="button" data-verb="prev-call" disabled={at <= 1} aria-label="Previous call (k)" title="Previous call · k" onClick={() => onStep(-1)}>‹</button><button type="button" data-verb="next-call" disabled={at >= of} aria-label="Next call (j)" title="Next call · j" onClick={() => onStep(1)}>›</button><small>{at} of {of}</small></nav>
      <h2>{otherPerson(row)}</h2><small>{row.duration_minutes ? `${row.duration_minutes} min` : 'length not recorded'}{who.length ? ` · ${who.join(', ')}` : ''}</small>
    </header>
    <div className="sl4-window-body">
      <div className="sl4-you"><Items head="You owe" list={items.filter(i => i.mine)} /></div>
      <Items head="They owe" list={items.filter(i => !i.mine && !unowned(i.owner))} />
      <Items head="Open, no owner" list={items.filter(i => !i.mine && unowned(i.owner))} />
      <Text head="Next step" text={b?.next_step} />
      {row.follow_up_draft?.trim() && <section className="sl4-follow"><div className="sl4-follow-head"><h3 className="sl4-eyebrow">Follow-up draft</h3><span className={`sl4-pill${row.follow_up_sent ? ' sl4-sent' : ''}`}>{row.follow_up_sent ? 'Sent' : 'Not sent'}</span><button type="button" data-verb="copy" onClick={() => void copy()} className={copied ? 'sl4-copied' : undefined}><span key={copied ? 'check' : 'copy'} className={copied ? 'sl4-check-pop' : undefined}>{copied ? '✓ Copied' : 'Copy'}</span></button></div><p>{row.follow_up_draft}</p>{copyError && <small role="alert">{copyError}</small>}</section>}
      <Text head="Summary" text={row.summary} />
      {objections.length > 0 && <div className="sl-cb"><div className="sl-cbh">They pushed back on</div><ul className="sl-dots">{objections.map((o,i) => <li key={i}>{o}</li>)}</ul></div>}
      <Text head="The hook to open a proposal with" text={b?.proposal_hook} />
      {topics.length > 0 && <section className="sl4-topics" data-call-topics><h3 className="sl4-eyebrow">Content pulled out ({topics.length})</h3><div>{topics.slice(0,6).map((t,i) => <span key={i}>{t.title}{t.format && <small> · {t.format}</small>}</span>)}</div>{topics.length > 6 && <details><summary>{topics.length - 6} more topics</summary>{topics.slice(6).map((t,i) => <p key={i}>{t.title} · {t.format}</p>)}</details>}</section>}
      <Said key={row.id} id={row.id} />
      {b && <CallRoom key={row.id} row={row} clean />}
    </div>
  </div>
}
