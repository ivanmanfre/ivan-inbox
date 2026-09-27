import { useEffect } from 'react'
import { dmNumbers, contentNumbers, seatFailed, useFrameCounts } from '../counts/useFrameCounts'
import { PLACES, PLACE_ORDER } from '../places'
import { dHash } from '../route'
import { DIcon } from '../ui/icons'
import { SeatTrio } from '../ui/SeatCounts'
import { useClock } from '../ui/useClock'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { BellButton } from './Bell'
import { useFrame } from './frame'
import { useNavModel } from './navModel'
import { Brand, MeFooter, NavLineView } from './Side'

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
  const trio = { dms: { n: dmNumbers(c, 'drafts'), failed: seatFailed(c.dms) }, content: { n: contentNumbers(c), failed: seatFailed(c.content) } }
  return (
    <>
      <div className="d-fade" aria-hidden="true" />
      <nav className="d-dock" aria-label="Places">
        {PLACE_ORDER.filter(id => PLACES[id].dock).map(id => (
          <a key={id} href={dHash(id)} className={`d-dk${f.route.place === id ? ' d-on' : ''}`} aria-current={f.route.place === id ? 'page' : undefined}>
            <b>{PLACES[id].label}</b>
            {(id === 'dms' || id === 'content') && <SeatTrio numbers={trio[id].n} failed={trio[id].failed} />}
          </a>
        ))}
        <button type="button" className={`d-ck${f.claudeOpen ? ' d-on' : ''}`} aria-label={f.claudeOpen ? 'Close Claude' : 'Ask Claude'} aria-pressed={f.claudeOpen}
          onClick={() => f.setClaudeOpen(!f.claudeOpen)}>
          <DIcon name="claude" />
        </button>
      </nav>
    </>
  )
}

export function PhonePanel({ onClose }: { onClose: () => void }) {
  const f = useFrame()
  const { items, synced } = useNavModel()
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
        <nav className="d-nav">
          {main.map(i => (
            <div key={i.id} className="d-navi">
              <a href={dHash(i.id)} onClick={go} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined}>
                <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span>
              </a>
              <NavLineView item={i} />
            </div>
          ))}
        </nav>
        <nav className="d-nav d-low">
          <button type="button" onClick={() => { onClose(); f.setBellOpen(true) }}><DIcon name="bell" /><span>Alerts</span></button>
          <button type="button" onClick={() => { onClose(); f.setBellOpen(true) }}><DIcon name="workflows" /><span>Workflows</span></button>
          <div className="d-navi">
            <a href={dHash('settings')} onClick={go} className={f.route.place === 'settings' ? 'd-on' : undefined}>
              <DIcon name="settings" /><span>Settings</span><em>Money is in here</em>
            </a>
            {settings && settings.failed > 0 && <div className="d-navfail">{settings.failed} failed</div>}
          </div>
        </nav>
        <MeFooter synced={synced} />
      </aside>
    </>
  )
}
