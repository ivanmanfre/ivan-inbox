import { limitRead, type Read } from '../model'
import type { HomeData } from '../reads'
import type { Seat } from '../../seats'
import { clientOf, controlOf, todayOf } from '../../lanes/model'
import { slotRead } from '../../ui/Figure'

export function invites(h: HomeData, seat: Seat) {
  return slotRead(h.lanes.cc, p => { const t = todayOf(p, seat, h.now); return { inv: t?.inv ?? null, cap: t?.cap ?? null } })
}
export function pill(h: HomeData, seat: Seat): Read<{ word: string; time: string | null; tone: 'clear' | 'warn' | 'neutral'; why: string | null }> {
  for (const slot of [h.lanes.cc, h.lanes.pauses]) {
    if (slot.value == null) return slot.failed ? { fail: slot.failed } : { wait: true }
  }
  const r = limitRead(h.lanes, seat, h.now)
  if (!('v' in r)) return r
  const t = todayOf(h.lanes.cc.value, seat, h.now)
  const c = clientOf(h.lanes.cc.value, seat)
  const atCap = t?.cap != null && t.cap > 0 && t.capUsed != null && t.capUsed >= t.cap
  const why = c ? controlOf(c, h.now).incident?.lead ?? null : null
  return { v: r.v.limited ? { word:'Limited', time:r.v.resumes, tone:'warn', why:why ?? 'Paused after LinkedIn refused invites' }
    : atCap ? { word:'At cap', time:t?.resets ?? null, tone:'neutral', why:null }
      : { word:'Clear', time:r.v.lastTry, tone:r.v.refused ? 'warn' : 'clear', why:null }, ...(h.lanes.cc.failed || h.lanes.pauses.failed ? { stale: h.lanes.cc.failed ?? h.lanes.pauses.failed! } : {}) }
}
