import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../lib/chime'

type Theme = 'dark' | 'light'
type Density = 'comfortable' | 'compact'
type Frame = 'a' | 'b' | 'c'

// Which shell mounted this screen. `SettingsScreen` is SHARED (inventory.md §1):
// `App.tsx:148` renders it for `#exp/stock` and `Shell.tsx:593` renders the same
// component for the workbench, so anything added here lands in the escape hatch
// too unless it is scoped. Stock is the default because stock is what must not
// move; the workbench is the caller that has to ask.
export type SettingsShell = 'stock' | 'workbench'

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function currentDensity(): Density {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable'
}

// Mirrors the boot read in main.tsx: B is the default since 2026-08-22, so an
// absent attribute is B and only an explicit 'a' is arm A. These two functions
// have to agree or the segmented control lights the wrong cell on first paint.
function currentFrame(): Frame {
  const f = document.documentElement.dataset.frame
  return f === 'a' || f === 'c' ? f : 'b'
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

// Density and Frame both retarget tokens that only ever reach `.wb`
// (wbsys.css:1047, wbcal.css:454-470). In `#exp/stock` there is no `.wb`, so
// both controls were inert there: two rows of chrome that changed nothing and
// pushed Sign out 102px down the escape hatch. They live in their OWN component
// so that stock does not merely hide them — it never runs their state, their
// boot reads or their writers at all. Hooks cannot be called conditionally, so
// gating the JSX alone would have left two live `useState` calls in a shell that
// has nothing to do with either attribute.
function WorkbenchAppearance() {
  const [density, setDensity] = useState<Density>(currentDensity)
  const [frame, setFrame] = useState<Frame>(currentFrame)

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

  // Frame geometry. Arm A used to be the default and was expressed by REMOVING
  // the attribute. Since B became the default (2026-08-22, main.tsx) the
  // attribute is always written: an absent one now means B, so deleting it to
  // mean A would silently select the wrong arm.
  // `[data-frame='a']` is an empty rule in wbcal.css §5, so writing it restores
  // faithful.css:45 exactly, which is what A is.
  function setFrameAndPersist(next: Frame) {
    document.documentElement.dataset.frame = next
    localStorage.setItem('inbox-frame', next)
    setFrame(next)
  }

  return (
    <>
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
          <div className="gs">How much green border wraps the work area. Tight is the current one.</div>
        </div>
        <div className="seg theme">
          <div className={'sg' + (frame === 'a' ? ' on' : '')} onClick={() => setFrameAndPersist('a')}>Wide</div>
          <div className={'sg' + (frame === 'b' ? ' on' : '')} onClick={() => setFrameAndPersist('b')}>Tight</div>
          <div className={'sg' + (frame === 'c' ? ' on' : '')} onClick={() => setFrameAndPersist('c')}>Flush</div>
        </div>
      </div>
    </>
  )
}

export function SettingsScreen({ shell = 'stock' }: { shell?: SettingsShell } = {}) {
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
          {/* Workbench only. Theme above stays shared: it predates this run, it
              writes `inbox-theme`, and BOTH shells read that attribute. */}
          {shell === 'workbench' && <WorkbenchAppearance />}
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
