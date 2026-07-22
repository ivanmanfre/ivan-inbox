import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { enablePush } from '../lib/push'

type PushState = 'idle' | 'working' | 'enabled' | 'failed'
type Theme = 'dark' | 'light'

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function SettingsScreen() {
  const [push, setPush] = useState<PushState>('idle')
  const [theme, setTheme] = useState<Theme>(currentTheme)

  async function onEnablePush() {
    setPush('working')
    const ok = await enablePush().catch(() => false)
    setPush(ok ? 'enabled' : 'failed')
  }

  function setThemeAndPersist(next: Theme) {
    document.documentElement.dataset.theme = next
    localStorage.setItem('inbox-theme', next)
    setTheme(next)
  }

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Settings</h2>
          <div className="avatar-me">IM</div>
        </div>
      </div>

      <div className="rows settings">
        <div className="grouphdr">Notifications</div>
        <div className="group">
          <div className="grow">
            <div className="gtxt">
              <div className="gt">Push notifications</div>
              <div className="gs">
                {push === 'enabled'
                  ? 'Push is on for this device.'
                  : push === 'failed'
                    ? 'Push not available. On iPhone, install to Home Screen first, then enable.'
                    : 'Get a ping when a new reply lands.'}
              </div>
            </div>
            {push === 'enabled' ? (
              <span className="gstate on">On</span>
            ) : (
              <button className="gbtn" disabled={push === 'working'} onClick={onEnablePush}>
                {push === 'working' ? 'Enabling…' : push === 'failed' ? 'Retry' : 'Enable'}
              </button>
            )}
          </div>
        </div>

        <div className="grouphdr">Appearance</div>
        <div className="group">
          <div className="grow">
            <div className="gtxt">
              <div className="gt">Theme</div>
            </div>
            <div className="seg theme">
              <div className={'sg' + (theme === 'dark' ? ' on' : '')} onClick={() => setThemeAndPersist('dark')}>Dark</div>
              <div className={'sg' + (theme === 'light' ? ' on' : '')} onClick={() => setThemeAndPersist('light')}>Light</div>
            </div>
          </div>
        </div>

        <div className="group">
          <div className="grow tap" onClick={() => supabase.auth.signOut()}>
            <div className="gt danger">Sign out</div>
          </div>
        </div>
      </div>
    </>
  )
}
