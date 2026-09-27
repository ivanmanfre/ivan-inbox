/* ==========================================================================
   src/wb/dms/CameBack.tsx — people we already messaged who looked us up and
   never replied.

   Ivan, 2026-09-18: "this should be judged in all clients. me, mattan,
   davoirin". Measured the same day over 60 days of invites: prospects who
   viewed the seat's profile back replied 32.6% vs 7.1% (Ivan), 38.6% vs 7.6%
   (Mattan), 27.3% vs 7.5% (Davorin). The capture lanes already stamped these
   people; every surface read those rows for NEW strangers only, so a prospect
   who came back was written and never shown.

   One compact row per person, all three clients, following the DMs lane
   switch. Tap the row to open the thread; the x dismisses it (the row returns
   only if a NEWER signal lands). NOTHING ON THIS SURFACE SENDS and nothing changes a
   sequence: the scheduled next step still fires on its own clock.
   The data and the pure helpers live in ./cameBackData.ts.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button, Chip, Icon, IconButton } from '../../ds'
import { Group, Row, Rows } from '../kit'
import { Face } from './parts'
import type { Filter } from '../../lib/inbox'
import {
  cameBackLine, cardsFor, dismissCameBack, undismissCameBack, fetchCameBack, firstComment, scanOpenDays, sentLine, tenantLabel,
  type CameBackCard,
} from './cameBackData'
import './dms.css'

export function CameBack({ filter, inboxLoadedAt, onOpenThread }: {
  filter: Filter
  // Re-read when the inbox itself re-read: a reply that just landed removes the row.
  inboxLoadedAt: string | null
  onOpenThread: (id: string) => void
}) {
  const [cards, setCards] = useState<CameBackCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // The last dismiss, with its Undo (DMs rebuild). Replaced by the next one.
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setCards(await fetchCameBack())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read who came back')
    }
  }, [])

  useEffect(() => { void load() }, [load, inboxLoadedAt])

  const shown = useMemo(() => cardsFor(cards ?? [], filter), [cards, filter])

  async function onDismiss(id: string) {
    if (busy) return
    setBusy(id)
    try {
      if (!(await dismissCameBack(id))) throw new Error('could not dismiss')
      setUndo({ id, name: cards?.find(c => c.prospect_id === id)?.name ?? 'them' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss')
    } finally {
      setBusy(null)
    }
  }

  async function onUndo() {
    if (!undo || busy) return
    setBusy(undo.id)
    try {
      if (!(await undismissCameBack(undo.id))) throw new Error('could not undo')
      setUndo(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not undo')
    } finally {
      setBusy(null)
    }
  }

  const undoBar = undo ? (
    <Banner
      icon="remove"
      title={`Dismissed ${undo.name.split(' ')[0]}. They come back on a newer signal.`}
      action={<Button variant="quiet" size="sm" icon="undo" busy={busy === undo.id} onClick={() => { void onUndo() }}>Undo</Button>}
      onDismiss={() => setUndo(null)}
    />
  ) : null

  if (cards === null && !error) return undoBar
  if (shown.length === 0 && !error) return undoBar

  return (
    <section className="a-warm" data-open={open ? '' : undefined} aria-label="Came back">
      {undoBar}
      <Group
        label={<button type="button" className="a-warm-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Icon name={open ? 'collapse' : 'expand'} size={16} />Came back, no reply
        </button>}
        tail={<span className="a-mono">{shown.length}</span>}
        quiet
      >
        {error && <Banner tone="urgent" icon="error">{error}</Banner>}
        {open && shown.length > 0 && (
          <div className="a-warm-group" data-group="came_back">
            {shown.map(c => {
              const client = tenantLabel(c, filter)
              const comment = firstComment(c)
              return (
                <div className="a-warm-card" data-compact="" data-came-back={c.prospect_id} data-tenant={c.tenant} key={c.prospect_id}>
                  <Rows>
                    <Row
                      lead={<Face name={c.name} />}
                      title={<>{c.name}<span className="a-meta"> · {[c.title ?? c.headline, c.company].filter(Boolean).join(' · ')}</span></>}
                      sub={<span className="a-warm-ev"><Icon name={c.n_views > 0 || scanOpenDays(c) > 0 ? 'eye' : 'quote'} size={16} /><span>{cameBackLine(c)}. {sentLine(c)}{comment ? ` “${comment}”` : ''}</span></span>}
                      subWrap
                      tail={<span className="a-warm-tail">
                        {client && <Chip tone="quiet">{client}</Chip>}
                        {c.icp_score !== null && <Chip tone="quiet">ICP {c.icp_score}</Chip>}
                        <IconButton icon="remove" label={`Dismiss ${c.name}`} size="sm" onClick={e => { e.stopPropagation(); void onDismiss(c.prospect_id) }} />
                      </span>}
                      onClick={() => onOpenThread(c.prospect_id)}
                    />
                  </Rows>
                </div>
              )
            })}
          </div>
        )}
      </Group>
    </section>
  )
}
