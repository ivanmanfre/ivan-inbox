import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function LoginScreen() {
  const [email, setEmail] = useState(() => localStorage.getItem('inbox-email') ?? '')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [err, setErr] = useState('')
  const [linkSent, setLinkSent] = useState(false)

  async function sendCode() {
    localStorage.setItem('inbox-email', email)
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) setErr(error.message); else { setErr(''); setStage('code') }
  }
  async function sendLink() {
    localStorage.setItem('inbox-email', email)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) setErr(error.message); else { setErr(''); setLinkSent(true) }
  }
  async function verify() {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) setErr(error.message)
  }

  return (
    <div className="login">
      <h2>Inbox</h2>
      {stage === 'email' ? (
        <>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" inputMode="email" />
          <button className="btn p" onClick={sendCode}>Send code</button>
          <button className="btn s" onClick={sendLink}>Email me a link instead</button>
          {linkSent && <p className="hint">Check your email — tap the link to sign in.</p>}
        </>
      ) : (
        <>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
          <button className="btn p" onClick={verify}>Sign in</button>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  )
}
