import { SettingsScreen } from '../../screens/SettingsScreen'

// Settings left the tab bar in this candidate — it's reached from a gear
// button in ContentScreen's header and pushed as a full-screen takeover, same
// idiom as ThreadScreen's back chevron. SettingsScreen itself is reused
// completely unchanged (it still renders its own "Settings" large title below
// this bar); only a slim back affordance is added above it, because the shared
// screen can't be told to suppress its own nav without editing it.
export function SettingsPush({ onBack }: { onBack: () => void }) {
  return (
    <div className="ct-overlay">
      <div style={{ padding: '14px 22px 0' }}>
        <span className="back" onClick={onBack}>‹ Back</span>
      </div>
      <SettingsScreen />
    </div>
  )
}
