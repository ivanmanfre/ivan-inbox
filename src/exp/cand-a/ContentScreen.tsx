import { useState } from 'react'
import { ContentQueue } from './ContentQueue'
import { ContentStyles } from './ContentStyles'
import { SettingsPush } from './SettingsPush'
import type { ContentLane } from '../../lib/content'

type Segment = 'queue' | 'styles'

// Content as a first-class tab. Large title + segmented [Queue|Styles], same
// idiom as SendsScreen's lane switch. Settings left the tab bar for this
// candidate — its gear button lives in this header and pushes SettingsScreen
// full-screen (state is local: SettingsPush is position:fixed so it covers
// the whole viewport, including the tab bar, no matter how deep it's mounted).
export function ContentScreen() {
  const [seg, setSeg] = useState<Segment>('queue')
  const [lane, setLane] = useState<ContentLane>('ivan')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Content</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="ct-gear" onClick={() => setSettingsOpen(true)} title="Settings">⚙︎</div>
            <div className="avatar-me">IM</div>
          </div>
        </div>
      </div>
      <div className="seg">
        <div className={`sg ${seg === 'queue' ? 'on' : ''}`} onClick={() => setSeg('queue')}>Queue</div>
        <div className={`sg ${seg === 'styles' ? 'on' : ''}`} onClick={() => setSeg('styles')}>Styles</div>
      </div>
      {seg === 'queue' ? <ContentQueue lane={lane} setLane={setLane} /> : <ContentStyles />}
      {settingsOpen && <SettingsPush onBack={() => setSettingsOpen(false)} />}
    </>
  )
}
