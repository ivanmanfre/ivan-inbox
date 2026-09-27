/* ==========================================================================
   src/d/settings — Settings, direction D. Two columns of plates with hardware
   keys (desktop), one column (phone). Dark is the only theme. Money moved here
   from the rail: a read-only plate, and "Open Money" mounts today's Money view
   inside D's frame at #exp/d/settings/money.
   Lime only on live state (judge): a saved preference is the pressed neutral key.
   ========================================================================== */
import { lazy, Suspense, type ReactNode } from 'react'
import { fmtUsd, PLAIN_UNVERIFIED, plainNote, plainProvenance } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { AnswerRow, N } from '../ui/AnswerRow'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { Failed, Skeleton } from '../ui/states'
import { useRead, useRetryRead } from '../lanes/useRead'
import { warsawDm } from '../ui/time'
import { useDensity, usePush, useSound, useStoredTheme } from './prefs'
import { fetchBoards, fetchDevices, fetchMoneyPlate, type MoneyPlate } from './reads'
import './settings.css'

const MoneyView = lazy(() => import('../../wb/money').then(m => ({ default: m.MoneyView })))

function Pair<T extends string>({ value, options, onPick, disabled, name }: {
  value: T | null; options: Array<{ id: T; label: string; verb: string }>; onPick: (v: T) => void; disabled?: boolean; name: string
}) {
  return (
    <div className="ds2-pair" role="group" aria-label={name}>
      {options.map(o => (
        <Key key={o.id} size="small" verb={o.verb} aria-pressed={value === o.id} className={value === o.id ? 'ds2-pressed' : ''}
          disabled={disabled} onClick={() => { if (value !== o.id) onPick(o.id) }}>{o.label}</Key>
      ))}
    </div>
  )
}

function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return <div className="ds2-row"><div className="ds2-t"><b>{title}</b>{sub != null && <small>{sub}</small>}</div>{children}</div>
}
function Plate({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="ds2-plate"><h3>{title}{note && <span>{note}</span>}</h3>{children}</section>
}

const CLIENT_NAME: Record<string, string> = { risedtc: 'Rise', arch: 'Arch' }

function MoneyCells({ m }: { m: MoneyPlate }) {
  // Every client the ledger carries an MRR row for (Rise and Arch first), never a typed-in pair.
  const ids = [...new Set(['risedtc', 'arch', ...m.mrr.map(r => r.clientId).filter((x): x is string => Boolean(x))])]
  const cell = (id: string) => {
    const r = m.mrr.find(x => x.clientId === id)
    const a = r?.amountRow
    const label = CLIENT_NAME[id] ?? id
    return (
      <div key={id}><small>{label} MRR</small>
        {a ? <><em>{fmtUsd(a.amount_usd)}</em><u>{a.verified ? 'verified' : PLAIN_UNVERIFIED} · {plainProvenance(a)}</u></>
          : r ? <><em className="ds2-z">not recorded</em><u>{plainNote(r.latestRow.note)}</u></>
            : <><em className="ds2-z">not recorded</em><u>no MRR row on file</u></>}
      </div>
    )
  }
  return (
    <div className="ds2-money">
      {ids.map(cell)}
      <div><small>Runway</small>{m.cash == null ? <><em className="ds2-z">not computed</em><u>no cash on hand recorded</u></> : <><em className="ds2-z">in Money</em><u>cash as of {m.cashAsOf ?? 'unknown'}</u></>}</div>
    </div>
  )
}

function SettingsHome({ layout, navigate }: PlaceProps) {
  const push = usePush()
  const [sound, setSound] = useSound()
  const [density, setDensity] = useDensity()
  const [theme, resetTheme] = useStoredTheme()
  const confirm = useDConfirm()
  const [devices, retryDevices] = useRetryRead(fetchDevices, 'devices')
  const boards = useRead(fetchBoards, 'boards')
  const [money, retryMoney] = useRetryRead(fetchMoneyPlate, 'money')

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
      {/* Dark is the only theme: the row only shows when this device still stores Light from the old app. */}
      {theme === 'light' && (
        <Row title="Theme" sub="This device still stores Light from the old app, which turns the Money and legacy panels light.">
          <Key size="small" verb="theme-reset" onClick={resetTheme}>Reset to dark</Key>
        </Row>
      )}
      <Row title="Density">
        <Pair name="Density" value={density} options={[{ id: 'comfortable', label: 'Comfortable', verb: 'density-comfortable' }, { id: 'compact', label: 'Compact', verb: 'density-compact' }]} onPick={setDensity} />
      </Row>
    </Plate>
  )
  const link = (id: string) => { const b = board(id); return b ? `https://ivanmanfredi.com/client/${b.slug}?k=${encodeURIComponent(b.token)}` : undefined }
  const boardsPlate = (
    <Plate title="Client boards">
      {([['risedtc', 'Rise', "Mattan's board: queue, drafts, schedule"], ['arch', 'Arch', "Davorin's board: queue, drafts, schedule"]] as const).map(([id, name, sub]) => (
        <Row key={id} title={name} sub={<>{sub}<span className="ds2-lk">{boards.kind === 'ready' ? (board(id) ? `ivanmanfredi.com/client/${board(id)!.slug}` : 'board not found') : boards.kind === 'failed' ? 'could not be read' : 'reading…'}</span></>}>
          <a className={`ds2-open${link(id) ? '' : ' ds2-off'}`} href={link(id)} target="_blank" rel="noreferrer" aria-disabled={!link(id)}>Open ↗</a>
        </Row>
      ))}
      <Row title="Ivan" sub={<>Your own content, on the dashboard<span className="ds2-lk">ivanmanfredi.com/dashboard-v2?section=content</span></>}>
        <a className="ds2-open" href="https://ivanmanfredi.com/dashboard-v2?section=content" target="_blank" rel="noreferrer">Open ↗</a>
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
