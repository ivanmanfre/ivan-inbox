/* ==========================================================================
   src/wb/ask/Overflow.tsx — the composer plate's own overflow menu.

   Ivan, 2026-09-12: "i feel like UI could be cleaner on claude chat.... and
   smoother looking...."

   The drawer was stacking four bands of chrome before the first message, and
   two of them existed for controls pressed a few times a week: the model
   picker (in the head, beside the close) and "Run on the runner" (a whole
   standalone line above the composer). Both are properties of the NEXT TURN,
   which is exactly what the composer is, so both moved INSIDE the plate,
   behind one `+` in the left cluster beside the attach mark.

   This component owns nothing but the open/closed flag. The runner's items
   come from `Runner.tsx` (`RunnerMenuItems`) and the model's from whichever
   host passed `extras.menu`, so neither vocabulary is copied here.
   ========================================================================== */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconButton, Popover } from '../../ds'
import { RunnerMenuItems, type RunnerHandle } from './Runner'
import './ask.css'

export function Overflow({ runner, text, onSent, menu }: {
  /** Present only where the runner has no strip of its own (the desktop
   * drawer). The phone keeps its strip, so it passes nothing here and the
   * menu never says the same thing twice. */
  runner?: RunnerHandle
  text: string
  onSent: () => void
  /** The host's own items — the docked pane's model picker. */
  menu?: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  if (!runner && !menu) return null
  return (
    <span className="a-brain-more">
      <IconButton
        icon="add"
        size="sm"
        label="More: the model, and the runner"
        active={open}
        onClick={() => setOpen(v => !v)}
      />
      <Popover open={open} label="Model, and the runner" className="a-brain-moremenu">
        {/* The model first: it is one short list and the thing most often
            looked at. The runner's goal specs are forty rows off a disk
            listing, so they go under it rather than pushing it off screen. */}
        {menu && (
          <>
            <div className="a-brain-moreh">Model</div>
            {menu(close)}
          </>
        )}
        {runner && (
          <>
            <div className="a-brain-moreh">Run</div>
            <RunnerMenuItems runner={runner} text={text} onSent={onSent} open={open} close={close} />
          </>
        )}
      </Popover>
    </span>
  )
}
