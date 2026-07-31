// Candidate B tab bar — same 6-slot register as the real TabBar.tsx, with the
// Settings slot replaced by Studio (glyph ❖). Settings itself hasn't gone
// away: it now lives as the last row inside the Studio hub (see StudioScreen).
// Kept as a local copy rather than editing the shared component (out of this
// candidate's scope) — icon register, sizing and the .tb/.cnt classes are
// reused byte-for-byte from styles.css, nothing new introduced.
export type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'studio' | 'today'

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
      <div className={`tb ${active === 'studio' ? 'on' : ''}`} onClick={() => onNav('studio')}>
        <div className="ic">❖</div>
        <div className="l">Studio</div>
      </div>
    </div>
  )
}
