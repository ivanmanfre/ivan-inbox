import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // needed for the magic-link callback
      storageKey: 'inbox-auth',
      flowType: 'pkce',
    },
  },
)

// Ask the browser to stop evicting our token (iOS/Safari 7-day ITP cap).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist() })
}
