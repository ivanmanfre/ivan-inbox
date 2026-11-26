// Face ID / Touch ID sign-in through Supabase Auth passkeys (2026-11-26).
//
// The project's auth server has passkeys on with relying party
// ivanmanfre.github.io, so a passkey made here works in Safari and in the
// installed home-screen app alike. The email code stays as the way in on a new
// device: a passkey can only be added from a signed-in session.

// Set on this device once a passkey is registered or used, so the login screen
// leads with Face ID instead of the email field.
export const PASSKEY_FLAG = 'inbox-passkey'

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

export function hasPasskeyFlag(): boolean {
  try { return localStorage.getItem(PASSKEY_FLAG) === '1' } catch { return false }
}

export function setPasskeyFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(PASSKEY_FLAG, '1')
    else localStorage.removeItem(PASSKEY_FLAG)
  } catch { /* storage blocked: the screen just leads with email */ }
}

// Closing the Face ID sheet is not an error worth showing.
export function isPasskeyCancel(err: unknown): boolean {
  const e = err as { code?: string; name?: string; cause?: { name?: string } } | null
  if (!e) return false
  return e.code === 'ERROR_CEREMONY_ABORTED'
    || e.name === 'NotAllowedError'
    || e.name === 'AbortError'
    || e.cause?.name === 'NotAllowedError'
    || e.cause?.name === 'AbortError'
}
