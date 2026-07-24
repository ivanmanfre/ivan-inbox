import { createClient } from '@supabase/supabase-js'

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
    },
  },
)

// Ask the browser to stop evicting our token (iOS/Safari 7-day ITP cap).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist() })
}
