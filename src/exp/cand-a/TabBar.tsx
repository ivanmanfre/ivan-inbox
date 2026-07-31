// Candidate A tab bar — same fixed 6-slot flex row and single-glyph register as
// the real TabBar (styles.css:84-91, unchanged, reused as-is), with Settings
// swapped out for the new Content tab (glyph ▤). Settings is reached instead
// via a gear button inside ContentScreen's own header (pushed full-screen).
type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'content' | 'today'

export function TabBar({ active, draftCount, onNav }: {
  active: Tab; draftCount: number; onNav: (t: Tab) => void
}) {
  return (
    <div className="tabbar">
      <div className={`tb ${active === 'today' ? 'on' : ''}`} onClick={() => onNav('today')}>
        <div className="ic">☼</div>
        <div className="l">Today</div>
      </div>
      <div className={`tb ${active === 'inbox' ? 'on' : ''}`} onClick={() => onNav('inbox')}>
        <div className="ic">◉</div>
        <div className="l">Inbox</div>
      </div>
      <div className={`tb ${active === 'drafts' ? 'on' : ''}`} onClick={() => onNav('drafts')}>
        <div className="ic bubble">✦{draftCount > 0 && <span className="cnt">{draftCount}</span>}</div>
        <div className="l">Drafts</div>
      </div>
      <div className={`tb ${active === 'sends' ? 'on' : ''}`} onClick={() => onNav('sends')}>
        <div className="ic">↑</div>
        <div className="l">Sends</div>
      </div>
      <div className={`tb ${active === 'ops' ? 'on' : ''}`} onClick={() => onNav('ops')}>
        <div className="ic">◈</div>
        <div className="l">Ops</div>
      </div>
      <div className={`tb ${active === 'content' ? 'on' : ''}`} onClick={() => onNav('content')}>
        <div className="ic">▤</div>
        <div className="l">Content</div>
      </div>
    </div>
  )
}
