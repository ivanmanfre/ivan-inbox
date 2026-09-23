/* ==========================================================================
   Strategy deep-link identity (Task 6 — "make investigation state addressable
   in the UI"). Pure, framework-free: everything here is a string in, a
   string/typed-value out, so it is unit-testable without mounting React and
   reusable from both the real Shell-hosted StrategyView and the local
   fixture-data preview harness that has no `#exp/` hash at all.

   Why a separate module instead of inlining this in strategy.tsx: the exact
   same validation (which lane ids are real, which section ids are real) has
   to agree between the production reader (strategy.tsx, reading
   `location.hash`) and the fixture harness (LocalPreviewHarness.tsx, reading
   `location.search`) or "the same source identities and client state" the
   brief requires would drift the moment one of the two call sites edited its
   own copy of the whitelist.
   ========================================================================== */
import { parseWbHash } from '../../../exp/v2c/route'
import type { ContentLane } from '../../../lib/content'

// Every id `StrategyView`'s own `view` state can hold. Kept here (not
// imported from strategy.tsx, which is not a module other files should import
// from) so a hash/query can be validated against the exact same list the
// component switches on rather than a hand-copied subset that rots.
export const STRATEGY_VIEWS = [
  'this-week', 'research', 'results', 'direction',
  'demos', 'recommendations', 'evidence', 'competitors', 'magnets', 'markets', 'outreach', 'notes',
] as const

export type StrategyViewId = typeof STRATEGY_VIEWS[number]

const VIEW_SET = new Set<string>(STRATEGY_VIEWS)

export function isStrategyView(x: string | null | undefined): x is StrategyViewId {
  return !!x && VIEW_SET.has(x)
}

// Duplicated as a literal array rather than imported from `lib/content`:
// that module's first line is `import { supabase } from './supabase'`, and
// this file is reached from the pure router too (`route.ts` already keeps
// its own local UUID regex for the identical reason — see the comment there).
const CONTENT_LANES: ContentLane[] = ['ivan', 'risedtc', 'arch']

export function isContentLane(x: string | null | undefined): x is ContentLane {
  return !!x && (CONTENT_LANES as string[]).includes(x)
}

export type StrategyDeepLink = { lane?: ContentLane; section?: StrategyViewId; briefId?: string; briefVersion?: number }

const BRIEF_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export function exactBriefDeepLink(lane: ContentLane, briefId: string, version: number): string {
  if (!isContentLane(lane) || !BRIEF_ID.test(briefId) || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid exact brief identity')
  return `#exp/v2/strategy?${new URLSearchParams({ lane, section: 'this-week', brief_id: briefId, brief_version: String(version) })}`
}

/**
 * The Strategy lane/section a fresh-load hash names, if any — read once at
 * mount so `#exp/v2/strategy?lane=risedtc&section=research` restores both the
 * client scope and the tab instead of always booting on Ivan / This week.
 * Anything the hash does not name, or names invalidly (an unregistered lane,
 * a made-up section id), is simply absent from the result: the caller's own
 * default applies exactly as if the query had not been there, the same
 * fail-open-to-default rule `parseWbHash` already uses for `job`/`focus`.
 */
export function readStrategyDeepLink(hash: string): StrategyDeepLink {
  const route = parseWbHash(hash)
  if (route.job !== 'strategy') return {}
  const query = new URLSearchParams(hash.split('?')[1] ?? '')
  const id = query.get('brief_id')
  const rawVersion = query.get('brief_version')
  const version = rawVersion && /^[1-9]\d*$/.test(rawVersion) ? Number(rawVersion) : null
  const exact = isContentLane(route.lane) && route.section === 'this-week' && id && BRIEF_ID.test(id) &&
    version !== null && Number.isSafeInteger(version)
  return {
    ...(isContentLane(route.lane) ? { lane: route.lane } : {}),
    ...(isStrategyView(route.section) ? { section: route.section } : {}),
    ...(exact ? { briefId: id, briefVersion: version } : {}),
  }
}
