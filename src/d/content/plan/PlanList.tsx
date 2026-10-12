import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { planDay, type BrainStrip, type PlanRead } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { dHash } from '../../route'
import { Empty } from '../../ui/states'
import {
  ST_WORD, flagsFor, quoteFor, readLine, reasonFor, timeLabel, traitLine, tzOf,
  type Acct, type Flag, type PlanItem, type Tz,
} from './planBrain'

// PLAN > LIST (spec 2026-10-12 §3b, R2.2, R4). Day groups with sticky headers, one row per post or planned
// slot: title, status dot and word (the word on the phone too: colour alone is not a status), the flags that
// are exceptions, one line of why. A tap opens the row in place: why in full, the call quote, the niche trait,
// the brain guess, then "Why, in full" (the panel) and "Read and approve" while it waits. Nothing here writes.

const STAGGER_MS = 30
const STAGGER_CAP_MS = 400
/** The longest entry: the stagger cap plus the slow duration (480 ms) with room to spare. */
const ENTRY_MS = 1000

/**
 * True once the entry fades have played. The fades key off its absence, so they run on the first mount only,
 * never again when the motion level flips back (a hidden page reads as motion off, then full on return).
 */
export function useEntered(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), ENTRY_MS)
    return () => clearTimeout(t)
  }, [])
  return entered
}

const ICON: Record<'lm' | 'boost' | 'me' | 'deck' | 'warn', ReactNode> = {
  lm: <path d="M4 2v6a4 4 0 008 0V2M4 5h3M9 5h3" />,
  boost: <path d="M3 11l4-4 3 3 3-5M10 5h3v3" />,
  me: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 14c.7-3 2.6-4.5 5-4.5s4.3 1.5 5 4.5" /></>,
  deck: <><rect x="4" y="2" width="9" height="11" rx="1.5" /><path d="M2.5 4.5v9a1 1 0 001 1h7" /></>,
  warn: <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.2" />,
}
const FLAG_ICON: Record<Flag['key'], keyof typeof ICON> = { lm: 'lm', boosted: 'boost', founder: 'me', carousel: 'deck', weekend: 'warn', failed: 'warn', low: 'warn', fact: 'warn' }

export function FlagChip({ f }: { f: Flag }) {
  return <span className={`pl2-chip pl2-chip-${f.tone}`} data-flag={f.key}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{ICON[FLAG_ICON[f.key]]}</svg>{f.label}
  </span>
}

/** The brain guess: one sentence, a half-as-often to 2x scale (log, average in the middle), the detail line. */
export function GuessBlock({ it, acct }: { it: PlanItem; acct: Acct }) {
  const r = readLine(it, acct)
  if (!r) return <p className="pl2-no">No brain guess yet for this draft.</p>
  const pos = Math.max(4, Math.min(96, 50 + Math.log2(r.x) * 50))
  return <div className="pl2-read">
    <p><b>{r.sign}.</b> {r.text}</p>
    {!r.flat && <>
      <div className="pl2-scale" aria-hidden="true"><u /><i style={{ left: `${pos}%` }} /></div>
      <div className="pl2-scale-l" aria-hidden="true"><span>half as often</span><span>average</span><span>2x as often</span></div>
    </>}
    <p className="pl2-rel">{r.detail} {r.rel}.</p>
  </div>
}

type RowProps = { it: PlanItem; acct: Acct; tz: Tz; strip: BrainStrip | null; open: boolean; delay: number; onToggle: () => void; onOpen: (it: PlanItem) => void }

function Row({ it, acct, tz, strip, open, delay, onToggle, onOpen }: RowProps) {
  const id = useId()
  const reason = reasonFor(it, acct)
  const quote = quoteFor(it)
  const trait = traitLine(it, acct)
  const time = timeLabel(it, tz)
  const flags = flagsFor(it, strip, acct)
  const approve = it.st === 'review' && it.draftId ? dHash('content', 'now', { draft: it.draftId, lane: acct }) : null
  return <li className={`pl2-row pl2-s-${it.st}${it.suggested ? ' pl2-sugg' : ''}${open ? ' pl2-open' : ''}`} style={{ '--pl2-d': `${delay}ms` } as CSSProperties} data-plan-key={it.key}>
    <button type="button" className="pl2-row-b" aria-expanded={open} aria-controls={id} data-verb="plan-row" onClick={onToggle}>
      <span className="pl2-meta">
        <span className="pl2-st"><i className="pl2-dot" aria-hidden="true" />{ST_WORD[it.st]}</span>
        {time && <span className="pl2-time">{time}</span>}
      </span>
      <span className="pl2-t">{it.title || 'Untitled post'}</span>
      {(flags.length > 0 || reason) && <span className="pl2-sub">
        {flags.map(f => <FlagChip key={f.key} f={f} />)}
        {reason && <span className="pl2-why1">{reason}</span>}
      </span>}
    </button>
    <div className="pl2-more" id={id} inert={!open}>
      <div><div className="pl2-in">
        {quote && <q className="pl2-q">{quote}</q>}
        {trait && <p className="pl2-trait">{trait}</p>}
        <GuessBlock it={it} acct={acct} />
        <div className="pl2-keys">
          <button type="button" className="cv2-k" data-verb="plan-why" onClick={() => onOpen(it)}>Why, in full</button>
          {approve && <a className="cv2-k cv2-k-p" href={approve} data-verb="plan-approve">Read and approve</a>}
        </div>
      </div></div>
    </div>
  </li>
}

type Group = { day: string | null; items: PlanItem[] }

export function PlanList({ read, items, phone, onOpen }: { read: PlanRead; items: PlanItem[]; phone: boolean; onOpen: (it: PlanItem) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const level = useMotionLevel()
  const entered = useEntered()
  const groups = useMemo(() => {
    const out: Group[] = []
    for (const it of items) {
      const last = out[out.length - 1]
      if (last && last.day === it.day) last.items.push(it)
      else out.push({ day: it.day, items: [it] })
    }
    return out
  }, [items])
  if (!items.length) return <Empty title="Nothing planned for the next two weeks." reason="The planner plans the next two weeks every morning." />
  const acct = read.account as Acct
  const tz = tzOf(read)
  const strip = read.brain_strip ?? null
  const today = read.today
  let n = 0
  return <div className={`pl2-list${phone ? ' pl2-list-phone' : ''}`} data-entered={entered || undefined}>
    {groups.map(g => {
      const late = g.day != null && g.day < today
      const isToday = g.day === today
      const count = `${g.items.length} post${g.items.length > 1 ? 's' : ''}`
      return <section key={g.day ?? 'none'} className="pl2-group" aria-label={g.day ? planDay(g.day) : 'No day yet'}>
        <h3 className={`pl2-day${late ? ' pl2-day-late' : ''}${isToday ? ' pl2-day-today' : ''}`}>
          <b>{g.day == null ? 'No day yet' : late ? `Waiting since ${planDay(g.day)}` : planDay(g.day)}{isToday && <> · <em>Today</em></>}</b>
          <span>{count}</span>
        </h3>
        <ul>
          {g.items.map(it => {
            const delay = level === 'off' ? 0 : Math.min(n++ * STAGGER_MS, STAGGER_CAP_MS)
            return <Row key={it.key} it={it} acct={acct} tz={tz} strip={strip} open={openKey === it.key} delay={delay}
              onToggle={() => setOpenKey(k => (k === it.key ? null : it.key))} onOpen={onOpen} />
          })}
        </ul>
      </section>
    })}
  </div>
}
