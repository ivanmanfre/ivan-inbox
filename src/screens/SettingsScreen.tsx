import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../lib/chime'

type Theme = 'dark' | 'light'

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
}

function Switch({ on, busy, onToggle }: { on: boolean; busy?: boolean; onToggle: () => void }) {
  return (
    <div
      className={`sw ${on ? 'on' : ''} ${busy ? 'busy' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={busy ? undefined : onToggle}
    >
      <div className="sw-knob" />
    </div>
  )
}

export function SettingsScreen() {
  const [push, setPush] = useState<PushState>('off')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushErr, setPushErr] = useState('')
  const [chime, setChime] = useState(chimeEnabled())
  const [theme, setTheme] = useState<Theme>(currentTheme)

  useEffect(() => { getPushState().then(setPush) }, [])

  async function togglePush() {
    setPushBusy(true)
    setPushErr('')
    try {
      if (push === 'on') {
        const ok = await disablePush()
        if (ok) setPush('off')
        else setPushErr('Could not disable on this device.')
      } else {
        const ok = await enablePush().catch(() => false)
        if (ok) setPush('on')
        else {
          setPush(await getPushState())
          setPushErr(
            isIOS() && !isStandalone()
              ? 'On iPhone: install to Home Screen first (Share → Add to Home Screen), then enable here.'
              : 'Not enabled. Check the browser allowed notifications for this site.',
          )
        }
      }
    } finally {
      setPushBusy(false)
    }
  }

  function toggleChime() {
    const next = !chime
    setChimeEnabled(next)
    setChime(next)
    if (next) playChime() // audible confirmation, doubles as a volume check
  }

  function setThemeAndPersist(next: Theme) {
    document.documentElement.dataset.theme = next
    localStorage.setItem('inbox-theme', next)
    setTheme(next)
  }

  const pushHint =
    push === 'unsupported' ? 'This browser does not support web push.'
      : push === 'denied' ? 'Notifications are blocked for this site — allow them in browser settings, then toggle on.'
        : push === 'on' ? 'This device gets a ping when a new reply lands.'
          : isIOS() && !isStandalone()
            ? 'Install to Home Screen first (Share → Add to Home Screen), then enable.'
            : 'Get a ping when a new reply lands. Enable per device.'

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
              <div className="gs">{pushHint}</div>
              {pushErr && <div className="gs" style={{ color: '#FF9F0A' }}>{pushErr}</div>}
            </div>
            {push !== 'unsupported' && push !== 'denied' && (
              <Switch on={push === 'on'} busy={pushBusy} onToggle={togglePush} />
            )}
          </div>
          <div className="grow">
            <div className="gtxt">
              <div className="gt">New-reply sound</div>
              <div className="gs">Chime when a reply lands while the app is open.</div>
            </div>
            <Switch on={chime} onToggle={toggleChime} />
          </div>
          <div className="grow">
            <div className="gtxt">
              <div className="gs">
                Desktop sound for pushes comes from the system: macOS Settings → Notifications →
                your browser → turn on "Play sound for notifications".
              </div>
            </div>
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
