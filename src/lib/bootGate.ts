/**
 * What the app paints while Supabase resolves the session on boot.
 *
 * `supabase.auth.getSession()` is local when the access token is fresh, but the
 * token expires hourly, so every reopen after a few hours away goes to the
 * network to refresh BEFORE the first pixel. On cellular that was the black
 * frame Ivan sat through (2026-09-14: "takes a chunk to load"). A session in
 * localStorage is enough to paint the shell and the saved copy; if the refresh
 * then fails, `ready` flips with no session and the login screen takes over.
 */
export function bootGate(s: { ready: boolean; hasSession: boolean; storedUser: boolean }): 'blank' | 'login' | 'app' {
  if (s.ready) return s.hasSession ? 'app' : 'login'
  return s.storedUser ? 'app' : 'blank'
}
