// Mobile.tsx - candidate A's phone entry. Thesis: Ask is the home (opens on
// the last thread, hydrated), Feed is a dense ledger one tap or one swipe
// away, Today/DMs/Work stay reachable from the same bar.
import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import type { BrainMobileProps } from '../types'
import type { Job } from '../../v2c/layout'
import { relAge } from '../../v2c/Surface'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { TabBar } from './TabBar'
import { WorkTabs, WORK_PLACE_JOBS } from './WorkTabs'
import { readPlace, readWorkTab, writePlace, writeWorkTab, type Place } from './place'
import { resolveNotificationRoute } from './deepLink'
import type { Notification } from '../../../lib/turns'

export function BrainMobile({
  chat, job, goJob, counts, sev, health, loadedAt, inboxError, refresh,
  workSurface, windows, peerView, about, aboutContext, subjects, boot,
}: BrainMobileProps) {
  const [place, setPlaceState] = useState<Place>('ask')
  const [unread, setUnread] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const lastPrimary = useRef<Place>('ask')
  const pagerRef = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number; horiz: boolean | null; base: number }>({ x: 0, y: 0, horiz: null, base: 0 })
  const settingsFrom = useRef<Job>('today')
  const bootHandled = useRef(false)

  useEffect(() => {
    if (place !== 'feed') lastPrimary.current = place
  }, [place])

  const setPlace = (p: Place) => {
    setPlaceState(p)
    writePlace(p)
    if (p === 'today') goJob('today')
    else if (p === 'dms') goJob('dms')
    else if (p === 'work') goJob(WORK_PLACE_JOBS.includes(job) ? job : readWorkTab())
  }

  // Boot once: a deep link (a finished turn's own notification, or a
  // ?feed=1 link) wins over whatever was cached from the last visit.
  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.feed) { setPlaceState('feed'); return }
    if (boot.thread) { chat.openThread(boot.thread); setPlaceState('ask'); return }
    const cached = readPlace()
    if (cached) setPlace(cached)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onJobFromWork = (j: Job) => { writeWorkTab(j); goJob(j) }

  const openNotification = (n: Notification) => {
    const route = resolveNotificationRoute(n)
    if (route.place === 'ask') {
      if (route.thread) chat.openThread(route.thread)
      setPlace('ask')
    } else {
      setPlace(route.job === 'today' ? 'today' : route.job === 'dms' ? 'dms' : 'work')
      if (route.job !== 'today' && route.job !== 'dms') onJobFromWork(route.job)
    }
  }

  const toggleSettings = () => {
    if (job === 'settings') { goJob(settingsFrom.current); return }
    settingsFrom.current = job
    goJob('settings')
  }

  // ---- the swipe pager (Ask/lane <-> Feed). Direct manipulation: the track
  // follows the finger; motion elsewhere in this build stays at zero. ----
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, horiz: null, base: place === 'feed' ? -1 : 0 }
  }
  const onTouchMove = (e: ReactTouchEvent) => {
    const t = e.touches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    if (touch.current.horiz === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      touch.current.horiz = Math.abs(dx) > Math.abs(dy)
    }
    if (!touch.current.horiz) return
    const w = pagerRef.current?.clientWidth || 390
    setDrag(Math.max(-w, Math.min(0, touch.current.base * w + dx)))
  }
  const onTouchEnd = () => {
    if (touch.current.horiz && drag !== null) {
      const w = pagerRef.current?.clientWidth || 390
      const startPx = touch.current.base * w
      const delta = drag - startPx
      if (delta < -w * 0.25) setPlace('feed')
      else if (delta > w * 0.25) setPlace(lastPrimary.current)
    }
    setDrag(null)
    touch.current.horiz = null
  }

  const dataPlace = place === 'ask' ? 'ask' : place === 'feed' ? 'feed' : 'lane'

  // A DM thread opened as a full-screen takeover replaces the whole phone -
  // same rule the base app uses (faithful.css :410's wb-take contract).
  if (peerView) {
    return (
      <div className="app wb wb-take wb-take-thread brain-a">
        {peerView}
        {windows}
      </div>
    )
  }

  const w = pagerRef.current?.clientWidth || 390
  const base = place === 'feed' ? -w : 0
  const transform = drag !== null ? `translateX(${drag}px)` : `translateX(${base}px)`

  return (
    <div className="app wb brain-a" data-place={dataPlace}>
      <div className="wb-plate ba-plate">
        <div className="ba-rib">
          <span className={`ba-rib-sync${inboxError ? ' bad' : ''}`} onClick={refresh}>
            {inboxError ? 'not syncing' : relAge(loadedAt)}
          </span>
          {health.n > 0 && (
            <span className="ba-rib-health" title={health.note} onClick={() => setPlace('work')}>
              <span className="ba-rib-dot" />{health.n}
            </span>
          )}
          <button type="button" className="ba-gear" onClick={toggleSettings}>
            {job === 'settings' ? 'Done' : '⚙︎'}
          </button>
        </div>

        <div
          className="ba-pager" ref={pagerRef}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        >
          <div className="ba-pager-track" style={{ transform, transition: drag === null ? undefined : 'none' }}>
            <div className="ba-page">
              <div className={`ba-primary${place === 'ask' && job !== 'settings' ? ' show' : ''}`}>
                <AskThread chat={chat} job={job} about={about} aboutContext={aboutContext} subjects={subjects} mobile />
              </div>
              {(place === 'today' || place === 'dms' || place === 'work' || job === 'settings') && (
                <div className="ba-primary show ba-lane">
                  {place === 'work' && job !== 'settings' && (
                    <WorkTabs job={job} counts={counts} sev={sev} onJob={onJobFromWork} />
                  )}
                  {workSurface}
                </div>
              )}
            </div>
            <div className="ba-page">
              <Feed active={place === 'feed'} onNavigate={openNotification} onUnreadChange={setUnread} />
            </div>
          </div>
        </div>

        <TabBar place={place} counts={counts} sev={sev} unread={unread} chatBusy={chat.busy} onPlace={setPlace} />
      </div>
      {windows}
    </div>
  )
}
