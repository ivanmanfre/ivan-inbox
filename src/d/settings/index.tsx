/* ==========================================================================
   src/d/settings — Settings, direction D. Two columns of plates with hardware
   keys (desktop), one column (phone). Dark is the only theme. Money moved here
   from the rail: a read-only plate, and "Open Money" mounts today's Money view
   inside D's frame at #exp/d/settings/money.
   Lime only on live state (judge): a saved preference is the pressed neutral key.
   ========================================================================== */
import { lazy, Suspense, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { AnswerRow, N } from '../ui/AnswerRow'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { Failed, Skeleton } from '../ui/states'
import { useRead, useRetryRead } from '../lanes/useRead'
import { warsawDm } from '../ui/time'
import { useDensity, useNativeMotion, usePush, useSound, useStoredTheme } from './prefs'
import { isBriefNative } from '../../ds/skin'
import { fetchBoards, fetchDevices, fetchMoneyPlate } from './reads'
import { MoneyCells, Pair } from './parts'
import { useSkin } from '../../ds/useSkin'
import { setSkinHere, skinOnHere, storedSkinOff } from './skinSwitch'
import { Group, Row4, SettingsV4 } from './v4/SettingsV4'
import './v4/settings-v4.css'
import './settings.css'
import './phone-ox.css'

const MoneyView = lazy(() => import('../../wb/money').then(m => ({ default: m.MoneyView })))

function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return <div className="ds2-row"><div className="ds2-t"><b>{title}</b>{sub != null && <small>{sub}</small>}</div>{children}</div>
}
function Plate({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="ds2-plate"><h3>{title}{note && <span>{note}</span>}</h3>{children}</section>
}

function SettingsHome({ layout, navigate }: PlaceProps) {
  const push = usePush()
  const [sound, setSound] = useSound()
  const [density, setDensity] = useDensity()
  const nativeMotion = useNativeMotion()
  const [theme, resetTheme] = useStoredTheme()
  const brief = isBriefNative()
  const confirm = useDConfirm()
  const [devices, retryDevices] = useRetryRead(fetchDevices, 'devices')
  const boards = useRead(fetchBoards, 'boards')
  const [money, retryMoney] = useRetryRead(fetchMoneyPlate, 'money')
  // Brief 4 (`settings` section); plain values below, never a hook inside a branch (H17).
  const v4 = useSkin('settings')

  // The device by its user agent, never by the window width: a narrow Mac window is still a Mac.
  const here = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'iPhone' : /Macintosh/.test(navigator.userAgent) ? 'Mac' : 'device'
  const devs = devices.kind === 'ready' ? devices.data : null
  const title = devs ? <>Pushes reach <N v={devs.length} /> {devs.length === 1 ? 'device' : 'devices'}.</> : <>Pushes reach <N v={null} /> devices.</>
  // One headline; a second line only when the device list could not be read.
  const sub = devices.kind === 'failed' ? 'The device list could not be read.' : undefined
  // Said only when something is off: blocked (with the fix) or unreadable.
  const pushSub = push.blocked ?? (push.state === 'unknown' ? `Could not read whether push is on for this ${here}.` : null)
  const board = (id: string) => (boards.kind === 'ready' ? boards.data.find(b => b.client_id === id) : undefined)
  const signOut = async () => {
    if (await confirm({ title: 'Sign out?', message: 'This signs the app out on this device. You sign back in with the 6-digit code or the email link.', confirmText: 'Sign out' })) void supabase.auth.signOut()
  }

  const notif = (
    <Plate title="Notifications">
      <Row title={`Push on this ${here}`} sub={pushSub || push.error ? <>{pushSub}{push.error && <span className="ds2-err"> {push.error}</span>}</> : undefined}>
        <Pair name="Push" value={push.state === 'on' ? 'on' : push.state === 'off' || push.state === 'denied' ? 'off' : null} disabled={Boolean(push.blocked) || push.busy}
          options={[{ id: 'on', label: 'On', verb: 'push-on' }, { id: 'off', label: 'Off', verb: 'push-off' }]} onPick={v => push.set(v === 'on')} />
      </Row>
      {devices.kind === 'loading' && <Skeleton lines={3} title={false} label="Reading devices" />}
      {devices.kind === 'failed' && <Failed what="the device list" detail={devices.message} onRetry={retryDevices} />}
      {devs && <ol className="ds2-devs">{devs.map((x, i) => <li key={`${x.created_at}-${i}`}><i>{i + 1}</i><span>{x.device} <small>· {x.browser}</small></span><em>since {warsawDm(x.created_at)}</em></li>)}</ol>}
      <Row title="New-reply sound">
        <Pair name="New-reply sound" value={sound ? 'on' : 'off'} options={[{ id: 'on', label: 'On', verb: 'sound-on' }, { id: 'off', label: 'Off', verb: 'sound-off' }]} onPick={v => setSound(v === 'on')} />
      </Row>
    </Plate>
  )
  const look = (
    <Plate title="Appearance">
      {/* Dark is the only theme: the row only shows when this device still stores Light from the old app.
          Never in Daily Brief: Brief is light-only, and resetting there would flip it dark. */}
      {theme === 'light' && !brief && (
        <Row title="Theme" sub="This device still stores Light from the old app, which turns the Money and legacy panels light.">
          <Key size="small" verb="theme-reset" onClick={resetTheme}>Reset to dark</Key>
        </Row>
      )}
      <Row title="Density">
        <Pair name="Density" value={density} options={[{ id: 'comfortable', label: 'Comfortable', verb: 'density-comfortable' }, { id: 'compact', label: 'Compact', verb: 'density-compact' }]} onPick={setDensity} />
      </Row>
      {/* Only on a device where the Brief 4 switch stored Off: the way back on. */}
      {storedSkinOff() && (
        <Row title="Brief 4 layouts" sub="Off on this device.">
          <Key size="small" verb="skin-on" onClick={() => setSkinHere(true)}>Turn back on</Key>
        </Row>
      )}
    </Plate>
  )
  const link = (id: string) => { const b = board(id); return b ? `https://ivanmanfredi.com/client/${b.slug}?k=${encodeURIComponent(b.token)}` : undefined }
  const boardsPlate = (
    <Plate title="Client boards">
      {([['risedtc', 'Rise', "Mattan's board: queue, drafts, schedule"], ['arch', 'Arch', "Davorin's board: queue, drafts, schedule"]] as const).map(([id, name, sub]) => (
        <Row key={id} title={<span title={sub}>{name}</span>} sub={boards.kind === 'failed' ? 'could not be read' : boards.kind === 'ready' && !board(id) ? 'board not found' : undefined}>
          <a className={`ds2-open${link(id) ? '' : ' ds2-off'}`} href={link(id)} target="_blank" rel="noreferrer" aria-disabled={!link(id)} title={board(id) ? `ivanmanfredi.com/client/${board(id)!.slug}` : undefined}>Open ↗</a>
        </Row>
      ))}
      <Row title={<span title="Your own content, on the dashboard">Ivan</span>}>
        <a className="ds2-open" title="ivanmanfredi.com/dashboard-v2?section=content" href="https://ivanmanfredi.com/dashboard-v2?section=content" target="_blank" rel="noreferrer">Open ↗</a>
      </Row>
    </Plate>
  )
  const moneyPlate = (
    <Plate title="Money">
      {money.kind === 'loading' ? <Skeleton lines={2} title={false} label="Reading money" /> : money.kind === 'failed' ? <Failed what="the money figures" detail={money.message} onRetry={retryMoney} /> : <MoneyCells m={money.data} />}
      <Row title="Money">
        <Key size="small" onClick={() => navigate(dHash('settings', 'money'))}>Open Money</Key>
      </Row>
    </Plate>
  )
  const acct = (
    <Plate title="Account">
      <Row title="Ivan Manfredi"><Key size="small" verb="sign-out" className="ds2-warn" onClick={() => void signOut()}>Sign out</Key></Row>
      <p className="ds2-build">Build {typeof __BUILD__ === 'undefined' ? 'unknown' : __BUILD__}</p>
    </Plate>
  )
  if (v4) {
    const native = typeof window !== 'undefined' ? (window as unknown as { __brief?: { setView?: (v: { density?: string; motion?: string }) => void } }).__brief : undefined
    const pickDensity = (d: typeof density) => { setDensity(d); native?.setView?.({ density: d }) }
    return <SettingsV4 head={<AnswerRow title="Settings" sub={sub} />} build={<>Build {typeof __BUILD__ === 'undefined' ? 'unknown' : __BUILD__}</>} groups={<>
      <Group label="Notifications" id="notifications">
        <Row4 title={`Push on this ${here}`} sub={pushSub || push.error ? <>{pushSub}{push.error && <span className="ds2-err"> {push.error}</span>}</> : undefined}>
          <Pair name="Push" value={push.state === 'on' ? 'on' : push.state === 'off' || push.state === 'denied' ? 'off' : null} disabled={Boolean(push.blocked) || push.busy}
            options={[{ id: 'on', label: 'On', verb: 'push-on' }, { id: 'off', label: 'Off', verb: 'push-off' }]} onPick={v => push.set(v === 'on')} />
        </Row4>
        {devices.kind === 'loading' && <div className="ds4-sub"><Skeleton lines={2} title={false} label="Reading devices" /></div>}
        {devices.kind === 'failed' && <div className="ds4-sub"><Failed what="the device list" detail={devices.message} onRetry={retryDevices} /></div>}
        {devs && devs.length > 0 && <ol className="ds2-devs ds4-devs">{devs.map((x, i) => <li key={`${x.created_at}-${i}`}><i>{i + 1}</i><span>{x.device} <small>· {x.browser}</small></span><em>since {warsawDm(x.created_at)}</em></li>)}</ol>}
        <Row4 title="New-reply sound">
          <Pair name="New-reply sound" value={sound ? 'on' : 'off'} options={[{ id: 'on', label: 'On', verb: 'sound-on' }, { id: 'off', label: 'Off', verb: 'sound-off' }]} onPick={v => setSound(v === 'on')} />
        </Row4>
      </Group>
      <Group label="Appearance" id="appearance">
        <Row4 title="Density">
          <Pair name="Density" value={density} options={[{ id: 'comfortable', label: 'Comfortable', verb: 'density-comfortable' }, { id: 'compact', label: 'Compact', verb: 'density-compact' }]} onPick={pickDensity} />
        </Row4>
        {brief && native?.setView && <Row4 title="Motion">
          <Pair name="Motion" value={nativeMotion} options={[{ id: 'full', label: 'Full', verb: 'motion-full' }, { id: 'subtle', label: 'Subtle', verb: 'motion-subtle' }, { id: 'off', label: 'Off', verb: 'motion-off' }]} onPick={motion => native.setView?.({ motion })} />
        </Row4>}
        <Row4 title="Brief 4 layouts" sub="Off keeps today's look on this device. The page reloads.">
          <Pair name="Brief 4 layouts" value={skinOnHere() ? 'on' : 'off'} options={[{ id: 'on', label: 'On', verb: 'skin-on' }, { id: 'off', label: 'Off', verb: 'skin-off' }]} onPick={v => setSkinHere(v === 'on')} />
        </Row4>
        {theme === 'light' && !brief && (
          <Row4 title="Theme" sub="This device still stores Light from the old app, which turns the Money and legacy panels light.">
            <Key size="small" verb="theme-reset" onClick={resetTheme}>Reset to dark</Key>
          </Row4>
        )}
      </Group>
      <Group label="Client boards" id="boards">
        {([['risedtc', 'Rise', "Mattan's board: queue, drafts, schedule"], ['arch', 'Arch', "Davorin's board: queue, drafts, schedule"]] as const).map(([id, name, what]) => (
          <Row4 key={id} title={name} sub={boards.kind === 'failed' ? 'could not be read' : boards.kind === 'ready' && !board(id) ? 'board not found' : layout === 'phone' ? undefined : what}>
            <a className={`ds2-open${link(id) ? '' : ' ds2-off'}`} href={link(id)} target="_blank" rel="noreferrer" aria-disabled={!link(id)} title={board(id) ? `ivanmanfredi.com/client/${board(id)!.slug}` : undefined}>Open ↗</a>
          </Row4>
        ))}
        <Row4 title="Ivan" sub={layout === 'phone' ? undefined : 'Your own content, on the dashboard'}>
          <a className="ds2-open" title="ivanmanfredi.com/dashboard-v2?section=content" href="https://ivanmanfredi.com/dashboard-v2?section=content" target="_blank" rel="noreferrer">Open ↗</a>
        </Row4>
      </Group>
      <Group label="Money" id="money">
        <div className="ds4-sub">{money.kind === 'loading' ? <Skeleton lines={2} title={false} label="Reading money" /> : money.kind === 'failed' ? <Failed what="the money figures" detail={money.message} onRetry={retryMoney} /> : <MoneyCells m={money.data} />}</div>
        <button type="button" className="ds4-row ds4-link" data-verb="open-money" onClick={() => navigate(dHash('settings', 'money'))}><span className="ds4-t"><b>Open Money</b></span><span className="ds4-chev" aria-hidden="true">›</span></button>
      </Group>
      <Group label="Account" id="account">
        <Row4 title="Ivan Manfredi"><Key size="small" verb="sign-out" className="ds2-warn" onClick={() => void signOut()}>Sign out</Key></Row4>
      </Group>
    </>} />
  }
  return (
    <div className="ds2-root">
      <AnswerRow title={title} sub={sub} />
      {layout === 'phone'
        ? <div className="ds2-col">{notif}{look}{boardsPlate}{moneyPlate}{acct}</div>
        : <div className="ds2-cols"><div className="ds2-col">{notif}{look}</div><div className="ds2-col">{boardsPlate}{moneyPlate}{acct}</div></div>}
    </div>
  )
}

function MoneyPlace({ navigate }: PlaceProps) {
  return (
    <div className="ds2-root ds2-moneyplace">
      <AnswerRow title="Money" tools={<Key size="small" onClick={() => navigate(dHash('settings'))}>Back to Settings</Key>} />
      <div className="ds2-moneyview"><Suspense fallback={<Skeleton lines={6} label="Loading Money" />}><MoneyView /></Suspense></div>
    </div>
  )
}

export default function SettingsPage(props: PlaceProps) {
  return props.route.sub === 'money' ? <MoneyPlace {...props} /> : <SettingsHome {...props} />
}
