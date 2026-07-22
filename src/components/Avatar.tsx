type Channel = 'linkedin' | 'linkedin_inmail' | 'email'

const GRADS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']

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

export function Avatar({ name, channel, size }: {
  name: string; client_id?: string; channel: Channel; size?: number
}) {
  const g = GRADS[hashName(name) % GRADS.length]
  const badge = channel === 'email' ? '✉' : 'in'
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined
  return (
    <div className={`av ${g}`} style={style}>
      {initials(name)}
      <span className="badge">{badge}</span>
    </div>
  )
}
