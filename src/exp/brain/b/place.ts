// place.ts — which of the six tab-bar slots the phone is standing on, pure
// and separate from React so re-entry cost is testable without mounting
// anything.
//
// Six tabs, decided: Ask, Today, DMs, Content, Sends, Ops. The brief flagged
// that "Ask · Today · DMs · Content · Sends · Ops is six" and asked either for
// 11px-caps labels under 24px glyphs, or folding Sends into Ops. THIS
// CANDIDATE KEEPS ALL SIX, with small-caps labels: Sends and Ops are two
// different jobs on the desktop rail (outreach pace vs approvals) and folding
// them on the phone would hide the automation alarm behind a segment switch
// the rail never makes anyone take. At 390px six equal slots are 65px each,
// which clears the 44x44 tap-target floor with room left over — there was
// never a width problem, only a label-legibility one, and 11px uppercase under
// a 20px glyph (--fs-eyebrow, already in the ramp) reads fine at that width.
// Feed is NOT a seventh tab — it is the header button on every place, per the
// brief's other offered resolution, which is the one this candidate takes for
// the feed specifically.

import { isWorkJob, type Job } from '../../v2c/layout'

export type Place = 'ask' | 'today' | 'dms' | 'content' | 'sends' | 'ops'

export const TABS: Place[] = ['ask', 'today', 'dms', 'content', 'sends', 'ops']

export const TAB_LABEL: Record<Place, string> = {
  ask: 'Ask', today: 'Today', dms: 'DMs', content: 'Content', sends: 'Lanes', ops: 'Ops',
}

// The per-tab mark is a lucide icon now and it lives with the bar that draws
// it (src/wb/ask/Mobile.tsx TAB_ICON, on the same names src/ds/icons.tsx gives
// the ten jobs), so the phone and the desktop rail still cannot disagree about
// what a job looks like. The unicode map this file used to carry was read by
// one dead path (./TabBar.tsx, which W6 deletes) and by nothing live.

/** A Shell `Job` (which can be magnets/styles/strategy/settings/money — jobs
 * with no tab of their own) collapsed onto the tab that represents it. */
export function tabForJob(job: Job): Place {
  if (isWorkJob(job)) return 'content'
  if (job === 'settings' || job === 'money') return 'today'
  if (job === 'today' || job === 'dms' || job === 'sends' || job === 'ops') return job
  return 'today'
}

/** The Job to hand `goJob` for a tap on a given tab. Ask has none — it is not a Job. */
export function jobForTab(tab: Exclude<Place, 'ask'>): Job {
  return tab
}

const PLACE_KEY = 'brain-b-place'

/** Only a real tab is ever written or trusted back out of storage — the
 * today.ts whitelist idiom, never a raw copy of anything richer. */
export function readPlace(): Place | null {
  try {
    const v = localStorage.getItem(PLACE_KEY)
    return (TABS as string[]).includes(v ?? '') ? (v as Place) : null
  } catch { return null }
}

export function writePlace(p: Place): void {
  try { localStorage.setItem(PLACE_KEY, p) } catch { /* private mode / quota */ }
}

// ---------------------------------------------------------------------------
// Boot resolution — what a fresh load's deep-link state means for the place.
// A push notification's `?feed=1` or `?thread=<uuid>` always wins over
// whatever was persisted: someone tapped a specific thing, and landing
// somewhere else because "that's where you left off" would defeat the link.
// ---------------------------------------------------------------------------
export type Boot = { feed?: boolean; thread?: string }

export function resolveBootPlace(boot: Boot, persisted: Place | null): Place {
  if (boot.feed) return 'ask' // the feed opens as a sheet OVER a place; Ask under it is the sane default
  if (boot.thread) return 'ask'
  return persisted ?? 'ask'
}
