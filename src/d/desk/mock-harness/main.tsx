// DEV-ONLY harness for the desk's feel checks (OUT/checks/g9_feel_local.mjs). Never built:
// vite builds index.html only. Open /src/d/desk/mock-harness/index.html?deskmock=1.
// Every row it shows is made up (src/d/desk/mock.ts).
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../ds/ds.css'
import '../../d.css'

// Static, as the Content page imports it.
import DeskPage from '../index'
import { enableDeskMock, seedDeskMock } from '../mock'

enableDeskMock()
// The app's own skin, so the harness looks like the phone (brief skin, light).
const root = document.documentElement
root.dataset.frame = 'b'
root.dataset.skin = 'brief'
root.dataset.skinOn = 'tokens type motion shell content claude'
if (new URLSearchParams(location.search).get('dark') === '1') root.dataset.theme = 'dark'
if (new URLSearchParams(location.search).get('empty') === '1') seedDeskMock([], [], true)
// `?rich=1`: every card the desk can draw, all made up.
if (new URLSearchParams(location.search).get('rich') === '1') {
  const now = Date.now()
  const t = (min: number) => new Date(now - min * 60_000).toISOString()
  seedDeskMock([
    { id: 'x-1', role: 'user', origin: 'operator', body: 'give me the full plan for the week and what is weak', status: 'done', meta: {}, client_key: 'x1', created_at: t(50) },
    { id: 'x-2', role: 'assistant', origin: 'desk', status: 'done', client_key: null, created_at: t(49), meta: {},
      body: 'Here is the week.\n\n**Monday** the trains post went out at 09:30 and is doing fine.\n\n**Tuesday** is the quiet Monday post. It is the weakest of the week: the first line asks a question nobody is asking.\n\n**Thursday** is open. The best fit is a buyer post from the last call.\n\n- Keep Monday as it is.\n- Rewrite the Tuesday first line.\n- Fill Thursday from the call.\n\nThe rest of the month looks full, with two copies on Saturday and Sunday that can stay where they are.' },
    { id: 'x-3', role: 'user', origin: 'operator', body: 'move the quiet monday one to thursday', status: 'done', meta: {}, client_key: 'x3', created_at: t(8) },
    { id: 'x-4', role: 'assistant', origin: 'desk', status: 'done', client_key: null, created_at: t(7), body: 'Ready to move it. Tap Do it now and I will put it on Thursday at 09:30.',
      meta: { actions: [{ id: 'act-x4', kind: 'schedule', label: 'Move #d3e4f to Thu 26 Nov 09:30', state: 'held', undo: true, target: { kind: 'draft', handle: '#d3e4f', first_line: 'A made up post about a quiet Monday.' } }] } },
    { id: 'x-5', role: 'user', origin: 'operator', body: 'research what people say about cold DMs this month', status: 'done', meta: {}, client_key: 'x5', created_at: t(4) },
    { id: 'x-6', role: 'assistant', origin: 'desk', status: 'done', client_key: null, created_at: t(3), body: 'That needs real work, so I opened a T3 thread for it. The result comes back here.',
      meta: { t3_job: { id: 'job-x6', status: 'running', title: 'Made up research job' } } },
    { id: 'x-7', role: 'user', origin: 'operator', body: 'which one is the poland post', status: 'done', meta: {}, client_key: 'x7', created_at: t(2) },
    { id: 'x-8', role: 'assistant', origin: 'desk', status: 'done', client_key: null, created_at: t(1), body: 'Two drafts match. Tap the one you mean.',
      meta: { drafts: [
        { handle: '#a1b2c', first_line: 'A made up post about trains in the rain.', status: 'scheduled', scheduled_at: new Date(now + 2 * 86400000).toISOString() },
        { handle: '#d3e4f', first_line: 'A made up post about a quiet Monday that runs long enough to wrap onto a second line.', status: 'review', scheduled_at: null },
      ], chips: [{ send: 'move #a1b2c to thursday' }, { send: 'move #d3e4f to thursday' }] } },
  ], [{ id: 'job-x6', status: 'running', title: 'Made up research job', t3_link: 'https://example.com/t3/thread', result_summary: null }])
}

function Harness() {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('open') === '1')
  return (
    <div className="d-app" style={{ minHeight: '100dvh' }}>
      {!open && <button type="button" data-open-desk style={{ margin: 24, minHeight: 44, padding: '0 16px', color: 'inherit', background: 'var(--p2)', border: '1px solid var(--line2)', borderRadius: 22 }}
        onClick={() => { (window as unknown as { __deskClick: number }).__deskClick = performance.now(); setOpen(true) }}>Open desk</button>}
      {open && <DeskPage layout={innerWidth < 760 ? 'phone' : 'desktop'} navigate={() => setOpen(false)} />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
