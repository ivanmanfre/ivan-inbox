import type { Thread } from '../lib/inbox'

export function ThreadScreen({ thread, onBack }: {
  thread: Thread; onBack: () => void; refresh: () => void
}) {
  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who">
          <div className="n">{thread.prospect_name}</div>
        </div>
      </div>
      <div className="msgs" />
    </>
  )
}
