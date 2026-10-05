type Auth = { getUser(token: string): Promise<{ data: { user: { id: string } | null }, error: { status?: number, code?: string } | null }> }

export async function checkForwardUser(auth: Auth, token: string, allowedUser: string): Promise<{ status: number, error: string } | null> {
  if (!token) return { status: 401, error: 'Sign in again to forward email.' }
  const unavailable = { status: 503, error: 'Login verification is temporarily unavailable. The forward was not sent. Try again.' }
  try {
    const { data: who, error } = await auth.getUser(token)
    if (error) {
      // Log classification only. Never record credentials or request bodies.
      console.warn('forward_auth_failed', { status: error.status, code: error.code })
      if ([401, 403].includes(error.status ?? 0)) return { status: 401, error: 'Sign in again to forward email.' }
      return unavailable
    }
    if (!who.user) return { status: 401, error: 'Sign in again to forward email.' }
    if (who.user.id !== allowedUser) return { status: 403, error: 'Email forwarding is available to the inbox owner only.' }
    return null
  } catch {
    console.warn('forward_auth_unavailable')
    return unavailable
  }
}
