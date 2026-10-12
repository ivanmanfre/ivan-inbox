import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { decideProposal, undoRuleChange, type BrainStrip as Strip, type StripRule } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { useFrameMaybe } from '../../shell/frame'
import { DIcon } from '../../ui/icons'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/toast'
import { RuleAxis, RuleRange, ReadsChart, StockChart, ViewsChart, effectDomain, useWidth } from './charts'
import { useEntered } from './PlanList'
import { changeLine, decisionLine, nextCheckLine, proposalLine, readsSummary, ruleNote, ruleRow, rulesOf, sourceNote, stripNote, undoLine, viewsLine, viralLine, type Acct } from './planBrain'

// THE BRAIN STRIP (spec 2026-10-12 R3.1, R3.2, R4; mock v3; prototypes final-review/viz). Four tiles under the
// warnings: what moves views (every rule as a dot and its range), the next brain check (what is under watch, changes
// that wait for Ivan with Accept / Dismiss, recent changes with Undo), the brain's guesses for the next two weeks, and
// views per post over 12 weeks. Read only except Accept / Dismiss / Undo, which go through the operator-gated wrappers
// of db/264 and then ask the page to read the plan again. On the phone the tiles are one horizontal row (CSS).
// Hooks in every component run before any return (an early return after a hook blanked the app once).

const STAGGER_MS = 30
const STAGGER_CAP_MS = 400
const RULE_CHART_W = 116

const REFUSED: Record<string, string> = {
  not_open: 'That change is no longer waiting. Nothing changed.',
  unknown_token: 'This change can no longer be undone. Nothing changed.',
  bad_gate: 'The app could not confirm it is you. Nothing changed.',
}
const refusal = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && REFUSED[code] ? REFUSED[code] : 'Could not do that. Nothing changed.'
}

function Tile({ cls, title, n, i, still, children }: { cls: string; title: string; n?: string; i: number; still: boolean; children: ReactNode }) {
  return <section className={`pl2-tile ${cls}`} style={{ '--pl2-d': `${still ? 0 : Math.min(i * STAGGER_MS, STAGGER_CAP_MS)}ms` } as CSSProperties}>
    <header className="pl2-tile-h"><h3>{title}</h3>{n ? <span className="pl2-tile-n">{n}</span> : null}</header>
    {children}
  </section>
}

// ---- tile 1: what moves views ----

function RuleRow({ r, dom }: { r: StripRule; dom: { lo: number; hi: number } }) {
  const row = ruleRow(r)
  const note = ruleNote(r)
  return <li className="pl2-rr-i" data-live={r.status === 'live' ? 'true' : 'false'}>
    <div className="pl2-rr-t">
      <b>{row.name}</b>{' '}<span className={`pl2-rr-e pl2-rr-${row.tone}`}>{row.effect}</span>
      {note && <span className="pl2-rr-n">{note}</span>}
    </div>
    <div className="pl2-rr-c" style={{ '--pl2-z': (Math.max(0, Math.min(1, (0 - dom.lo) / (dom.hi - dom.lo)))).toFixed(4) } as CSSProperties}>
      <RuleRange rule={r} dom={dom} w={RULE_CHART_W} />
    </div>
  </li>
}

function RulesTile({ strip, i, still }: { strip: Strip; i: number; still: boolean }) {
  const { live, testing } = rulesOf(strip)
  const dom = effectDomain([...live, ...testing])
  return <Tile cls="pl2-t-rules" title="What moves views" i={i} still={still}>
    <div className="pl2-rr-g">
      <p className="pl2-rr-cap"><i className="pl2-key pl2-key-live" aria-hidden="true" />Rules we follow</p>
      {live.length ? <ul className="pl2-rr">{live.map(r => <RuleRow key={r.rule_id} r={r} dom={dom} />)}</ul> : <p className="pl2-none">None proven yet</p>}
    </div>
    {testing.length > 0 && <div className="pl2-rr-g">
      <p className="pl2-rr-cap"><i className="pl2-key pl2-key-test" aria-hidden="true" />Testing, not used yet</p>
      <ul className="pl2-rr">{testing.map(r => <RuleRow key={r.rule_id} r={r} dom={dom} />)}</ul>
    </div>}
    {(live.length + testing.length) > 0 && <div className="pl2-rr-ax"><div style={{ width: RULE_CHART_W }}><RuleAxis dom={dom} w={RULE_CHART_W} /></div></div>}
  </Tile>
}

// ---- tile 2: the next brain check ----

type Proposal = Strip['next_check']['proposals'][number]
type Change = Strip['next_check']['recent'][number]

function NextTile({ strip, i, still, busy, onDecide, onUndo, onIdeaStock }: {
  strip: Strip; i: number; still: boolean; busy: boolean
  onDecide: (p: Proposal, accept: boolean) => void; onUndo: (c: Change) => void; onIdeaStock?: () => void
}) {
  const proposals = (Array.isArray(strip.next_check?.proposals) ? strip.next_check.proposals : []).filter(p => p && !String(p.rule_id ?? '').startsWith('zz-'))
  const recent = (Array.isArray(strip.next_check?.recent) ? strip.next_check.recent : []).filter(c => c && changeLine(c))
  return <Tile cls="pl2-t-next" title="Next brain check" i={i} still={still}>
    <p className="pl2-big">{nextCheckLine(strip) || 'No check day is set yet.'}</p>
    {proposals.length > 0 && <div className="pl2-nx-g">
      <p className="pl2-rr-cap">Waiting for your say</p>
      <ul className="pl2-nx">{proposals.map(p => <li key={p.id}>
        <span>{proposalLine(p)}</span>
        <span className="pl2-nx-k">
          <button type="button" className="cv2-k cv2-k-p" data-verb="brain-accept" disabled={busy} onClick={() => onDecide(p, true)}>Accept</button>
          <button type="button" className="cv2-k" data-verb="brain-dismiss" disabled={busy} onClick={() => onDecide(p, false)}>Dismiss</button>
        </span>
      </li>)}</ul>
    </div>}
    {recent.length > 0 && <div className="pl2-nx-g">
      <p className="pl2-rr-cap">Changed lately</p>
      <ul className="pl2-nx">{recent.map(c => <li key={`${c.rule_id}:${c.at}`}>
        <span>{changeLine(c)}</span>
        {c.undo_token && <button type="button" className="cv2-k" data-verb="brain-undo" disabled={busy} onClick={() => onUndo(c)}>Undo</button>}
      </li>)}</ul>
    </div>}
    {onIdeaStock && <button type="button" className="pl2-link" data-verb="plan-stock-open" data-stock-trigger onClick={onIdeaStock}>Ideas in stock</button>}
  </Tile>
}

// ---- tile 3: the brain's guesses ----

function ReadsTile({ strip, acct, i, still }: { strip: Strip; acct: Acct; i: number; still: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(236)
  const items = Array.isArray(strip.reads?.items) ? strip.reads.items : []
  const total = Number.isFinite(strip.reads?.total) ? strip.reads.total : items.length
  const summary = readsSummary(strip, acct)
  return <Tile cls="pl2-t-reads" title="Brain guesses, next 2 weeks" n={items.length ? `${items.length} of ${Math.max(total, items.length)} read` : undefined} i={i} still={still}>
    <div ref={ref} className="pl2-chw">
      {items.length ? <ReadsChart items={items} w={w} /> : <p className="pl2-none">No brain guesses yet</p>}
    </div>
    {summary && <p className="pl2-foot">{summary}</p>}
  </Tile>
}

// ---- tile 4: views per post ----

function ViewsTile({ strip, today, i, still }: { strip: Strip; today?: string; i: number; still: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(236)
  const v = strip.views
  const posts = Array.isArray(v?.posts) ? v.posts : []
  const foot = viewsLine(strip)
  return <Tile cls="pl2-t-views" title="Views per post, 12 weeks" n={viralLine(strip) || undefined} i={i} still={still}>
    <div ref={ref} className="pl2-chw">
      {posts.length ? <ViewsChart posts={posts} median={v?.median ?? null} today={today} w={w} /> : <p className="pl2-none">Not enough posts yet</p>}
    </div>
    {foot && <p className="pl2-foot">{foot}</p>}
  </Tile>
}

// ---- the strip ----

type Props = {
  strip: Strip | null | undefined; acct: Acct
  /** The plan's own "today" (the 12 week chart ends there); the newest post's day when absent. */
  today?: string
  /** Opens the idea stock popover. The strip offers it for a client seat that has an empty topic. */
  onIdeaStock?: () => void
  /** Asked after a rule change went through, so the page reads the plan again. */
  onChanged?: () => void
}

export function BrainStrip({ strip, acct, today, onIdeaStock, onChanged }: Props) {
  const toast = useToast()
  const level = useMotionLevel()
  const entered = useEntered()
  const [busy, setBusy] = useState(false)
  if (!strip) return null
  const still = level === 'off'

  const stock = Array.isArray(strip.idea_stock) ? strip.idea_stock : []
  const offerStock = acct !== 'ivan' && stock.some(s => s && s.stock <= 0)
  const note = stripNote(strip)
  const src = sourceNote(strip)

  const act = async (f: () => Promise<string>) => {
    setBusy(true)
    try {
      toast.show({ message: await f() })
      onChanged?.()
    } catch (e) {
      toast.show({ message: refusal(e), tone: 'failed' })
    } finally {
      setBusy(false)
    }
  }
  const onDecide = (p: Proposal, accept: boolean) => { void act(async () => { await decideProposal(p.id, accept); return decisionLine(p, accept) }) }
  const onUndo = (c: Change) => { if (c.undo_token) void act(async () => { await undoRuleChange(c.undo_token!); return undoLine(c) }) }

  return <div className="pl2-stripw">
    <div className="pl2-strip" role="region" aria-label="What the brain has learned" tabIndex={0} data-motion={level} data-entered={entered || undefined}>
      <RulesTile strip={strip} i={0} still={still} />
      <NextTile strip={strip} i={1} still={still} busy={busy} onDecide={onDecide} onUndo={onUndo} onIdeaStock={offerStock ? onIdeaStock : undefined} />
      <ReadsTile strip={strip} acct={acct} i={2} still={still} />
      <ViewsTile strip={strip} today={today} i={3} still={still} />
    </div>
    {src && <p className="pl2-strip-src">{src}</p>}
    {note && <p className="pl2-strip-note">{note}</p>}
  </div>
}

// ---- the idea stock popover (the "Out of ideas" warning chips open it) ----

/**
 * Ideas in stock against ideas used in 8 weeks, per topic. A popover under the warnings on the desktop, a bottom
 * sheet on the phone. Escape closes it; so does a click outside it (the chip that opened it toggles it itself).
 */
export function IdeaStockPopover({ strip, onClose }: { strip: Strip | null | undefined; onClose: () => void }) {
  const f = useFrameMaybe()
  const phone = f?.layout === 'phone'
  const box = useRef<HTMLDivElement>(null)
  const [ref, w] = useWidth<HTMLDivElement>(300)
  useEffect(() => {
    if (phone) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const out = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (box.current && t && !box.current.contains(t) && !t.closest('[data-stock-trigger]')) onClose()
    }
    window.addEventListener('keydown', key)
    document.addEventListener('pointerdown', out)
    box.current?.focus()
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', out) }
  }, [phone, onClose])
  const items = Array.isArray(strip?.idea_stock) ? strip!.idea_stock : []
  const body = <div className="pl2-stock">
    <div ref={ref} className="pl2-chw">
      {items.length ? <StockChart items={items} w={w} /> : <p className="pl2-none">No idea stock to show yet.</p>}
    </div>
    {items.length > 0 && <p className="pl2-foot">Bar = ideas in stock. Grey tick = ideas used in the last 8 weeks.</p>}
  </div>
  if (phone) return <Sheet open onClose={onClose} title="Ideas in stock" className="pl2-pn pl2-stock-sheet">{body}</Sheet>
  return <div ref={box} className="pl2-pop" role="dialog" aria-label="Ideas in stock" tabIndex={-1}>
    <div className="pl2-pop-h"><b>Ideas in stock</b><button type="button" className="d-ib" aria-label="Close" onClick={onClose}><DIcon name="x" /></button></div>
    {body}
  </div>
}
