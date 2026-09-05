/* ==========================================================================
   src/wb/chrome/Avatar.tsx: S44-1, on the design system.

   Rebuilt from src/components/Avatar.tsx. The initials and the deterministic
   bucket are the same functions, byte for byte; what changed is what a bucket
   BUYS. The old one painted a saturated gradient per bucket, which is a
   category drawn as colour and the one thing SYSTEM §1 forbids. The ds Avatar
   has four low-alpha identity tints, so the same hash picks a tint instead, and
   the channel stays legible as a MARK rather than as a hue.

   The old copy stays on disk for `#exp/stock` (DECISIONS D2).
   ========================================================================== */
import { Avatar as DsAvatar, Icon } from '../../ds'
import './chrome.css'

type Channel = 'linkedin' | 'linkedin_inmail' | 'email'

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Identity, as one of four tints. Four buckets, not six: the system has four. */
function tintFor(name: string): 1 | 2 | 3 | 4 {
  return ((hashName(name) % 4) + 1) as 1 | 2 | 3 | 4
}

export function Avatar({ name, channel, size = 'md' }: {
  name: string
  client_id?: string
  channel: Channel
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className="a-av">
      <DsAvatar name={name} initials={initials(name)} tint={tintFor(name)} size={size} />
      {/* The channel badge. A drawn mark, not a glyph: `in` was two letters
          pretending to be an icon and the envelope was a unicode character. */}
      <span className="a-av-badge" aria-hidden>
        <Icon name={channel === 'email' ? 'mail' : 'dms'} size={16} />
      </span>
    </span>
  )
}
