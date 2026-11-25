import { memo, lazy, Suspense, useEffect, useState } from 'react'
import type { Turn } from '../../exp/v2c/chat/events'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../exp/brain/b/brainMeta'
import { parseActions, type Action } from '../../wb/ask/actions'
import { createBotTask } from '../../lib/ops'
import { dismissGroup, listGroupRows, notificationDeepLink, restoreNotifications, type Notification } from '../../lib/turns'
import { useToast } from '../ui/toast'
import { Btn } from '../ui/Key'
import { Markdown, buildCites } from './Markdown'
import { LinkCard } from './LinkCard'
import { detectLinks } from '../../lib/unfurl'
import { buildRecallCommand } from '../../exp/brain/b/recall'
import { errorCopy, THREAD_BUSY_RE, turnMetaLine, bundleLabel } from './model'
import { warsawHm } from '../ui/time'
import { CIcon } from './icons'
import { Mail, ArrowUpRight } from 'lucide-react'
import { Steps } from './Steps'

const ContentArtifact = lazy(() => import('./ContentArtifact').then(m => ({ default: m.ContentArtifact })))

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

function BotActions({ turnId, actions, setText, offline }: { turnId: string; actions: Action[]; setText: (v: string) => void; offline: boolean }) {
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
        : <Btn key={i} verb={VERB[a.kind]} disabled={busy === i || (offline && a.kind !== 'reply')} onClick={() => run(a, i)}>{a.label}{a.kind === 'open' && <ArrowUpRight size={15} aria-hidden="true" />}</Btn>)}
    </div>
  )
}

/** Today's BotTurn rule: an https row opens in a new tab, anything else is an in-app address. */
function openRow(n: Notification): void {
  const raw = (n.url ?? '').trim()
  if (/^https:/i.test(raw)) { window.open(raw, '_blank', 'noreferrer'); return }
  location.hash = notificationDeepLink(n)
}

function Bundle({ turnId, prompt }: { turnId: string; prompt: string }) {
  const [rows, setRows] = useState<Notification[] | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = () => {
    setOpen(o => !o)
    if (rows) return
    void listGroupRows(`bot:${turnId}`).then(setRows, () => setRows([]))
  }
  return (
    <div className="dcl-bundle">
      <button type="button" aria-expanded={open} onClick={toggle}>{bundleLabel(prompt)}</button>
      {open && (
        <div className="dcl-bundle-rows">
          {!rows && <div className="dcl-dim">Reading the rows…</div>}
          {rows && rows.length === 0 && <div className="dcl-dim">Those rows are gone from the feed.</div>}
          {rows?.map(n => (
            <button type="button" key={n.id} onClick={() => openRow(n)}><span>{n.title}</span><time>{warsawHm(n.last_seen_at || n.created_at)}</time></button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Copy the answer, and Ask again on the newest good answer (today's TurnFoot). */
function Foot({ text, onAgain, offline }: { text: string; onAgain?: () => void; offline: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])
  if (!text && !onAgain) return null
  return (
    <div className="dcl-foot-k">
      {text && <button type="button" className="dcl-link" data-verb="copy-answer" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copied' : 'Copy'}</button>}
      {onAgain && <button type="button" className="dcl-link" data-verb="ask-again" disabled={offline} onClick={onAgain}>Ask again</button>}
    </div>
  )
}

export const Answer = memo(function Answer({ request = '', turn, setText, onRetry, last, busy, offline, send }: {
  turn: Turn
  request?: string
  setText: (v: string) => void
  onRetry: () => void
  /** The newest answer: the only one that carries Retry / Ask again (chat.retry replays the last ask). */
  last: boolean
  busy: boolean
  offline: boolean
  /** A recall noun asks Claude to recall it (today's buildRecallCommand). */
  send: (text: string, scanAlertTurnId?: string) => void
}) {
  const [details, setDetails] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const artifact = turn.sources?.find(s => s.kind === 'content_desk' || s.kind === 'content_choice')
  const bot = turn.origin === 'bot'
  const parsed = bot ? parseActions(turn.text || '') : null
  const body = parsed ? parsed.body : turn.text
  const meta = turnMetaLine(turn)
  const busyRefusal = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  const scheduled = bot && !!request && !artifact
  const report = body || ''
  const actionLine = scheduled ? /(?:^|\n)Needs you:\s*\n[-*]\s+([^\n]+)/i.exec(report)?.[1] : undefined
  const lead = actionLine ?? report.trim().split(/\n\s*\n/)[0]
  const compact = scheduled && lead.length > 0 && lead.length < report.trim().length && report.length > 300
  const folded = compact && !expanded && !(turn.error && details)
  const link = details ? detectLinks(report)[0]?.url : undefined
  const failedCheck = scheduled && !!turn.error
  // Earlier scan alerts are stored as prose. Match the watcher's exact template
  // before offering a named private draft from this particular message.
  const scan = bot && turn.sources?.some(s => s.kind === 'rise_scan_watch')
    ? /^([\p{L}][\p{L}\p{M} .’'-]{0,100}?) supplied (\S+@\S+) after the scan offer\. Mattan shared the report on LinkedIn\. I checked the connected RISE sender and found no email to that address\. Reply “draft the email” to prepare it here\.$/u.exec(report) : null
  const primary = parsed?.actions[0]
  const relevantAction = folded && primary?.kind === 'open' && primary.label.split(/\s+/).some(word => word.length > 3 &&
    !/^(open|review|show|thread)$/i.test(word) && lead.toLowerCase().includes(word.toLowerCase()))
  const shown = scan ? `${scan[1]} shared ${scan[2]} for the scan. I found Mattan’s LinkedIn message with the report, but no matching email from RISE.` : failedCheck && !details ? 'A scheduled check couldn’t finish.' : folded ? lead : report
  return (
    <div className="dcl-ans" data-turn={turn.turnId}>
      <span className="dcl-author-mark" aria-label="Assistant">✦</span>
      {shown && <Markdown text={shown} cites={buildCites(sourceBasenames(turn.sources))} onRecall={!details || busy ? undefined : n => send(buildRecallCommand(n))} recallOff={offline} />}
      {scan && turn.turnId && <div className="dcl-acts"><Btn verb="draft-scan-email" disabled={offline || busy}
        onClick={() => send(`Draft the RISE scan email for ${scan[1]}.`, turn.turnId)}><Mail size={15} aria-hidden="true" />Draft email</Btn></div>}
      {relevantAction && turn.turnId && primary && <BotActions turnId={turn.turnId} actions={[primary]} setText={setText} offline={offline} />}
      {compact && !turn.error && <button type="button" className="dcl-read-update" aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}>{expanded ? 'Show less' : 'Read full update'}</button>}
      {parsed && !folded && turn.turnId && parsed.actions.length > 0 && <BotActions turnId={turn.turnId} actions={parsed.actions} setText={setText} offline={offline} />}
      {artifact && <Suspense fallback={null}><ContentArtifact key={artifact.path} id={artifact.path} choose={artifact.kind === 'content_choice'} request={request} setText={setText} /></Suspense>}
      {turn.aborted && <div className="dcl-note">Response stopped.</div>}
      {turn.error && (!failedCheck || details) && (
        <div className="dcl-fail" role="alert">
          <span>{errorCopy(turn.error.message)}</span>
          {turn.error.retryable && !bot && !busyRefusal && last && !busy && <Btn verb="retry" disabled={offline} onClick={onRetry}>Retry</Btn>}
        </div>
      )}
      <button type="button" className="dcl-message-options" aria-label="Message details and actions" title="Message details and actions"
        aria-expanded={details} onClick={() => setDetails(v => !v)}><CIcon name="more" /></button>
      {details && <div className="dcl-message-details">
        {meta && <div className="dcl-meta">{meta}</div>}
        <Sources turn={turn} />
        {scheduled && turn.turnId && <Bundle turnId={turn.turnId} prompt={request} />}
        <Steps calls={turn.tools} live={false} t0={null} />
        {link && <LinkCard url={link} />}
        <Foot text={report} offline={offline} onAgain={last && !bot && !turn.error && !busy && !artifact ? onRetry : undefined} />
      </div>}
    </div>
  )
})
