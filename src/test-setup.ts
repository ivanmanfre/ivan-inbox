// supabase-js's realtime client requires a global WebSocket constructor at
// createClient() time. Node 20 (used by this test runner) has no native
// WebSocket, so importing anything that transitively imports src/lib/supabase.ts
// throws before any test code runs. Unit tests here never open a socket, so a
// minimal stub is enough to let module import succeed.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {} as unknown as typeof WebSocket
}

// Draft cards fetch a read-only history RPC on mount (src/lib/replyHistory.ts); unit tests never hit the network.
import { vi } from 'vitest'
vi.mock('./lib/replyHistory', async orig => ({ ...(await orig<typeof import('./lib/replyHistory')>()), fetchReplyHistory: vi.fn(async () => null) }))
