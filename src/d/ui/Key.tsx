import type { ComponentPropsWithRef, ReactNode } from 'react'

// THE HARDWARE KEY (D mocks: `.key` = lip + face). One primary (lime) key per
// state at most; every other key is neutral. `verb` becomes `data-verb`, the
// stable hook the write proofs select on: give every write key one.
type Props = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: ReactNode
  primary?: boolean
  /** Red face: the confirm key of an irreversible action (delete, spam, discard, stop contact). */
  danger?: boolean
  /** Small second line under the label (e.g. the key's shortcut, "hold"). */
  sub?: ReactNode
  /** data-verb, e.g. 'approve', 'send', 'clear-all', 'undo', 'reconnect'. */
  verb?: string
  /** 'wide' takes 1.5x the room of a plain key in a row (the mocks' primary). */
  size?: 'plain' | 'wide' | 'small'
}

export function Key({ children, primary, danger, sub, verb, size, className, type = 'button', ...rest }: Props) {
  const cls = ['d-key', primary ? 'd-key-p' : '', danger ? 'd-key-d' : '', size === 'wide' || (primary && size !== 'plain' && size !== 'small') ? 'd-key-w' : '', size === 'small' ? 'd-key-s' : '', className ?? '']
    .filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} data-verb={verb} {...rest}>
      <span className="d-lip" aria-hidden="true" />
      <span className="d-face"><span>{children}{sub != null && <small>{sub}</small>}</span></span>
    </button>
  )
}

/** A small flat button (the mocks' `.btn`): Clear all, Undo, Acknowledge, Dismiss. */
export function Btn({ children, primary, danger, verb, className, type = 'button', ...rest }: Omit<Props, 'sub' | 'size'>) {
  return (
    <button type={type} className={`d-btn${primary ? ' d-btn-p' : ''}${danger ? ' d-btn-d' : ''}${className ? ' ' + className : ''}`} data-verb={verb} {...rest}>
      {children}
    </button>
  )
}
