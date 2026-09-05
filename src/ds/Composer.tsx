import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { spring } from './motion'
import { IconButton } from './IconButton'
import { cx } from './util'

export type ComposerMode = 'ready' | 'empty' | 'busy' | 'recording'

export interface ComposerProps {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  /** Abort the turn that is running. */
  onStop?: () => void
  onAttach?: () => void
  onDictate?: () => void
  placeholder?: string
  /** 'empty' cannot send · 'busy' shows stop · 'recording' shows the level meter. */
  mode?: ComposerMode
  /** Attachment chips, a link preview, the dictation meter. */
  tray?: ReactNode
  /** One line under the bar: what happens to what you type. */
  note?: ReactNode
  className?: string
}

/**
 * One round control that swaps between send and stop; the bar springs its
 * height as the tray changes. Enter sends.
 */
export function Composer({
  value, onChange, onSend, onStop, onAttach, onDictate,
  placeholder = 'Write a message', mode = 'empty', tray, note, className,
}: ComposerProps) {
  const busy = mode === 'busy'
  const canSend = mode === 'ready' && value.trim().length > 0
  return (
    <div data-ds="Composer" data-mode={mode} className={cx('ds-composer', className)}>
      {tray ? (
        <motion.div layout transition={spring} className="ds-composer-tray">{tray}</motion.div>
      ) : null}
      <motion.div layout transition={spring} className="ds-composer-bar">
        {onAttach ? <IconButton icon="attach" label="Attach a file" size="sm" onClick={onAttach} /> : null}
        <textarea
          className="ds-composer-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSend() }
          }}
        />
        {onDictate && !busy ? (
          <IconButton
            icon="mic"
            label={mode === 'recording' ? 'Stop dictating' : 'Dictate'}
            size="sm"
            active={mode === 'recording'}
            onClick={onDictate}
          />
        ) : null}
        <IconButton
          icon={busy ? 'stop' : 'send'}
          label={busy ? 'Stop' : 'Send'}
          variant={canSend || busy ? 'accent' : 'solid'}
          round
          disabled={!canSend && !busy}
          onClick={busy ? onStop : onSend}
        />
      </motion.div>
      {note ? <div className="ds-composer-note ds-t-meta">{note}</div> : null}
    </div>
  )
}

/** The dictation level meter: deterministic from elapsed time, never random. */
export function LevelMeter({ elapsed, bars = 14 }: { elapsed: number; bars?: number }) {
  return (
    <span data-ds="LevelMeter" className="ds-level" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const h = 4 + Math.round(8 * (1 + Math.sin((elapsed * 4 + i) / 1.7)))
        return <span key={i} className="ds-level-bar" style={{ height: `${h}px` }} />
      })}
    </span>
  )
}
