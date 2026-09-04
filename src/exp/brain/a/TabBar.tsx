// TabBar.tsx — REPLACES v2c/Rail.tsx's MobileTabs on this candidate's phone
// entry. D3's grouping: Ask · Today · DMs · Work · Feed. Work fans out to
// Content / Sends / Ops through WorkTabs (rendered above the work surface,
// not here); Feed carries the unread count the way the old Content slot
// carried the work-group sum.
import type { Job } from '../../v2c/layout'
import type { Place } from './place'

type Counts = Partial<Record<Job, number>>

const WORK_MEMBERS: Job[] = ['content', 'sends', 'ops']

const TABS: { place: Place; icon: string; label: string }[] = [
  { place: 'ask', icon: '✳', label: 'Ask' },
  { place: 'today', icon: '☼', label: 'Today' },
  { place: 'dms', icon: '◉', label: 'DMs' },
  { place: 'work', icon: '▥', label: 'Work' },
]

export function TabBar({ place, counts, sev, unread, chatBusy, onPlace }: {
  place: Place
  counts: Counts
  sev: Partial<Record<Job, 'attention' | 'urgent'>>
  /** Unread notification count — the Feed tab's own badge, never mixed with a job count. */
  unread: number
  /** A turn is streaming right now: Ask gets a live pulse instead of a numeral. */
  chatBusy: boolean
  onPlace: (p: Place) => void
}) {
  const workCount = WORK_MEMBERS.reduce((s, j) => s + (counts[j] ?? 0), 0)
  const workSev = WORK_MEMBERS.some(j => sev[j] === 'urgent') ? 'urgent'
    : WORK_MEMBERS.some(j => sev[j] === 'attention') ? 'attention' : undefined

  return (
    <div className="ba-tabbar" role="tablist">
      {TABS.map(t => {
        const n = t.place === 'work' ? workCount : counts[t.place as Job] ?? 0
        const s = t.place === 'work' ? workSev : sev[t.place as Job]
        const active = place === t.place
        return (
          <button
            key={t.place} type="button" role="tab" aria-selected={active}
            className={`ba-tab${active ? ' on' : ''}`}
            onClick={() => onPlace(t.place)}
          >
            <span className="ba-tab-ic">
              {t.icon}
              {t.place === 'ask' && chatBusy && <span className="ba-tab-live" />}
              {n > 0 && <span className={`ba-tab-cnt${s ? ` ${s}` : ' neutral'}`}>{n}</span>}
            </span>
            <span className="ba-tab-l">{t.label}</span>
          </button>
        )
      })}
      <button
        type="button" role="tab" aria-selected={place === 'feed'}
        className={`ba-tab${place === 'feed' ? ' on' : ''}`}
        onClick={() => onPlace('feed')}
      >
        <span className="ba-tab-ic">
          ◫
          {unread > 0 && <span className="ba-tab-cnt neutral">{unread > 99 ? '99+' : unread}</span>}
        </span>
        <span className="ba-tab-l">Feed</span>
      </button>
    </div>
  )
}
