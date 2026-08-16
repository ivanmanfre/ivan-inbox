// src/lib/* builds the supabase client at module load, and supabase-js constructs
// a RealtimeClient that demands a WebSocket ctor (Node 20 has none). The probe
// never opens a socket — it only calls the pure census functions — so a bare
// constructor is enough to let the import through.
// @ts-expect-error minimal shim
globalThis.WebSocket ??= class { close() {} }
