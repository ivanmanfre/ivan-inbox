/* ==========================================================================
   src/wb/login/index.tsx: S32, the sign-in screen, on the design system.

   Every call is `src/screens/LoginScreen.tsx`'s, byte for byte: the same two
   `signInWithOtp` shapes (one with `emailRedirectTo`, one without), the same
   `verifyOtp`, the same `inbox-email` persistence, the same two stages. What
   changed is that the screen is now made of primitives instead of four bare
   elements on the stock sheet, so it carries the plate, the field, the button
   variants and the error tone the rest of the app carries.

   Used by BOTH shells (DECISIONS D4): App.tsx reaches it before the exp gate,
   so `#exp/stock` signs in through this same component. It is mounted lazily,
   which keeps `src/ds` out of the stock shell's first paint; the stock pixel
   gate runs with a session, so a login screen is never in that diff.
   ========================================================================== */
import { useState } from 'react'
import { Button, Icon, Input } from '../../ds'
import { supabase } from '../../lib/supabase'
import './login.css'

export function Login() {
  const [email, setEmail] = useState(() => localStorage.getItem('inbox-email') ?? '')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [err, setErr] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [busy, setBusy] = useState<'code' | 'link' | 'verify' | null>(null)

  async function sendCode() {
    localStorage.setItem('inbox-email', email)
    setBusy('code')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    setBusy(null)
    if (error) setErr(error.message); else { setErr(''); setStage('code') }
  }
  async function sendLink() {
    localStorage.setItem('inbox-email', email)
    setBusy('link')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    setBusy(null)
    if (error) setErr(error.message); else { setErr(''); setLinkSent(true) }
  }
  async function verify() {
    setBusy('verify')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setBusy(null)
    if (error) setErr(error.message)
  }

  return (
    <div className="a-login ds-body">
      <div className="a-login-plate">
        <span className="a-login-mark" aria-hidden><Icon name="inbox" size={24} /></span>
        <h1 className="ds-t-page">Inbox</h1>
        {stage === 'email' ? (
          <>
            <Input
              label="Email" value={email} inputMode="email" autoComplete="email"
              placeholder="you@example.com"
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && email) void sendCode() }}
            />
            <Button variant="primary" block busy={busy === 'code'} disabled={!email} onClick={() => void sendCode()}>
              Send code
            </Button>
            <Button variant="quiet" block busy={busy === 'link'} disabled={!email} onClick={() => void sendLink()}>
              Email me a link instead
            </Button>
            {linkSent && <p className="ds-t-meta ds-dim">Check your email, tap the link to sign in.</p>}
          </>
        ) : (
          <>
            <Input
              label="Code" value={code} inputMode="numeric" autoComplete="one-time-code" mono
              placeholder="6-digit code"
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && code) void verify() }}
            />
            <Button variant="primary" block busy={busy === 'verify'} disabled={!code} onClick={() => void verify()}>
              Sign in
            </Button>
          </>
        )}
        {err && <p className="a-login-err ds-t-meta">{err}</p>}
      </div>
    </div>
  )
}

export default Login
