import { useEffect } from 'react'
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
import { Brand, MeFooter, NavCount, NavLineView, SeatHead, WorkflowsKey } from './Side'

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
      <button type="button" className="d-mark" aria-label="Open the panel" onClick={onPanel}>IM</button>
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
        <nav className="d-nav d-low">
          <button type="button" onClick={() => { onClose(); f.setBellOpen(true) }}><DIcon name="bell" /><span>Alerts</span></button>
          <WorkflowsKey onOpen={onClose} />
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
