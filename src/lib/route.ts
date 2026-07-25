type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings' | 'today'
const TABS: Tab[] = ['inbox', 'drafts', 'sends', 'ops', 'settings', 'today']

type Route = { tab?: Tab; thread?: string } | null

/**
 * Parses a URL fragment hash into a route.
 * - Ignores `#access_token...` (Supabase auth flow)
 * - Parses `#thread/{prospect_id}` → { tab: 'inbox', thread: prospect_id }
 * - Parses valid tab names like `#today` → { tab: 'today' }
 * - Returns null for unknown/empty hashes
 */
export function parseHash(hash: string): Route {
  if (!hash) return null
  if (hash.startsWith('#access_token')) return null

  if (hash.startsWith('#thread/')) {
    const id = decodeURIComponent(hash.slice('#thread/'.length))
    if (id) {
      return { tab: 'inbox', thread: id }
    }
    return null
  }

  const t = hash.slice(1) as Tab
  if (TABS.includes(t)) {
    return { tab: t }
  }

  // Unrecognized hash
  return null
}
