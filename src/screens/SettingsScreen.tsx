import { supabase } from '../lib/supabase'

export function SettingsScreen() {
  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Settings</h2>
          <div className="avatar-me">IM</div>
        </div>
      </div>
      <div className="rows" style={{ padding: '18px 22px' }}>
        <button className="btn s" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </>
  )
}
