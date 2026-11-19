import { actionItems, type ActionItem, type CallRow } from '../../lib/transcripts'

export const ARCHIVE_TABS = [
  { id: 'sales', label: 'Sales', empty: 'No sales recordings.' },
  { id: 'clients', label: 'Clients', empty: 'No client recordings.' },
  { id: 'other', label: 'Other', empty: 'No other recordings.' },
  { id: 'all', label: 'All', empty: 'No recordings yet.' },
] as const

export type ArchiveTab = typeof ARCHIVE_TABS[number]['id']

const SALES_TYPES = new Set(['sales_call', 'discovery_sales', 'first_discovery', 'follow_up_sales'])
const CLIENT_TYPES = new Set(['client_checkin', 'client_kickoff', 'client_call', 'delivery', 'arch_call'])
const CLIENT_TITLES = /\b(?:client\s+(?:check[ -]?in|kick[ -]?off|delivery)|onboarding|kick[ -]?off|(?:ios|inbound on steroids)\s+biweekly)\b/i
const SALES_TITLES = /\b(?:demo call|discovery call|sales call|discovery\s+inbound\s*on\s*steroids)\b/i

export function clientRecorder(call: CallRow): string | null {
  if (call.source === 'fathom-risedtc') return 'RISE DTC'
  if (call.source === 'fireflies-arch') return 'ARCH'
  return null
}

export function archiveCategory(call: CallRow): Exclude<ArchiveTab, 'all'> {
  if (clientRecorder(call) || CLIENT_TYPES.has(call.meeting_type ?? '')) return 'clients'
  const review = call.call_review?.call_kind ?? ''
  if (SALES_TYPES.has(call.meeting_type ?? '') || SALES_TYPES.has(review)) return 'sales'
  if (CLIENT_TITLES.test(call.title ?? '')) return 'clients'
  if (review !== 'not_a_sales_call' && SALES_TITLES.test(call.title ?? '')) return 'sales'
  return 'other'
}

export function archiveTab(query: string | null, selected: CallRow | null): ArchiveTab {
  const requested = ARCHIVE_TABS.find(tab => tab.id === query)?.id
  if (requested === 'all') return requested
  return selected ? archiveCategory(selected) : requested ?? 'sales'
}

export function buildArchive(calls: CallRow[]) {
  const ordered = [...calls].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
  const lists: Record<ArchiveTab, CallRow[]> = { sales: [], clients: [], other: [], all: [] }
  const byId = new Map<string, CallRow>()
  const imports = new Map<string, CallRow>()
  for (const call of ordered) {
    // Some RISE recordings were imported twice with different provider IDs.
    // Require identical meeting and extracted details and keep both links valid.
    if (call.source === 'fathom-risedtc' && call.title && call.date && call.duration_minutes && call.participants?.length) {
      const key = JSON.stringify([
        call.title, call.date, call.duration_minutes, call.participants, call.summary, call.action_items, call.brief,
        call.topics, call.follow_up_draft, call.follow_up_sent, call.meeting_type, call.calendar_event_id, call.talk_stats, call.call_review,
      ])
      const existing = imports.get(key)
      if (existing) {
        byId.set(call.id, existing)
        continue
      }
      imports.set(key, call)
    }
    byId.set(call.id, call)
    lists.all.push(call)
    lists[archiveCategory(call)].push(call)
  }
  return { lists, byId }
}

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function archiveActions(call: CallRow): ActionItem[] {
  const unique = new Map<string, ActionItem>()
  for (const item of actionItems(call)) {
    const owner = normalize(item.owner ?? '')
    const unassigned = !owner || /^(?:unclear|unknown|unassigned|tbd|n\/a)$/.test(owner)
    const key = JSON.stringify([item.mine ? 'ivan' : unassigned ? '' : owner, normalize(item.action).replace(/[.!?]+$/, ''), normalize(item.due ?? '')])
    if (!unique.has(key) || (!unique.get(key)?.why && item.why)) {
      unique.set(key, unassigned ? { ...item, owner: null } : item)
    }
  }
  return [...unique.values()]
}
