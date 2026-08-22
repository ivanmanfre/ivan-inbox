import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../lib/chime'

type Theme = 'dark' | 'light'
type Density = 'comfortable' | 'compact'
type Frame = 'a' | 'b' | 'c'

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function currentDensity(): Density {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable'
}

function currentFrame(): Frame {
  const f = document.documentElement.dataset.frame
  return f === 'b' || f === 'c' ? f : 'a'
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
    <button
      type="button"
      className={`sw ${on ? 'on' : ''} ${busy ? 'busy' : ''}`}
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onToggle}
    >
      <span className="sw-knob" />
    </button>
  )
}

export function SettingsScreen() {
  const [push, setPush] = useState<PushState>('off')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushErr, setPushErr] = useState('')
  const [chime, setChime] = useState(chimeEnabled())
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const [density, setDensity] = useState<Density>(currentDensity)
  const [frame, setFrame] = useState<Frame>(currentFrame)

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

  // Comfortable is the un-set state (see main.tsx boot check), so it is
  // written as an explicit attribute value here rather than removed — a
  // removed attribute and an explicit 'comfortable' read identically to every
  // [data-density='compact'] selector, and writing it explicitly keeps the
  // three states (unset / comfortable / compact) collapsed to two on purpose.
  function setDensityAndPersist(next: Density) {
    document.documentElement.dataset.density = next
    localStorage.setItem('inbox-density', next)
    setDensity(next)
  }

  // Frame geometry. Arm A is the shipped state and carries no CSS
  // declarations (wbcal.css §5), so picking it REMOVES the attribute rather
  // than writing 'a' — writing it would be harmless today but would leave a
  // dead selector to keep in step, and removing it also restores
  // faithful.css:157's own 24/8 override below 767px. The arms only reach
  // `.wb`, so this control changes nothing in the stock shell.
  function setFrameAndPersist(next: Frame) {
    if (next === 'a') delete document.documentElement.dataset.frame
    else document.documentElement.dataset.frame = next
    localStorage.setItem('inbox-frame', next)
    setFrame(next)
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
          <div className="grow">
            <div className="gtxt">
              <div className="gt">Density</div>
              <div className="gs">Compact tightens list rows, settings and styles. Comfortable is unchanged.</div>
            </div>
            <div className="seg theme">
              <div className={'sg' + (density === 'comfortable' ? ' on' : '')} onClick={() => setDensityAndPersist('comfortable')}>Comfortable</div>
              <div className={'sg' + (density === 'compact' ? ' on' : '')} onClick={() => setDensityAndPersist('compact')}>Compact</div>
            </div>
          </div>
          <div className="grow">
            <div className="gtxt">
              <div className="gt">Frame</div>
              <div className="gs">How much green border wraps the work area. Wide is the current one.</div>
            </div>
            <div className="seg theme">
              <div className={'sg' + (frame === 'a' ? ' on' : '')} onClick={() => setFrameAndPersist('a')}>Wide</div>
              <div className={'sg' + (frame === 'b' ? ' on' : '')} onClick={() => setFrameAndPersist('b')}>Tight</div>
              <div className={'sg' + (frame === 'c' ? ' on' : '')} onClick={() => setFrameAndPersist('c')}>Flush</div>
            </div>
          </div>
        </div>

        <div className="group">
          <div className="grow tap" onClick={() => supabase.auth.signOut()}>
            <div className="gt danger">Sign out</div>
          </div>
        </div>

        {/* Which build this tab is actually running. A stale service worker looks
            exactly like a fix that did not work, and that cost an hour on 2026-08-20. */}
        <div className="gs" style={{ padding: '10px 22px 24px', opacity: 0.6 }}>
          Build {__BUILD__}
        </div>
      </div>
    </>
  )
}
