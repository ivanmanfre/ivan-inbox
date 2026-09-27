import { useToday } from '../../hooks/useToday'
import { laneName, supplyAlarmLane } from '../../lib/focus'
import { todayPlate, type LinkedInHealth, type ScheduledPost } from '../../lib/today'
import { warsawHm } from '../ui/time'

// ---------------------------------------------------------------------------
// FROM TODAY'S TODAY SCREEN, the lines about sending that no D place carried
// (the Today SCREEN stays rejected; its lines live where they belong):
//   - the supply alarm: "<seat> lane is out of leads" (lib/focus
//     supplyAlarmLane over the brief's pipeline + governor: runway < 1 day);
//   - the LinkedIn lane counters, all seats (brief outreach_health.linkedin:
//     fresh supply, sent today, accepts, replies, need reply, stuck);
//   - "N slots today cancelled" (the brief's calendar, called off, so not
//     counted as going out);
//   - the cold-email note when it is not connected.
// Same read as today (useToday: get-morning-brief + its health reads). One
// quiet band under the Lanes answer; nothing at all when there is nothing to say.
// ---------------------------------------------------------------------------

const COUNTERS: { k: keyof LinkedInHealth; label: string }[] = [
  { k: 'fresh_supply', label: 'fresh supply' }, { k: 'sends_today', label: 'sent today' },
  { k: 'accepts_today', label: 'accepts' }, { k: 'replies_today', label: 'replies' },
  { k: 'needs_reply', label: 'need reply' }, { k: 'stuck', label: 'stuck' },
]

function slotLine(p: ScheduledPost): string {
  const at = p.scheduled_at ? warsawHm(p.scheduled_at) : null
  return [at, p.post_format, p.platform].filter(Boolean).join(' ')
}

export function TodayNotes() {
  const t = useToday()
  const li = t.brief?.outreach_health?.linkedin ?? null
  const cold = t.brief?.outreach_health?.cold_email ?? null
  const cancelled = todayPlate(t.brief, 'all').cancelled
  const alarm = t.health ? supplyAlarmLane(t.health.pipeline, t.health.governor) : null
  const failed = t.error != null && !t.brief
  if (!t.brief && !alarm && !failed) return null
  return (
    <div className="dl-today" data-today-notes>
      {alarm && <p className="dl-today-alarm" data-supply-alarm>{laneName(alarm)} is out of leads.</p>}
      {li && (
        <p className="dl-today-li" data-linkedin-counters>
          <span>LinkedIn lane, all seats:</span>{' '}
          {COUNTERS.map((c, i) => {
            const v = li[c.k]
            const tone = c.k === 'stuck' && (v ?? 0) > 0 ? 'dl-today-bad' : c.k === 'needs_reply' && (v ?? 0) > 0 ? 'dl-today-warn' : c.k === 'sends_today' && v === 0 ? 'dl-today-warn' : ''
            return <span key={c.k} className={tone}>{i ? ' · ' : ''}<b>{v ?? '?'}</b> {c.label}</span>
          })}
        </p>
      )}
      {cancelled.length > 0 && (
        <p data-cancelled-slots>
          {cancelled.length} slot{cancelled.length === 1 ? '' : 's'} today cancelled ({cancelled.map(slotLine).filter(Boolean).join(', ') || 'no time on the row'}). Called off, so {cancelled.length === 1 ? 'it is' : 'they are'} not counted as going out.
        </p>
      )}
      {cold && cold.connected === false && <p data-cold-email>Cold email: {cold.note ?? 'not connected'}.</p>}
      {failed && <p className="dl-today-warn">Could not read today's brief, so the LinkedIn counters and cancelled slots are not shown.</p>}
    </div>
  )
}
