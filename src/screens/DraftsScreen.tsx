import type { Thread } from '../lib/inbox'

export function DraftsScreen(_props: {
  threads: Thread[]; onOpenThread: (id: string) => void; refresh: () => void
}) {
  return (
    <div className="nav">
      <div className="row-top">
        <h2>Drafts</h2>
        <div className="avatar-me">IM</div>
      </div>
    </div>
  )
}
