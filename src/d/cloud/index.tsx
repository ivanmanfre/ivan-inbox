// The cloud jobs page: `#exp/d/claude/cloud[?job=<root id>]` (the pinned row in Claude's chats and
// every cloud_job push). On the phone it is a full-bleed layer portalled to <body>, like the desk;
// on the desktop it sits in the Claude page.
import { createPortal } from 'react-dom'
import { dHash } from '../route'
import { Cloud } from './Cloud'

export default function CloudPage({ layout, query, navigate }: {
  layout: 'phone' | 'desktop'
  query: URLSearchParams
  navigate: (hash: string) => void
}) {
  const openId = query.get('job')
  const go = (id: string | null) => navigate(dHash('claude', 'cloud', id ? { job: id } : undefined))
  const back = () => {
    if (window.history.length > 1) window.history.back()
    else navigate(dHash('claude'))
  }
  const body = <Cloud layout={layout} openId={openId} onOpen={go} onBack={layout === 'phone' ? back : undefined} />
  if (layout === 'desktop') return body
  const host = <div className="d-app dk-host">{body}</div>
  return typeof document === 'undefined' ? host : createPortal(host, document.body)
}
