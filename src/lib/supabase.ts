import { createClient } from '@supabase/supabase-js'
import { SESSION_KEY, deleteHandoff, readHandoff, writeHandoff } from './handoff'
import { makePageStorage } from './sessionStorage'
import { timedFetch } from './noAnswer'

// Page context only (see src/lib/sessionStorage.ts). The worker has no
// localStorage and gets supabase-js's default memory storage instead.
const pageStorage = typeof localStorage === 'undefined' ? undefined : makePageStorage({
  local: localStorage,
  readWorker: () => readHandoff<string>(SESSION_KEY),
  writeWorker: v => writeHandoff(SESSION_KEY, v),
  deleteWorker: () => deleteHandoff(SESSION_KEY),
})
if (pageStorage && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pageStorage.consultWorkerAgain()
  })
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Implicit flow (token in the URL fragment) so a magic link opened in
      // Safari still lands a session even though the installed PWA's storage is
      // partitioned from Safari — PKCE would need the code_verifier that lives in
      // the PWA's storage and fail cross-context. Keep the default storageKey so
      // existing signed-in sessions are not orphaned on deploy.
      detectSessionInUrl: true,
      flowType: 'implicit',
      storage: pageStorage,
    },
    // Every database read and write settles (src/lib/noAnswer.ts): a hung request used to grey Send
    // in every thread until a relaunch (Ivan 10-21, Diane O'Brien).
    global: { fetch: (input, init) => timedFetch(input, init) },
  },
)

// Ask the browser to stop evicting our token (iOS/Safari 7-day ITP cap).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist() })
}
