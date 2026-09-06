/* ==========================================================================
   src/wb/sheets/PushLater.tsx — S20, the push-later sheet, on the design
   system.

   The contract is the old provider's, byte for byte: `usePushLater(name)`
   returns a promise, a preset resolves it with `snoozeTarget(days)`, the
   custom picker resolves it with a local-time ISO instant, and the scrim,
   Cancel and a flick all resolve it null. Both providers answer the SAME
   context (src/lib/pushLater.ts), so no call site moved and `#exp/stock`
   keeps its iOS sheet.

   What changed is the surface, from `efferd/drawer` in the panes PICKS: the
   grip, the title with its consequence under it, then divider rhythm —
   presets, custom time, decision — instead of one undifferentiated stack.
   Each preset is a row that says the label AND the exact instant it resolves
   to, because the whole decision is "what date does this come back on" and
   reading "1 week" without its date is reading half of it.

   ONE SHEET, TWO SHELLS: ds `Sheet` above and below 767px alike. The old one
   was a bottom sheet at 1440 too; it stays a sheet here because the sheet's
   own foot is where the decision belongs, and Cancel is the flick.
   ========================================================================== */
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Divider, Input, Sheet } from '../../ds'
import { SNOOZE_PRESETS, snoozeTarget } from '../../lib/inbox'
import {
  PushCtx, formatReturn, fromLocalInput, toLocalInput, type PendingPush,
} from '../../lib/pushLater'
import './sheets.css'

export { usePushLater } from '../../lib/pushLater'

export function PushLaterProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPush | null>(null)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')

  const ask = useCallback((name: string) => {
    return new Promise<string | null>(resolve => {
      // Seed the custom field with the middle preset so the picker opens on a
      // sane date instead of on 1970 or on right now.
      setCustom(toLocalInput(new Date(snoozeTarget(7))))
      setPending({ name, resolve })
      setOpen(true)
    })
  }, [])

  // The promise settles the instant he answers; the exit is AnimatePresence's,
  // so a second answer inside the 180ms leave finds no pending row to resolve.
  const settle = useCallback((until: string | null) => {
    setPending(cur => { cur?.resolve(until); return null })
    setOpen(false)
  }, [])

  const customIso = fromLocalInput(custom)
  const firstName = pending ? pending.name.split(' ')[0] : ''

  return (
    <PushCtx.Provider value={ask}>
      {children}
      <Sheet
        open={open}
        onClose={() => settle(null)}
        title="Push this draft to later"
        sub={pending ? (
          <>
            It leaves your queue and comes back on the date you pick. Nothing is
            sent and nothing is thrown away. If {firstName} writes back before
            then, it returns straight away.
          </>
        ) : undefined}
        foot={<Button variant="quiet" block onClick={() => settle(null)}>Cancel</Button>}
      >
        <div className="a-push">
          <Divider />
          <div className="a-push-presets">
            {SNOOZE_PRESETS.map(p => {
              const at = snoozeTarget(p.days)
              return (
                <button
                  key={p.key}
                  type="button"
                  className="a-push-preset"
                  onClick={() => settle(at)}
                >
                  <span className="a-title-t">{p.label}</span>
                  <span className="a-mono a-dim">{formatReturn(at)}</span>
                </button>
              )
            })}
          </div>
          <Divider />
          <div className="a-push-custom">
            <Input
              type="datetime-local"
              label="Custom return time"
              mono
              value={custom}
              onChange={e => setCustom(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={customIso === null}
              onClick={() => { if (customIso) settle(customIso) }}
            >
              Push
            </Button>
          </div>
        </div>
      </Sheet>
    </PushCtx.Provider>
  )
}
