import { useState } from 'react'
import type { Turn } from '../../exp/v2c/chat/events'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../exp/brain/b/brainMeta'
import { parseActions, type Action } from '../../wb/ask/actions'
import { createBotTask } from '../../lib/ops'
import { dismissGroup, listGroupRows, notificationDeepLink, restoreNotifications } from '../../lib/turns'
import { useToast } from '../ui/toast'
import { Btn } from '../ui/Key'
import { Markdown } from './Markdown'
import { Steps } from './Steps'

// One answer: the steps it took, the prose, what it was grounded on, and (on
// Claude's own thread) the action keys the bot offered. Every write here is
// one today's app already makes, through the same lib calls.

/** "Read 7 memory files · grounded on 2026-09-06" (today's two facts, one line). */
export function sourcesLine(t: Pick<Turn, 'sources'>): string | null {
  const s = [sourcesChipLabel(t.sources), groundedClause(t.sources)].filter(Boolean).join(' · ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null
}

function Sources({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false)
  const line = sourcesLine(turn)
  if (!line) return null
  const names = sourceBasenames(turn.sources)
  return (
    <div className="dcl-src">
      <button type="button" aria-expanded={open} disabled={names.length === 0} onClick={() => setOpen(o => !o)}>{line}</button>
      {open && <ol>{names.map(n => <li key={n}>{n}</li>)}</ol>}
    </div>
  )
}

function openUrl(url: string): void {
  if (/^https:/i.test(url)) { window.open(url, '_blank', 'noreferrer'); return }
  location.hash = notificationDeepLink({ url })
}

const VERB: Record<Action['kind'], string> = { open: 'action-open', reply: 'action-reply', task: 'action-task', fold: 'action-fold' }

function BotActions({ turnId, actions, setText }: { turnId: string; actions: Action[]; setText: (v: string) => void }) {
  const toast = useToast()
  const [done, setDone] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const run = (a: Action, i: number) => {
    if (done[i] || busy === i) return
    if (a.kind === 'open') { openUrl(a.payload.url); return }
    if (a.kind === 'reply') { setText(a.payload.prompt); return }
    setBusy(i)
    if (a.kind === 'task') {
      void createBotTask(turnId, i, a.payload.title, a.payload.body).then(ok => {
        setBusy(null)
        if (ok) setDone(d => ({ ...d, [i]: 'Added to Ops' }))
        else toast.show({ message: 'Could not add that task. Nothing changed.', tone: 'failed' })
      })
      return
    }
    const key = `bot:${turnId}`
    void (async () => {
      try {
        const rows = await listGroupRows(key)
        const ids = rows.filter(r => !r.dismissed_at).map(r => r.id)
        await dismissGroup(key)
        setDone(d => ({ ...d, [i]: `${ids.length} folded` }))
        toast.show({
          message: `${ids.length} folded`,
          action: { label: 'Undo', verb: 'undo', run: () => { void restoreNotifications(ids); setDone(d => { const n = { ...d }; delete n[i]; return n }) } },
        })
      } catch {
        toast.show({ message: 'Could not fold those. Nothing changed.', tone: 'failed' })
      } finally { setBusy(null) }
    })()
  }
  return (
    <div className="dcl-acts">
      {actions.map((a, i) => done[i]
        ? <span key={i} className="dcl-act-done">{done[i]}</span>
        : <Btn key={i} verb={VERB[a.kind]} disabled={busy === i} onClick={() => run(a, i)}>{a.label}</Btn>)}
    </div>
  )
}

export function Answer({ turn, setText, onRetry, canRetry }: {
  turn: Turn
  setText: (v: string) => void
  onRetry: () => void
  canRetry: boolean
}) {
  const bot = turn.origin === 'bot'
  const parsed = bot ? parseActions(turn.text || '') : null
  const body = parsed ? parsed.body : turn.text
  return (
    <div className="dcl-ans" data-turn={turn.turnId}>
      <Steps calls={turn.tools} live={false} t0={null} />
      {body && <Markdown text={body} />}
      {turn.aborted && <div className="dcl-note">Stopped. What came in before the stop is kept.</div>}
      {turn.error && (
        <div className="dcl-fail" role="alert">
          <span>{turn.error.message}</span>
          {turn.error.retryable && canRetry && <Btn verb="retry" onClick={onRetry}>Retry</Btn>}
        </div>
      )}
      <Sources turn={turn} />
      {parsed && turn.turnId && parsed.actions.length > 0 && <BotActions turnId={turn.turnId} actions={parsed.actions} setText={setText} />}
    </div>
  )
}
