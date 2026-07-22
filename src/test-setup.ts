// supabase-js's realtime client requires a global WebSocket constructor at
// createClient() time. Node 20 (used by this test runner) has no native
// WebSocket, so importing anything that transitively imports src/lib/supabase.ts
// throws before any test code runs. Unit tests here never open a socket, so a
// minimal stub is enough to let module import succeed.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {} as unknown as typeof WebSocket
}
