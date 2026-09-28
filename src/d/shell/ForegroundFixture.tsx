// This entry is served only by foreground-fixture.html, never imported by App.
import { renderInFrame } from '../test-utils'
import { ForegroundAlerts } from './ForegroundAlerts'
import { useFrame } from './frame'
import { useFrameCounts } from '../counts/useFrameCounts'
import { parseDHash } from '../route'
import '../d.css'
import './frame2.css'

document.body.style.margin = '0'
document.body.style.background = '#090909'
document.body.style.minHeight = '100vh'
const layout = innerWidth >= 1000 ? 'desktop' : 'phone'
function Alert() {
  const frame = useFrame()
  const counts = useFrameCounts()
  return <ForegroundAlerts host={{
    bellOpen: frame.bellOpen,
    openBell: () => { document.body.dataset.bell = 'open'; frame.setBellOpen(true) },
    navigate: hash => { location.hash = hash },
    refreshBell: () => counts.refresh('bell'),
  }} />
}
renderInFrame(
  <>
    <div style={{ padding: 24, color: 'var(--t1)' }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Inbox</h1>
      <label htmlFor="fixture-input">Reply</label>
      <input id="fixture-input" style={{ display: 'block', padding: 10, marginTop: 8 }} />
    </div>
    <Alert />
  </>,
  { layout },
)

Object.assign(window, {
  foregroundPush(id: string, family = 'system_infra_alarm') {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
      data: { type: 'push', notificationId: id, family, url: './#exp/d/ops' },
    }))
  },
  foregroundRoute(hash: string) { return parseDHash(hash).place },
})
