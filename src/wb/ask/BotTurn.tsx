/* ==========================================================================
   src/wb/ask/BotTurn.tsx: what a bot turn's QUESTION looks like.

   A bot turn's prompt is not a question Ivan asked. It is the bundle the tick
   assembled: one line per feed row it read. Rendering it as his own right-hand
   bubble would put words in his mouth and spend half the screen on a machine
   listing, so it collapses to one quiet chip that says how many events are
   under it.

   D7: expanding does NOT parse the prose back into rows. It reads the rows
   themselves (`group_key = 'bot:<turn id>'`), including the dismissed ones,
   because those rows already carry the title, the time and the url, and a
   second copy derived from a prompt is a copy that can drift.
   ========================================================================== */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Chip, fadeT, rise, spring } from '../../ds'
import { Row, Rows } from '../kit'
import { listGroupRows, notificationDeepLink, type Notification } from '../../lib/turns'
import { clock } from './parts'

/**
 * The label. Every bundle line starts with `[` (the tick writes
 * `[family · severity · tenant · count×] title — body (url)`), so counting
 * those lines is counting the rows the model was handed. A bundle whose shape
 * this does not recognise says `Feed rows` rather than claiming a number it
 * cannot stand behind.
 */
export function eventCount(prompt: string): number {
  return (prompt ?? '').split('\n').filter(l => l.trimStart().startsWith('[')).length
}

export function bundleLabel(prompt: string): string {
  const n = eventCount(prompt)
  return n > 0 ? `${n} event${n === 1 ? '' : 's'}` : 'Feed rows'
}

function openRow(n: Notification): void {
  const raw = (n.url ?? '').trim()
  if (/^https:/i.test(raw)) { window.open(raw, '_blank', 'noreferrer'); return }
  location.hash = notificationDeepLink(n)
}

export function BotBundle({ turnId, prompt }: { turnId: string; prompt: string }) {
  const [open, setOpen] = useState(false)
  // Fetched on the FIRST expand and kept: a chip toggled twice should not cost
  // two round trips, and these rows do not change under him while he reads.
  const [rows, setRows] = useState<Notification[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!next || rows || loading) return
    setLoading(true)
    void (async () => {
      try { setRows(await listGroupRows(`bot:${turnId}`)) } catch { setRows([]) } finally { setLoading(false) }
    })()
  }

  return (
    <div className="a-brain-bundle" data-bundle data-turn-bundle={turnId}>
      <Chip icon={open ? 'discloseUp' : 'disclose'} selected={open} onClick={toggle}>
        {bundleLabel(prompt)}
      </Chip>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a-brain-bundle-rows"
            variants={rise}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: fadeT }}
            transition={spring}
          >
            <Rows>
              {rows?.map(n => (
                <Row
                  key={n.id}
                  title={n.title}
                  titleWrap
                  tail={<span className="a-mono">{clock(n.last_seen_at || n.created_at)}</span>}
                  onClick={() => openRow(n)}
                />
              ))}
              {rows && rows.length === 0 && (
                <Row title={loading ? 'Reading the rows…' : 'Those rows are gone from the feed.'} titleWrap />
              )}
              {!rows && <Row title="Reading the rows…" titleWrap />}
            </Rows>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
