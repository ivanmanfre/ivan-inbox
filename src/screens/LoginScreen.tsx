import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [err, setErr] = useState('')

  async function sendCode() {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) setErr(error.message); else { setErr(''); setStage('code') }
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
