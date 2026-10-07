// Brief 4 thread layout (SPEC-dms §2.4-§2.5): head, the Sum up band, the conversation column (680
// centred; keyed by the person so a thread switch rises and per-thread state resets, NOT the pane),
// then the dock: status lines, one key row with the primary pinned right (it can never clip), the
// composer under it. Every node is built by ThreadPane from its own state and closures.
import type { ReactNode, RefObject } from 'react'

export function ThreadV4({ name, phone, pid, head, sum, conv, scrollRef, dockRef, status, keys, primary, composer, foot, overlays }: {
  name: string; phone: boolean; pid: string; head: ReactNode; sum: ReactNode; conv: ReactNode
  scrollRef: RefObject<HTMLDivElement | null>; dockRef: RefObject<HTMLDivElement | null>
  status: ReactNode; keys: ReactNode; primary: ReactNode; composer: ReactNode; foot: ReactNode; overlays: ReactNode
}) {
  return (
    <section className={`dm-pane dx-pane${phone ? ' dm-pane-phone' : ''}`} aria-label={`Conversation with ${name}`}>
      {head}
      {sum}
      <div className="dm-scroll dx-scroll-t" ref={scrollRef}>
        <div className="dx-conv" key={pid}>{conv}</div>
      </div>
      <div className="dm-dock dx-dock" ref={dockRef}>
        {status}
        <div className="dm-keys dx-keys">
          <div className="dm-keys-s">{keys}</div>
          {primary}
        </div>
        {composer}
        {foot}
      </div>
      {overlays}
    </section>
  )
}
