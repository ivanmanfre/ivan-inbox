import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dmNumbers, contentNumbers, opsNumbers, seatFailed, useFrameCounts } from '../counts/useFrameCounts'
import { PLACES, PLACE_ORDER } from '../places'
import { dHash } from '../route'
import { ClaudeKeyDot } from '../claude/Island'
import { DIcon } from '../ui/icons'
import { SeatTrio } from '../ui/SeatCounts'
import { useClock } from '../ui/useClock'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { BellButton } from './Bell'
import { useFrame } from './frame'
import { useNavModel } from './navModel'
import { Brand, MeFooter, NavCount, NavLineView, SeatHead } from './Side'
import { Glance } from './Glance'
import type { SeatNumbers } from '../seats'

// The phone frame (D pshell.js): top bar (panel key, place + Warsaw time,
// bell), the dock (five places + the lime Claude key), and the left panel as a
// drawer from the left edge.

export function PhoneTop({ onPanel, setToolsSlot }: { onPanel: () => void; setToolsSlot: (el: HTMLElement | null) => void }) {
  const f = useFrame()
  const now = useClock()
  const { items } = useNavModel()
  const failed = items.find(i => i.id === f.route.place)?.failed ?? 0
  return (
    <header className="d-ptop">
      <button type="button" className="d-mark d-mark-on d-mark-btn" aria-label="Open the panel" onClick={onPanel}>ON</button>
      <div className="d-pl">
        <span>{PLACES[f.route.place].label}{failed > 0 && <em className="d-pl-fail"> · failed</em>}</span>
        <b>{warsawDow(now)} {warsawDm(now)} · {warsawHm(now)} Warsaw</b>
      </div>
      <div className="d-ptools" ref={setToolsSlot} />
      <BellButton />
    </header>
  )
}

export function Dock() {
  const f = useFrame()
  const c = useFrameCounts()
  // Today's bar carried DMs, Content, Ops and Sales numbers; D keeps one per seat (never a total).
  const opsF = { ivan: c.ops.failed, risedtc: c.ops.failed, arch: c.ops.failed }
  const trio: Partial<Record<string, { n: ReturnType<typeof dmNumbers>; failed: ReturnType<typeof seatFailed> }>> = {
    dms: { n: dmNumbers(c, 'needs'), failed: seatFailed(c.dms) },
    ops: { n: opsNumbers(c), failed: opsF },
  }
  const calls = c.calls.value
  return (
    <>
      <div className="d-fade" aria-hidden="true" />
      <nav className="d-dock" aria-label="Places">
        {PLACE_ORDER.filter(id => PLACES[id].dock).map(id => (
          <a key={id} href={dHash(id)} className={`d-dk${f.route.place === id ? ' d-on' : ''}`} aria-current={f.route.place === id ? 'page' : undefined}>
            <b>{PLACES[id].label}</b>
            {id === 'content' && Object.values(contentNumbers(c)).some(n => (n ?? 0) > 0) && <i className="d-content-attention" aria-label="Content needs a tap" />}
            {trio[id] && <SeatTrio numbers={trio[id]!.n} failed={trio[id]!.failed} />}
            {id === 'sales' && (
              <u className="d-trio" aria-label={calls == null ? (c.calls.failed ? 'calls today could not be read' : 'reading calls today') : `${calls} calls today not started`}>
                <i className={calls == null ? (c.calls.failed ? 'd-unk' : 'd-wait') : calls > 0 ? 'd-hot' : ''}>{calls == null ? (c.calls.failed ? '?' : '…') : calls}</i>
              </u>
            )}
          </a>
        ))}
        <button type="button" className={`d-ck${f.claudeOpen ? ' d-on' : ''}`} aria-label={f.claudeOpen ? 'Close Claude' : 'Ask Claude'} aria-pressed={f.claudeOpen}
          onClick={() => f.setClaudeOpen(!f.claudeOpen)}>
          <DIcon name="claude" /><ClaudeKeyDot />
        </button>
      </nav>
    </>
  )
}

export function PhonePanel({ onClose }: { onClose: () => void }) {
  const f = useFrame()
  const { items } = useNavModel()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const go = () => onClose()
  const main = items.filter(i => PLACES[i.id].nav === 'main')
  const settings = items.find(i => i.id === 'settings')
  return (
    <>
      <div className="d-scrim d-scrim-panel" onClick={onClose} aria-hidden="true" />
      <aside className="d-pn" role="dialog" aria-modal="true" aria-label="Places">
        <Brand />
        <SeatHead />
        <nav className="d-nav">
          {main.map(i => (
            <div key={i.id} className="d-navi">
              <a href={dHash(i.id)} onClick={go} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined}>
                <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span><NavCount item={i} />
              </a>
              <NavLineView item={i} />
            </div>
          ))}
        </nav>
        <Glance onGo={go} eager />
        <nav className="d-nav d-low">
          <button type="button" onClick={() => { onClose(); f.setBellOpen(true) }}><DIcon name="bell" /><span>Alerts</span></button>
          <div className="d-navi">
            <a href={dHash('settings')} onClick={go} className={f.route.place === 'settings' ? 'd-on' : undefined}>
              <DIcon name="settings" /><span>Settings</span>
            </a>
            {settings && settings.failed > 0 && <div className="d-navfail">{settings.failed} failed</div>}
          </div>
        </nav>
        <MeFooter />
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Oxygen phone frame (goal run inbox-phone-oxygen-2026-10-09, 02-SPEC §1).
// Drawn when the `shell` skin section is on; skin off keeps PhoneTop + Dock above.
// ---------------------------------------------------------------------------

const WARSAW = 'Europe/Warsaw'
function deviceInWarsaw(): boolean {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone === WARSAW } catch { return true }
}

/** The nav bar: ON key (panel), the title that appears once the large title scrolls under, tools, bell. */
export function PhoneBar({ onPanel, setToolsSlot }: { onPanel: () => void; setToolsSlot: (el: HTMLElement | null) => void }) {
  const f = useFrame()
  return (
    <header className="d-ptop po-bar">
      <button type="button" className="po-key po-on" aria-label="Open the panel" onClick={onPanel}><span className="d-mark d-mark-on d-mark-btn">ON</span></button>
      <div className="po-bar-t" aria-hidden="true">{PLACES[f.route.place].label}</div>
      <div className="d-ptools" ref={setToolsSlot} />
      <BellButton />
    </header>
  )
}

/** The large title (34/700) at the top of every place. Sets :root[data-po-scrolled] once it is under the bar. */
export function LargeTitle() {
  const f = useFrame()
  const now = useClock()
  const { items } = useNavModel()
  const failed = items.find(i => i.id === f.route.place)?.failed ?? 0
  const ref = useRef<HTMLDivElement>(null)
  const [away] = useState(() => !deviceInWarsaw())
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const root = document.documentElement
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) root.removeAttribute('data-po-scrolled'); else root.setAttribute('data-po-scrolled', '')
    }, { rootMargin: '-96px 0px 0px 0px', threshold: 0 })
    io.observe(el)
    return () => { io.disconnect(); root.removeAttribute('data-po-scrolled') }
  }, [f.route.place])
  return (
    <div className="po-lt" ref={ref}>
      <h1>{PLACES[f.route.place].label}</h1>
      {failed > 0 && <em className="po-lt-fail">{failed} failed</em>}
      {away && <span className="po-lt-tz">Warsaw {warsawHm(now)}</span>}
    </div>
  )
}

function total(n: SeatNumbers): number | null {
  const v = Object.values(n)
  if (v.every(x => x == null)) return null
  return v.reduce<number>((a, x) => a + (x ?? 0), 0)
}

/** The tab bar: a glass capsule of six places with one gliding lens, and the round Claude key beside it. */
export function PhoneTabs() {
  const f = useFrame()
  const c = useFrameCounts()
  const nav = useRef<HTMLElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  const ids = PLACE_ORDER.filter(id => PLACES[id].dock)
  const dmsF = Object.values(seatFailed(c.dms)).some(Boolean)
  const dmsN = total(dmNumbers(c, 'needs'))
  const opsN = total(opsNumbers(c))
  const calls = c.calls.value
  const badge: Partial<Record<string, { n: string; tone: 'signal' | 'ink' | 'warn'; label: string }>> = {}
  if (dmsF && dmsN == null) badge.dms = { n: '!', tone: 'warn', label: 'DMs count could not be read' }
  else if (dmsN) badge.dms = { n: dmsN > 99 ? '99+' : String(dmsN), tone: 'signal', label: `${dmsN} waiting on you` }
  if (c.ops.failed && opsN == null) badge.ops = { n: '!', tone: 'warn', label: 'Ops count could not be read' }
  else if (opsN) badge.ops = { n: opsN > 99 ? '99+' : String(opsN), tone: 'ink', label: `${opsN} waiting on you` }
  if (calls == null && c.calls.failed) badge.sales = { n: '!', tone: 'warn', label: 'calls today could not be read' }
  else if (calls) badge.sales = { n: String(calls), tone: 'ink', label: `${calls} calls today not started` }
  const contentDot = Object.values(contentNumbers(c)).some(n => (n ?? 0) > 0)
  const on = f.route.place
  useLayoutEffect(() => {
    const n = nav.current, l = lens.current
    if (!n || !l) return
    const a = n.querySelector<HTMLElement>('.po-tab[aria-current="page"]')
    if (!a) { l.style.opacity = '0'; return }
    const first = l.dataset.placed !== '1'
    if (first) l.style.transition = 'none'
    l.style.opacity = '1'
    l.style.width = `${a.offsetWidth}px`
    l.style.transform = `translateX(${a.offsetLeft}px)`
    if (first) { void l.offsetWidth; l.style.transition = ''; l.dataset.placed = '1' }
  }, [on])
  return (
    <>
      <div className="d-fade po-fade" aria-hidden="true" />
      <div className="po-tabbar">
        <nav className="d-dock po-dock" aria-label="Places" ref={nav}>
          <span className="po-lens" ref={lens} aria-hidden="true" />
          {ids.map(id => {
            const b = badge[id]
            return (
              <a key={id} href={dHash(id)} className={`d-dk po-tab${on === id ? ' d-on' : ''}`} aria-current={on === id ? 'page' : undefined}
                aria-label={b ? `${PLACES[id].label}, ${b.label}` : id === 'content' && contentDot ? `${PLACES[id].label}, needs a tap` : PLACES[id].label}>
                <span className="po-tab-ico"><DIcon name={PLACES[id].icon} />
                  {b && <i className={`po-badge po-badge-${b.tone}`}>{b.n}</i>}
                  {id === 'content' && contentDot && <i className="po-dot d-content-attention" />}
                </span>
                <b>{PLACES[id].label}</b>
              </a>
            )
          })}
        </nav>
        <button type="button" className={`d-ck po-ck${f.claudeOpen ? ' d-on' : ''}`} aria-label={f.claudeOpen ? 'Close Claude' : 'Ask Claude'} aria-pressed={f.claudeOpen}
          onClick={() => f.setClaudeOpen(!f.claudeOpen)}>
          <DIcon name="claude" /><ClaudeKeyDot />
        </button>
      </div>
    </>
  )
}
