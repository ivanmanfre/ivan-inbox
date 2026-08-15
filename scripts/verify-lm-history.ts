// Proves the LEAD MAGNET rows survive the app's OWN predicates, using live view rows
// rather than fixtures. Run: npx vite-node scripts/verify-lm-history.ts
// inbox.ts pulls in the supabase client, which constructs a realtime client at import
// time and needs a global WebSocket (node 20 has none). Stub before the dynamic import.
// @ts-expect-error - test shim
globalThis.WebSocket ??= class { close() {} } as unknown as typeof WebSocket
const { groupThreads, filterThreads, isLeadMagnet, filterByStatus, inboxWaitingCount } = await import('../src/lib/inbox')
type InboxMessage = Awaited<ReturnType<typeof import('../src/lib/inbox')['fetchMessages']>>[number]

const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1/'
const KEY = process.env.SB_SERVICE_KEY!

const res = await fetch(SB + 'inbox_messages_v?select=*&order=created_at.asc&limit=1000&sent_at=gte.2026-08-14T00:00:00Z',
  { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
const rows = await res.json() as InboxMessage[]
const threads = groupThreads(rows)
const shown = filterThreads(threads, 'all')

console.log('rows', rows.length, '| threads', threads.length, '| pass isConversation', shown.length)
for (const t of shown.filter(isLeadMagnet)) {
  console.log('  LEAD MAGNET ->', t.client_id, '|', t.prospect_name, '|', t.stage,
    '|', t.last.message_text.slice(0, 50).replace(/\n/g, ' '))
}
console.log('in "all" status view:', filterByStatus(shown, 'all').filter(isLeadMagnet).length)
console.log('badge (must not move):', inboxWaitingCount(threads))
