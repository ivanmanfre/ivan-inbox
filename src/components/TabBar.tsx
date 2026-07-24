type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings'

export function TabBar({ active, draftCount, onNav }: {
  active: Tab; draftCount: number; onNav: (t: Tab) => void
}) {
  return (
    <div className="tabbar">
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
      <div className={`tb ${active === 'settings' ? 'on' : ''}`} onClick={() => onNav('settings')}>
        <div className="ic">⚙︎</div>
        <div className="l">Settings</div>
      </div>
    </div>
  )
}
