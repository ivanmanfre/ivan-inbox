import { cx } from './util'

export interface AvatarProps {
  /** Initials when there is no image. Two letters, never three. */
  initials?: string
  src?: string
  /** The spoken name. An avatar with no name is decoration. */
  name: string
  size?: 'sm' | 'md' | 'lg'
  /** Identity bucket 1 to 4. A tint, never a category mark. */
  tint?: 1 | 2 | 3 | 4
  /** A dot on the corner: this person or peer is live right now. */
  live?: boolean
  className?: string
}

export function Avatar({ initials, src, name, size = 'md', tint = 3, live = false, className }: AvatarProps) {
  return (
    <span
      data-ds="Avatar"
      data-size={size}
      data-tint={tint}
      title={name}
      aria-label={name}
      role="img"
      className={cx('ds-avatar', live && 'ds-avatar-live', className)}
    >
      {src ? <img src={src} alt="" /> : (initials ?? name.slice(0, 2).toUpperCase())}
    </span>
  )
}
