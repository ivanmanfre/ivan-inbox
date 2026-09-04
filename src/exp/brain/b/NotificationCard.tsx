import type { Notification, NotificationGroup } from '../../../lib/turns'
import {
  answerHeadline, cardLines, FAMILY_LANE, familyLabel, groupStateWord, heroSaysFailed,
  sanitizeBody, severityShape, stateWord,
} from './families'
import { JOB_LABEL } from '../../v2c/layout'

// A tenant chip, drawn ONLY off the row's own `tenant` column — never a guess
// off body text (00-notification-families.md flags that a tenant tag is
// almost never structural in the source corpus; where the pipeline has not
// resolved one, the chip is simply absent rather than invented).
function TenantChip({ tenant }: { tenant: string | null }) {
  if (!tenant) return null
  const label = /rise/i.test(tenant) ? 'RISE' : /arch/i.test(tenant) ? 'ARCH' : /ivan/i.test(tenant) ? 'Mine' : tenant
  return <span className="bb-tenant">{label}</span>
}

function openLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? `Open in ${JOB_LABEL[lane]}` : null
}

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * The two lines under the hero on a `claude_turn` card, in the order they are
 * useful: what came back, then what was asked. Every other family reads its
 * hero out of `stateWord` and its one context line out of `body`; this one
 * family stores those columns the other way round (families.ts §5).
 */
function claudeTurnLines(n: Notification): { hero: string; second: string | null } {
  const hero = answerHeadline(n.body) ?? stateWord(n)
  const asked = (n.title ?? '').trim()
  return { hero, second: asked ? `You asked: ${asked}` : null }
}

/**
 * Drop a caption that argues with the line above it. Only that: a label that
 * ALSO reports the failure is an elaboration, not a contradiction.
 */
function contradicts(lines: { hero: string; sub: string | null }): { hero: string; sub: string | null } {
  if (!lines.sub) return lines
  if (heroSaysFailed(lines.hero) && !heroSaysFailed(lines.sub)) return { hero: lines.hero, sub: null }
  return lines
}

export function NotificationCard({ n, onOpen, onDismiss, nested = false }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  /** A row inside an expanded group. The GROUP already drew the severity mark
   * and the severity rail for this situation; drawing them again on every child
   * says "three separate alarms" where there is one. A nested row keeps its own
   * unread weight and its own dismiss, and nothing else. */
  nested?: boolean
}) {
  const shape = severityShape(n.severity)
  const unread = !n.read_at
  const open = openLabel(n.family)
  const isTurn = n.family === 'claude_turn'
  const turnLines = isTurn ? claudeTurnLines(n) : null
  const body = turnLines ? turnLines.second : (n.body ? sanitizeBody(n.body).slice(0, 140) : null)
  // A nested row's job is to answer "which one of these", not to repeat the
  // state and the family the parent card has already said. So it leads with its
  // own sentence and drops both.
  const hero = turnLines ? turnLines.hero : stateWord(n)
  const lines = nested
    // A nested `claude_turn` row still leads with the ANSWER, not with the
    // question: "You asked: …" under a group that already said "2 answers"
    // shows him his own words twice and the reply not at all.
    ? { hero: turnLines ? turnLines.hero : (body ?? stateWord(n)), sub: null }
    // The family label is a caption, not a contradiction. A turn that came back
    // "The turn failed." was drawn with "Claude answered" under it: two lines
    // saying opposite things about the same event. Where the hero reports a
    // failure and the label does NOT, the label goes away. Where the label
    // says it too ("Failed" under "Drafter failed") cardLines has already
    // collapsed the pair onto the more informative of the two, and that is the
    // line worth keeping.
    : contradicts(cardLines(hero, familyLabel(n.family)))
  const second = nested ? null : body
  return (
    // The WHOLE row takes the tap, mark and severity rail included. With the
    // handler on the text column, 88px of a 338px card — the drawn mark and the
    // rail that carry the severity — were dead to the finger.
    <div
      className={`bb-card${unread ? ' unread' : ''}${nested ? ' bb-nested' : ''}`}
      data-card data-family={n.family} data-shape={nested ? undefined : shape}
      onClick={() => onOpen(n)}
    >
      {!nested && <div className="bb-mark" data-shape={shape}><i /></div>}
      <div className="bb-card-body">
        <span className={`bb-card-word${isTurn || nested ? ' bb-card-sentence' : ''}${nested ? ' bb-card-line' : ''}`}>{lines.hero}</span>
        {lines.sub && <span className="bb-card-who">{lines.sub}</span>}
        {second && <span className="bb-card-body-l">{second}</span>}
        <div className="bb-card-meta">
          <TenantChip tenant={n.tenant} />
          <span>{clock(n.last_seen_at || n.created_at)}</span>
        </div>
        {open && (
          <div className="bb-card-actions">
            <button type="button" className="bb-card-open" onClick={e => { e.stopPropagation(); onOpen(n) }}>{open}</button>
          </div>
        )}
      </div>
      <button type="button" className="bb-card-dismiss" aria-label="Dismiss" onClick={e => { e.stopPropagation(); onDismiss(n.id) }}>✕</button>
    </div>
  )
}

/**
 * A folded group. REBUILT for Phase 3: the parent is a card of its own, at full
 * width, and the children stack BELOW it rather than beside it. In the
 * tournament build `bb-group-items` was a flex sibling inside the parent's own
 * `display:flex` row, so expanding a group squeezed the parent's text column to
 * about four characters wide.
 *
 * The count is the group's ONE number (families.ts §6). The expand control is a
 * verb, never a second count.
 */
export function GroupCard({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification) => void
  onDismissAll: () => void
  onDismissOne: (id: string) => void
}) {
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  const isTurn = g.family === 'claude_turn'
  const latestLine = isTurn
    ? claudeTurnLines(g.latest).hero
    : g.latest.body ? sanitizeBody(g.latest.body).slice(0, 140) : null
  return (
    <div className={`bb-group${open ? ' open' : ''}`} data-group data-family={g.family}>
      <div
        className={`bb-card${unread ? ' unread' : ''}`}
        data-card data-family={g.family} data-shape={shape}
        onClick={onToggle}
      >
        <div className="bb-mark" data-shape={shape}><i /></div>
        <div className="bb-card-body">
          {/* No family line: the counted noun already names the family in
              words ("3 drafts waiting"), and no body line while the group is
              open, because the first row below it is that same sentence. */}
          <span className="bb-card-word">{groupStateWord(g.count, g.family)}</span>
          {!open && latestLine && <span className="bb-card-body-l">{latestLine}</span>}
          <div className="bb-card-meta">
            <TenantChip tenant={g.latest.tenant} />
            <span>latest {clock(g.lastSeenAt)}</span>
          </div>
          <div className="bb-card-actions">
            <button
              type="button" className="bb-group-toggle" aria-expanded={open}
              onClick={e => { e.stopPropagation(); onToggle() }}
            >{open ? 'Hide these' : 'Show each one'}</button>
          </div>
        </div>
        <button type="button" className="bb-card-dismiss" aria-label="Dismiss all" onClick={e => { e.stopPropagation(); onDismissAll() }}>✕</button>
      </div>
      <div className={`bb-group-items${open ? ' open' : ''}`}>
        {open && g.items.map(item => (
          <NotificationCard key={item.id} n={item} onOpen={onOpen} onDismiss={onDismissOne} nested />
        ))}
      </div>
    </div>
  )
}
