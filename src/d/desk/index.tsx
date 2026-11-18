// The desk's page: `#exp/d/content/desk` (the Content tab's Desk key, the pinned
// Content row in Claude's chats, and every proactive push link). On the phone it is
// a full-bleed layer over the frame, portalled to <body> so no transformed ancestor
// can pin it; on the desktop it sits in the Content page.
import { createPortal } from 'react-dom'
import { dHash } from '../route'
import { Desk } from './Desk'

export default function DeskPage({ layout, navigate }: { layout: 'phone' | 'desktop'; navigate?: (hash: string) => void }) {
  const back = () => {
    if (window.history.length > 1) window.history.back()
    else if (navigate) navigate(dHash('content', 'plan'))
    else window.location.hash = dHash('content', 'plan')
  }
  if (layout === 'desktop') return <Desk layout="desktop" />
  // Its own plain `.d-app` host on <body>: the frame's tokens and fonts (d.css) without any of the frame's
  // layout, and no transformed ancestor can pin a fixed layer that lives there.
  const desk = <div className="d-app dk-host"><Desk layout="phone" onBack={back} /></div>
  return typeof document === 'undefined' ? desk : createPortal(desk, document.body)
}
