import { hashNavigationAllowed } from '../lib/navigationGuard'
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ClaudeProvider } from './claude/ClaudeProvider'
import { Island } from './claude/Island'
import { DInboxProvider, useDInbox } from './counts/inbox'
import { usePull } from './dms/usePull'
import { FrameCountsProvider, useFrameCounts } from './counts/useFrameCounts'
import { PLACES, type Layout } from './places'
import { canonicalHash, dHash, dLandingHash, isForeignHash, parseDHash, toDHash, type DRoute } from './route'
import { BellButton, BellFeed } from './shell/Bell'
import { ForegroundAlerts } from './shell/ForegroundAlerts'
import { FrameCtx, useFrame, type Frame } from './shell/frame'
import { lastSynced } from './shell/navModel'
import { DLayer } from './shell/Layer'
import { useKeepScroll } from './shell/keepScroll'
import { WorkflowsHost } from './shell/Workflows'
import { DPalette } from './shell/Palette'
import { Dock, PhonePanel, PhoneTop } from './shell/Phone'
import { SeatHealthBanner } from './shell/SeatHealth'
import { Side } from './shell/Side'
import { DConfirmProvider } from './ui/confirm'
import { Failed, Offline, Skeleton } from './ui/states'
import { ToastProvider } from './ui/toast'
import { useOnline } from './ui/useOnline'
import { warsawHm } from './ui/time'
import './d.css'
import './shell/frame2.css'

// ---------------------------------------------------------------------------
// D, the frame. Desktop (>= 1000px): left panel, answer row (page title + the
// bell; ⌘K = commands and ⌘J = Claude stay as keys, Claude also sits in the
// left panel), the page, and the Claude
// drawer docked right when open. Phone: top bar, the page (document scroll),
// the dock; the panel is a drawer, the bell a sheet under the top bar, Claude a
// sheet from the lime key. The seat health banner and the offline line sit
// above every page on both.
//
// Hooks rule: every hook in this file runs before any conditional return, and
// no component here returns early above a hook (09-09: a hook after an early
// return blanked every conversation tap for an hour).
// ---------------------------------------------------------------------------

const ClaudeDrawer = lazy(() => import('./claude/Drawer'))

const DESK_MQ = '(min-width: 1000px)'

function useLayout(): Layout {
  return useSyncExternalStore(
    f => {
      const mq = window.matchMedia(DESK_MQ)
      mq.addEventListener('change', f)
      return () => mq.removeEventListener('change', f)
    },
    () => (window.matchMedia(DESK_MQ).matches ? 'desktop' : 'phone'),
    () => 'desktop',
  )
}

const isD = (h: string) => /^#exp\/d(?:[/?]|$)/.test(h)

const DRAWER_KEY = 'd-claude-open'
const SIDE_MIN_KEY = 'd-side-min'
function readFlag(k: string): boolean { try { return localStorage.getItem(k) === '1' } catch { return false } }
function writeFlag(k: string, v: boolean) { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* private mode */ } }

// The phone reopens where he left it (today's brain-b-place): a hash-less cold
// start (the home-screen icon) lands on the last place, not always on Lanes.
const LAST_PLACE = 'd-last-place'

function resumeHash(h: string): string {
  if (h && h !== '#') return h
  if (typeof window === 'undefined' || window.matchMedia?.(DESK_MQ).matches) return h
  try {
    const saved = localStorage.getItem(LAST_PLACE)
    return saved && isD(saved) ? saved : h
  } catch { return h }
}

function useDRoute(): DRoute {
  const read = useCallback(() => {
    const h = resumeHash(location.hash)
    const want = canonicalHash(h)
    if (want !== h) history.replaceState(null, '', want)
    return want
  }, [])
  const [hash, setHash] = useState(read)
  useEffect(() => {
    const on = () => {
      if (!hashNavigationAllowed()) return
      // A document route, the stock shell, the experiment reset and an explicit
      // "today's app" link are their own pages (App.tsx): load them fresh.
      const h = location.hash
      if (/^#doc(\?|$)/.test(h) || (isForeignHash(h) && !dLandingHash(h))) { location.reload(); return }
      setHash(read())
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [read])
  useEffect(() => {
    // Only the place and its sub: a one-shot key (thread, turn, feed, warm) must not replay on the next open.
    const r = parseDHash(hash)
    try { localStorage.setItem(LAST_PLACE, dHash(r.place, r.sub)) } catch { /* private mode */ }
  }, [hash])
  return useMemo(() => parseDHash(hash), [hash])
}

function navigateTo(hash: string) {
  const d = isD(hash) ? hash : toDHash(hash)
  if (d && d !== location.hash) location.hash = d
}

/** A page that throws must not take the frame down with it. */
class PageBoundary extends Component<{ children: ReactNode; place: string }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error(`[d] ${this.props.place} page crashed`, err) }
  render() {
    if (this.state.err) {
      return <div className="d-pagefail"><Failed what={`the ${this.props.place} page`} detail="The page stopped. The rest of the app still works." onRetry={() => location.reload()} /></div>
    }
    return this.props.children
  }
}

function PageLoading() {
  return <div className="d-pageload"><Skeleton lines={6} label="Loading the page" /></div>
}

function Page({ rev = 0 }: { rev?: number }) {
  const f = useFrame()
  const P = PLACES[f.route.place].Page
  return (
    <PageBoundary key={`${f.route.place}:${rev}`} place={PLACES[f.route.place].label}>
      <Suspense fallback={<PageLoading />}>
        <P layout={f.layout} route={f.route} navigate={f.navigate} />
      </Suspense>
    </PageBoundary>
  )
}

function OfflineLine() {
  const online = useOnline()
  const c = useFrameCounts()
  const synced = lastSynced(c)
  if (online) return null
  return <Offline since={synced ? warsawHm(synced) : null} />
}

function ClaudeSlot() {
  const f = useFrame()
  return (
    <Suspense fallback={<div className="d-cslot"><Skeleton lines={3} label="Loading Claude" /></div>}>
      <ClaudeDrawer layout={f.layout} route={f.route} onClose={() => f.setClaudeOpen(false)} />
    </Suspense>
  )
}

function AnswerBar({ setTitleSlot, setToolsSlot }: { setTitleSlot: (el: HTMLElement | null) => void; setToolsSlot: (el: HTMLElement | null) => void }) {
  const c = useFrameCounts()
  const crit = (c.alerts.value?.critical ?? 0) > 0
  return (
    <header className={`d-ans${crit ? ' d-ans-crit' : ''}`}>
      <div className="d-ans-title" ref={setTitleSlot} />
      <div className="d-tools">
        <div className="d-tools-page" ref={setToolsSlot} />
        <BellButton />
      </div>
    </header>
  )
}

function ForegroundInD() {
  const f = useFrame()
  const c = useFrameCounts()
  return <ForegroundAlerts host={{ bellOpen: f.bellOpen, openBell: () => f.setBellOpen(true), navigate: f.navigate, refreshBell: () => c.refresh('bell') }} />
}

function Desktop({ setTitleSlot, setToolsSlot, sideMin, setSideMin }: {
  setTitleSlot: (el: HTMLElement | null) => void; setToolsSlot: (el: HTMLElement | null) => void
  sideMin: boolean; setSideMin: (m: boolean) => void
}) {
  const f = useFrame()
  return (
    <>
      <Side min={sideMin} setMin={setSideMin} />
      <main className="d-main">
        <SeatHealthBanner />
        <OfflineLine />
        <AnswerBar setTitleSlot={setTitleSlot} setToolsSlot={setToolsSlot} />
        <div className={`d-bodyrow${f.claudeOpen ? ' d-with-claude' : ''}`}>
          <div className="d-body"><Page /></div>
          {f.claudeOpen && <aside className="d-claude" aria-label="Claude"><ClaudeSlot /></aside>}
          {f.bellOpen && <BellFeed />}
        </div>
        <Island />
      </main>
    </>
  )
}

function PhoneFrame({ setToolsSlot, panelOpen, setPanelOpen }: {
  setToolsSlot: (el: HTMLElement | null) => void; panelOpen: boolean; setPanelOpen: (o: boolean) => void
}) {
  const f = useFrame()
  const c = useFrameCounts()
  const inbox = useDInbox()
  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen])
  // Pull to refresh on every page (today's usePullToRefresh): the frame's numbers and inbox are
  // re-read and the page is mounted afresh, so it re-reads its own data. DMs keeps its own pull.
  const body = useRef<HTMLDivElement>(null)
  const [rev, setRev] = useState(0)
  const { refresh } = c
  const onDms = f.route.place === 'dms'
  // Re-made when the place changes, so the pull re-binds (off on DMs, whose list has its own).
  const inboxRefresh = inbox.refresh
  const onPull = useCallback(() => { refresh(); inboxRefresh(); setRev(r => r + 1) }, [refresh, inboxRefresh, onDms]) // eslint-disable-line react-hooks/exhaustive-deps
  const ptr = usePull(body, onPull)
  return (
    <>
      <PhoneTop onPanel={() => setPanelOpen(true)} setToolsSlot={setToolsSlot} />
      <SeatHealthBanner />
      <OfflineLine />
      <div className="d-pbody" ref={onDms ? undefined : body}>
        {ptr.pull > 0 && <div className="d-ptr" style={{ height: ptr.pull }} aria-live="polite">{ptr.refreshing ? 'Reading…' : ptr.pull >= ptr.trigger ? 'Release to refresh' : 'Pull to refresh'}</div>}
        <Page rev={rev} />
      </div>
      <Dock />
      <Island />
      {panelOpen && <PhonePanel onClose={closePanel} />}
      {f.bellOpen && (
        <>
          <div className="d-scrim d-scrim-bell" onClick={() => f.setBellOpen(false)} aria-hidden="true" />
          <BellFeed />
        </>
      )}
      {f.claudeOpen && <div className="d-psheet" role="dialog" aria-label="Claude"><ClaudeSlot /></div>}
    </>
  )
}

export default function DShell() {
  const layout = useLayout()
  const route = useDRoute()
  const [bellOpen, setBellOpen] = useState(false)
  // Desktop keeps the Claude drawer and the panel's width where he left them (today's wb-drawer / wb-railmin).
  const [claudeOpen, setClaudeOpen] = useState(() => readFlag(DRAWER_KEY) && window.matchMedia?.(DESK_MQ).matches === true)
  const [sideMin, setSideMin] = useState(() => readFlag(SIDE_MIN_KEY))
  const [palette, setPalette] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null)

  // One overlay at a time on the phone: opening the bell closes Claude and the drawer.
  const openBell = useCallback((o: boolean) => { setBellOpen(o); if (o) setPanelOpen(false) }, [])
  const openClaude = useCallback((o: boolean) => { setClaudeOpen(o); if (o) setPanelOpen(false) }, [])
  const openPalette = useCallback(() => setPalette(true), [])

  useEffect(() => { if (layout === 'desktop') writeFlag(DRAWER_KEY, claudeOpen) }, [claudeOpen, layout])
  useEffect(() => { writeFlag(SIDE_MIN_KEY, sideMin) }, [sideMin])

  useKeepScroll(route.place, layout, location.hash)

  // Moving to another place closes the transient layers.
  useEffect(() => { setBellOpen(false); setPanelOpen(false) }, [route.place])

  // `?feed=1` (a push or a link naming the feed) opens the bell once, then leaves the address.
  const feedAsk = route.query.get('feed')
  useEffect(() => {
    if (feedAsk !== '1' && feedAsk !== 'true') return
    setBellOpen(true); setPanelOpen(false)
    const q = new URLSearchParams(route.query)
    q.delete('feed')
    history.replaceState(null, '', dHash(route.place, route.sub, q))
  }, [feedAsk, route.place, route.sub, route.query])

  // The document behind the phone frame scrolls; paint it the frame's black.
  useEffect(() => {
    document.documentElement.classList.add('d-root')
    return () => document.documentElement.classList.remove('d-root')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPalette(true); return }
      if (mod && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); setClaudeOpen(o => !o); return }
      if (mod && e.key === '\\') { e.preventDefault(); setSideMin(m => !m); return }
      if (e.key === 'Escape' && !document.querySelector('.d-sheet, .d-confirm')) {
        setBellOpen(false); setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const frame = useMemo<Frame>(() => ({
    layout, route, navigate: navigateTo,
    bellOpen, setBellOpen: openBell, claudeOpen, setClaudeOpen: openClaude, openPalette,
    titleSlot: layout === 'desktop' ? titleSlot : null, toolsSlot,
  }), [layout, route, bellOpen, openBell, claudeOpen, openClaude, openPalette, titleSlot, toolsSlot])

  return (
    <DInboxProvider now={route.place === 'dms'}>
      <FrameCountsProvider>
      <FrameCtx.Provider value={frame}>
        <ClaudeProvider>
        <div className={`d-app d-${layout}`} data-bell={bellOpen ? 'open' : undefined} data-place={route.place}>
          <ToastProvider>
            <DConfirmProvider>
              <ForegroundInD />
              {layout === 'desktop'
                ? <Desktop setTitleSlot={setTitleSlot} setToolsSlot={setToolsSlot} sideMin={sideMin} setSideMin={setSideMin} />
                : <PhoneFrame setToolsSlot={setToolsSlot} panelOpen={panelOpen} setPanelOpen={setPanelOpen} />}
              <WorkflowsHost />
              <DLayer>
                {palette && (
                  <DPalette
                    onClose={() => setPalette(false)} navigate={navigateTo} desktop={layout === 'desktop'}
                    toggleClaude={() => openClaude(!claudeOpen)} openBell={() => openBell(true)}
                  />
                )}
              </DLayer>
            </DConfirmProvider>
          </ToastProvider>
        </div>
        </ClaudeProvider>
      </FrameCtx.Provider>
      </FrameCountsProvider>
    </DInboxProvider>
  )
}
