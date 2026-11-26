import { assert, test } from 'vitest'
import { asksAboutStuckReplies, describeStuckReplies } from './stuck-replies.ts'

test('only short cross-seat status questions take the direct route', () => {
  for (const question of ['Any stuck DMs?', 'Which replies are stuck?', 'Check for stuck outreach replies across all seats.']) assert(asksAboutStuckReplies(question))
  for (const question of ['Write a post about stuck DMs', 'Any stuck replies for Mattan?', 'Check for stuck replies and send them', 'Draft the email']) assert(!asksAboutStuckReplies(question))
})

test('links to the prospect and distinguishes queues and missing drafts', () => {
  assert(describeStuckReplies([]).includes('approval'))
  const text = describeStuckReplies([
    { kind: 'overdue_reaction_queue', seat: 'swishdm', prospect_id: 'p1', person: 'Kieran' },
    { kind: 'missing_reply_draft', seat: 'arch', prospect_id: 'p2', person: 'A](unwanted)' },
  ])
  assert(text.includes('thread=p1) (SwishDM)'))
  assert(text.includes('still queued'))
  assert(text.includes('active draft'))
  assert(!text.includes('](unwanted)'))
})

test('empty status explains a paused sender', () => {
  const text = describeStuckReplies([], 0, 'paused')
  assert(text.includes('sender is paused'))
  assert(!text.includes('no overdue SwishDM'))
})
