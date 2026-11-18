// The desk's page: `#exp/d/content/desk` (the Content tab's Desk key, the pinned
// Content row in Claude's chats, and every proactive push link). On the phone it is
// a full-bleed layer over the frame, portalled to <body> so no transformed ancestor
// can pin it; on the desktop it sits in the Content page.
//
// The page opens only while desk_config.desk_enabled is on (the eval's localStorage
// switch and the dev mock aside); otherwise it says plainly that the desk is off.
import { createPortal } from 'react-dom'
import { dHash } from '../route'
import { Desk } from './Desk'
import { useDeskFlags } from './flags'
import { mockOn } from './mock'

function evalOn(): boolean {
  try { return localStorage.getItem('desk-eval') === '1' } catch { return false }
}

export default function DeskPage({ layout, navigate }: { layout: 'phone' | 'desktop'; navigate?: (hash: string) => void }) {
  const flags = useDeskFlags()
  const back = () => {
    if (window.history.length > 1) window.history.back()
    else if (navigate) navigate(dHash('content', 'plan'))
    else window.location.hash = dHash('content', 'plan')
  }
  const open = flags.desk_enabled || mockOn() || evalOn()
  const body = open
    ? <Desk layout={layout} onBack={layout === 'phone' ? back : undefined} />
    : (
      <section className={`dk dk-${layout} dk-off`} data-desk-off aria-label="Content desk">
        <header className="dk-head">
          {layout === 'phone' && <button type="button" className="dk-back" aria-label="Back" onClick={back}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>}
          <div className="dk-title"><b>Content desk</b></div>
        </header>
        <div className="dk-empty" role="status">{flags.read ? 'The Content Desk is off.' : 'Checking the desk'}</div>
      </section>
    )
  if (layout === 'desktop') return body
  // Its own plain `.d-app` host on <body>: the frame's tokens and fonts (d.css) without any of the frame's
  // layout, and no transformed ancestor can pin a fixed layer that lives there.
  const host = <div className="d-app dk-host">{body}</div>
  return typeof document === 'undefined' ? host : createPortal(host, document.body)
}
