/* ==========================================================================
   Direction A · Settings (S13).

   Same reads, same writes, same words. What changes is the frame: grouped
   `SectionCard`s of `SettingRow`s, a real `Switch` for the two toggles and a
   real `Segmented` for theme, density and frame, so a control's state is
   carried by the system rather than by a class name (notification-settings-card,
   theme-switcher).
   ========================================================================== */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { disablePush, enablePush, getPushState, type PushState } from '../../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'
import { Avatar, Button, Icon, SectionCard, Segmented, SettingRow, Switch } from '../../ds'
import { Body, Head, Screen } from '../kit'
import './settings.css'

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
      <SettingRow
        label="Density"
        hint="Compact tightens list rows, settings and styles. Comfortable is unchanged."
        control={
          <Segmented
            label="Density"
            markerId="a-set-density"
            value={density}
            onChange={id => setDensityAndPersist(id as Density)}
            options={[
              { id: 'comfortable', label: 'Comfortable' },
              { id: 'compact', label: 'Compact' },
            ]}
          />
        }
      />
      <SettingRow
        label="Frame"
        hint="How much green border wraps the work area. Tight is the current one."
        control={
          <Segmented
            label="Frame"
            markerId="a-set-frame"
            value={frame}
            onChange={id => setFrameAndPersist(id as Frame)}
            options={[
              { id: 'a', label: 'Wide' },
              { id: 'b', label: 'Tight' },
              { id: 'c', label: 'Flush' },
            ]}
          />
        }
      />
    </>
  )
}

// Direct doors into each client's content board plus Ivan's own content
// section. The board tokens are NOT committed — this repo is public, so they
// are read at runtime from client_boards (RLS: authenticated-only, and the
// only account is Ivan's — LoginScreen signs in with shouldCreateUser:false).
function BoardLinks() {
  const [boards, setBoards] = useState<{ slug: string; client_id: string; token: string }[]>([])
  useEffect(() => {
    supabase
      .from('client_boards')
      .select('slug, client_id, token')
      .not('client_id', 'is', null)
      .then(({ data }) => setBoards(data ?? []))
  }, [])

  const clients = [
    { id: 'risedtc', label: 'Mattan — RISE DTC' },
    { id: 'arch', label: 'Davorin — ARCH' },
  ]
  return (
    <SectionCard label="Content boards">
      {clients.map(({ id, label }) => {
        const b = boards.find(x => x.client_id === id)
        return (
          <a
            key={id}
            className="a-set-link"
            data-off={b ? undefined : ''}
            href={b ? `https://ivanmanfredi.com/client/${b.slug}?k=${b.token}` : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span className="a-set-link-m">
              <span className="a-body-t a-ink">{label}</span>
              <span className="a-meta">{b ? 'Client board — queue, drafts, schedule.' : 'Loading…'}</span>
            </span>
            <Icon name="external" size={16} />
          </a>
        )
      })}
      <a
        className="a-set-link"
        href="https://ivanmanfredi.com/dashboard-v2?section=content"
        target="_blank"
        rel="noreferrer"
      >
        <span className="a-set-link-m">
          <span className="a-body-t a-ink">Ivan — my content</span>
          <span className="a-meta">Dashboard content section.</span>
        </span>
        <Icon name="external" size={16} />
      </a>
    </SectionCard>
  )
}

export function Settings({ shell = 'stock' }: { shell?: SettingsShell } = {}) {
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

  // iOS FIRST, above 'unsupported'. Safari outside the installed app has no
  // window.PushManager, so push reads 'unsupported' there and the old ladder told
  // Ivan his browser cannot do this, on the one device where the fix is two taps.
  const pushHint =
    isIOS() && !isStandalone()
      ? 'Add this to your Home Screen first (Share, then Add to Home Screen), then enable.'
      : push === 'unsupported' ? 'This browser does not support web push.'
        : push === 'denied' ? 'Notifications are blocked for this site. Allow them in browser settings, then toggle on.'
          : push === 'on' ? 'This device gets a ping when a new reply lands.'
            : 'Get a ping when a new reply lands. Enable per device.'

  return (
    <Screen>
      <Head title="Settings" tail={<Avatar name="IM" initials="IM" size="sm" />} />

      <Body>
        <SectionCard label="Notifications">
          <SettingRow
            label="Push notifications"
            hint={
              <>
                {pushHint}
                {pushErr && <span className="a-set-err">{pushErr}</span>}
              </>
            }
            control={
              push !== 'unsupported' && push !== 'denied'
                ? (
                  <Switch
                    label="Push notifications"
                    checked={push === 'on'}
                    busy={pushBusy}
                    disabled={pushBusy}
                    onChange={togglePush}
                  />
                )
                : undefined
            }
          />
          <SettingRow
            label="New-reply sound"
            hint="Chime when a reply lands while the app is open."
            control={<Switch label="New-reply sound" checked={chime} onChange={toggleChime} />}
          />
          <p className="a-set-note a-meta">
            Desktop sound for pushes comes from the system: macOS Settings → Notifications →
            your browser → turn on "Play sound for notifications".
          </p>
        </SectionCard>

        <SectionCard label="Appearance">
          <SettingRow
            label="Theme"
            control={
              <Segmented
                label="Theme"
                markerId="a-set-theme"
                value={theme}
                onChange={id => setThemeAndPersist(id as Theme)}
                options={[
                  { id: 'dark', label: 'Dark' },
                  { id: 'light', label: 'Light' },
                ]}
              />
            }
          />
          {/* Workbench only. Theme above stays shared: it predates this run, it
              writes `inbox-theme`, and BOTH shells read that attribute. */}
          {shell === 'workbench' && <WorkbenchAppearance />}
        </SectionCard>

        <BoardLinks />

        <SectionCard>
          {/* The row carries the danger tone; the word itself is said once, on
              the control that does the thing. The label stays in the accessible
              name so the row is still announced. */}
          <SettingRow
            label={<span className="ds-sr">Sign out</span>}
            tone="danger"
            control={
              <Button variant="danger" icon="signOut" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            }
          />
        </SectionCard>

        {/* Which build this tab is actually running. A stale service worker looks
            exactly like a fix that did not work, and that cost an hour on 2026-08-20. */}
        <p className="a-set-build a-mono">Build {__BUILD__}</p>
      </Body>
    </Screen>
  )
}
