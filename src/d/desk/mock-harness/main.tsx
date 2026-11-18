// DEV-ONLY harness for the desk's feel checks (OUT/checks/g9_feel_local.mjs). Never built:
// vite builds index.html only. Open /src/d/desk/mock-harness/index.html?deskmock=1.
// Every row it shows is made up (src/d/desk/mock.ts).
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../d.css'

// Static, as the Content page imports it.
import DeskPage from '../index'
import { enableDeskMock } from '../mock'

enableDeskMock()

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
