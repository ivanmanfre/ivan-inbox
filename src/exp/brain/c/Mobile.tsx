import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrainMobileProps } from '../types'
import type { Job } from '../../v2c/layout'
import { WORK_JOBS } from '../../v2c/layout'
import { Failed, relAge } from '../../v2c/Surface'
import { StreamList } from './StreamList'
import { useNotifications, usePersistedEnum } from './useStreamData'
import { unreadCount } from './stream'

type Place = 'stream' | 'today' | 'dms' | 'work' | 'ops'
type WorkSub = 'content' | 'sends'

const PLACES: Place[] = ['stream', 'today', 'dms', 'work', 'ops']
const WORK_SUBS: WorkSub[] = ['content', 'sends']

const TABS: { place: Place; icon: string; label: string }[] = [
  { place: 'stream', icon: '✳', label: 'Stream' },
  { place: 'today', icon: '☼', label: 'Today' },
  { place: 'dms', icon: '◉', label: 'DMs' },
  { place: 'work', icon: '▤', label: 'Work' },
  { place: 'ops', icon: '◈', label: 'Ops' },
]

function placeToJob(place: Place, sub: WorkSub): Job {
  if (place === 'work') return sub
  if (place === 'stream') return 'dms'
  return place
}

/** Where an arbitrary Job (from a notification's deep link) lands on this tab bar. */
function jobToPlace(job: Job): { place: Place; sub?: WorkSub } {
  if (job === 'sends') return { place: 'work', sub: 'sends' }
  if ((WORK_JOBS as string[]).includes(job)) return { place: 'work', sub: 'content' }
  if (job === 'today' || job === 'dms' || job === 'ops') return { place: job }
  return { place: 'today' }
}

/**
 * Candidate C's phone entry. One column (StreamList) IS the Ask+Feed place;
 * the other four tabs hand the already-rendered lane straight through.
 */
export function Mobile(props: BrainMobileProps) {
  const { chat, goJob, counts, health, loadedAt, inboxError, refresh, workSurface, windows, peerView, about, aboutContext, boot } = props

  const [place, setPlaceRaw] = usePersistedEnum<Place>('brain-c-place', PLACES, 'stream')
  const [workSub, setWorkSub] = usePersistedEnum<WorkSub>('brain-c-worksub', WORK_SUBS, 'content')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const notif = useNotifications()

  // A deep link that names a thread/turn/feed always opens the stream, no
  // matter where he left off last — that is what "one stream" is for.
  const forcedStream = useRef(!!(boot.thread || boot.turn || boot.feed))
  useEffect(() => {
    if (forcedStream.current) { setPlaceRaw('stream'); forcedStream.current = false }
    // Mount-only: this is a one-time override of the persisted place, not a rule to re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (settingsOpen) goJob('settings')
    else if (place !== 'stream') goJob(placeToJob(place, workSub))
  }, [settingsOpen, place, workSub, goJob])

  const setPlace = useCallback((p: Place) => { setSettingsOpen(false); setPlaceRaw(p) }, [setPlaceRaw])

  const navigateFromNotification = useCallback((job: Job) => {
    const { place: p, sub } = jobToPlace(job)
    if (sub) setWorkSub(sub)
    setPlace(p)
  }, [setPlace, setWorkSub])

  const badge = (p: Place): number => {
    if (p === 'stream') return unreadCount(notif.rows)
    if (p === 'work') return WORK_JOBS.reduce((s, j) => s + (counts[j] ?? 0), 0) + (counts.sends ?? 0)
    return counts[p] ?? 0
  }

  if (peerView) {
    return (
      <div className="app wb brain-c brain-c-take">
        {peerView}
        {windows}
      </div>
    )
  }

  return (
    <div className="app wb brain-c" data-place={place === 'stream' && !settingsOpen ? 'ask' : 'lane'}>
      <div className="wb-plate brc-plate">
        <div className="brc-ribbon">
          <span className="brc-ribbon-t">{settingsOpen ? 'Settings' : TABS.find(t => t.place === place)?.label}</span>
          <span className="brc-ribbon-fresh">{loadedAt ? relAge(loadedAt) : 'loading'}</span>
          {health.n > 0 && <span className="brc-health">{health.n} · {health.note}</span>}
          <button type="button" className="brc-refresh" onClick={refresh} aria-label="Refresh">↻</button>
          {settingsOpen ? (
            <button type="button" className="brc-gear" onClick={() => setSettingsOpen(false)}>Done</button>
          ) : (
            <button type="button" className="brc-gear" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙︎</button>
          )}
        </div>

        {inboxError && !settingsOpen && place !== 'stream' && (
          <Failed what="This lane" message={inboxError} onRetry={refresh} loadedAt={loadedAt} />
        )}

        {settingsOpen ? (
          <div className="brc-worksurface">{workSurface}</div>
        ) : place === 'stream' ? (
          <StreamList
            chat={chat} about={aboutContext ?? about ?? null} boot={boot} notif={notif}
            onNavigateJob={navigateFromNotification}
          />
        ) : (
          <>
            {place === 'work' && (
              <div className="brc-worksub">
                {WORK_SUBS.map(s => (
                  <button
                    key={s} type="button" className={`brc-worksub-b${workSub === s ? ' on' : ''}`}
                    onClick={() => setWorkSub(s)}
                  >{s === 'content' ? 'Content' : 'Sends'}</button>
                ))}
              </div>
            )}
            <div className="brc-worksurface">{workSurface}</div>
          </>
        )}

        {/* The bar lives INSIDE the plate (faithful.css §3c convention) so
            nothing shows through to the pistachio ground behind it. */}
        <div className="brc-tabbar">
          {TABS.map(t => {
            const n = badge(t.place)
            return (
              <button
                key={t.place} type="button"
                className={`brc-tab${!settingsOpen && place === t.place ? ' on' : ''}`}
                onClick={() => setPlace(t.place)}
              >
                <span className="brc-tab-ic">
                  {t.icon}
                  {n > 0 && <span className="brc-tab-cnt">{n > 99 ? '99+' : n}</span>}
                </span>
                <span className="brc-tab-l">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {windows}
    </div>
  )
}
