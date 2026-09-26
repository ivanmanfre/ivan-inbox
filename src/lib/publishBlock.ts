import { queueDraftId } from './calendarItems'
import { label } from './labels'
import type { ContentDraft, ContentStages, ScheduledQueueRow } from './content'

// ---------------------------------------------------------------------------
// A POST THE PUBLISHER REFUSED, said on the draft it belongs to.
//
// Live 2026-09-26: Ivan's Sep 8 post ("Choosing Poland with a business that
// lets me work anywhere") sat at scheduled for 18 days. Its publish-queue row
// is `status='blocked'`, `error_message='publish_lint_fail: stacked_declarations'`:
// the publish lint stopped it before it went out. The queue read filtered
// `blocked` out (QUEUE_STATUSES never listed it), and the draft itself carries
// no trace of the block, so nothing on screen said why the post never went out.
//
// The block lives on scheduled_posts and ONLY there. The draft is joined to it
// by `clickup_task_id`, which carries the draft's uuid (queueDraftId).
// ---------------------------------------------------------------------------

/** Queue statuses that mean "the publisher stopped this post". */
const STOPPED = new Set(['blocked', 'failed'])

// Human words for the lint rules the publish gate names. Anything missing
// falls back to the rule's own words, never the raw code.
const LINT_RULE_WORDS: Record<string, string> = {
  stacked_declarations: 'stacked short declarations',
}

function ruleWords(rule: string): string {
  const r = rule.trim().toLowerCase()
  return LINT_RULE_WORDS[r] ?? r.split(/[_\s]+/).filter(Boolean).join(' ')
}

/**
 * The queue's error_message as a sentence. `publish_lint_fail: a, b` becomes
 * "the lint flagged a and b"; anything else goes through label(), which never
 * lets a bare code reach the screen.
 */
export function publishBlockReason(msg: string | null | undefined): string {
  const m = (msg ?? '').trim()
  const lint = /^publish_lint_fail\s*:?\s*(.*)$/i.exec(m)
  if (lint) {
    const rules = lint[1].split(/[,;]/).map(s => s.trim()).filter(Boolean).map(ruleWords)
    if (rules.length === 0) return 'the publish lint stopped it'
    const list = rules.length === 1
      ? rules[0]
      : `${rules.slice(0, -1).join(', ')} and ${rules[rules.length - 1]}`
    return `the lint flagged ${list}`
  }
  if (!m) return 'the publisher gave no reason'
  const h = label(m)
  return h.charAt(0).toLowerCase() + h.slice(1)
}

/** The line the card prints. */
export function publishStoppedLine(reason: string): string {
  return `Publishing stopped: ${reason}.`
}

/**
 * The queue's own error text, made human where it is a publish block and left
 * alone where it is already a sentence someone wrote.
 */
export function queueErrorText(r: Pick<ScheduledQueueRow, 'status' | 'error_message'>): string {
  const m = (r.error_message ?? '').trim()
  if (STOPPED.has(r.status) || /^publish_lint_fail\b/i.test(m)) {
    return publishStoppedLine(publishBlockReason(m))
  }
  return m
}

/** draft id -> the human reason its publish was stopped. Unposted rows only. */
export function publishBlocksByDraft(queue: ScheduledQueueRow[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of queue) {
    if (!STOPPED.has(r.status) || r.posted_at) continue
    const id = queueDraftId(r)
    if (!id) continue
    out.set(id, publishBlockReason(r.error_message))
  }
  return out
}

/**
 * Re-files every blocked draft that has not gone out into `error`, so the
 * Errors tab lists it and counts it. Published rows are left where they are:
 * a post that went out anyway is not stopped.
 */
export function applyPublishBlocks(
  stages: ContentStages, blocks: Map<string, string>,
): ContentStages {
  if (blocks.size === 0) return stages
  const out = { ...stages }
  const moved: ContentDraft[] = []
  for (const k of Object.keys(out) as (keyof ContentStages)[]) {
    if (k === 'error' || k === 'published') continue
    const keep: ContentDraft[] = []
    for (const d of out[k]) (blocks.has(d.id) && !d.published_at ? moved : keep).push(d)
    out[k] = keep
  }
  out.error = [...moved, ...out.error]
  return out
}
