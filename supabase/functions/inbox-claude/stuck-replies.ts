// A short status question reads the same evidence as the scheduled check.
// Named people, requests to act, and questions with extra context stay with the agent.
export function asksAboutStuckReplies(prompt: string): boolean {
  const question = prompt.toLowerCase().trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ')
  return /^(?:(?:do (?:i|we) have|are there|show me|check for|list) (?:any |the )?|any |which |what )?(?:stuck (?:outreach )?(?:replies|dms)|(?:replies|dms) (?:are )?stuck)(?: (?:right now|today|across (?:all )?seats))?$/.test(question)
}

export type StuckReply = {
  seat: string
  prospect_id: string
  person: string
  kind: 'missing_reply_draft' | 'overdue_reaction_queue'
}

const seats: Record<string, string> = { ivan: 'Ivan', rise: 'RISE', risedtc: 'RISE', arch: 'Arch', swishdm: 'SwishDM', anna: 'Anna', leah: 'Leah' }

export function describeStuckReplies(rows: StuckReply[], total = rows.length, queueStatus = 'checked'): string {
  const queueNote = queueStatus === 'checked' ? '' : queueStatus === 'paused' || queueStatus === 'disabled'
    ? ' I skipped the SwishDM queue check because its sender is ' + queueStatus + '.'
    : ' The SwishDM sender settings were unavailable, so I could only check for missing replies.'
  if (!rows.length) return 'I checked the past two weeks across all six seats. I found no flagged requests still missing a reply after 48 hours.' +
    (queueNote || ' I found no overdue SwishDM reaction openers.') + ' Drafts waiting for your approval are in DMs.'
  const lines = rows.slice(0, 10).map(row => {
    const name = row.person?.replace(/[^\p{L}\p{M}\p{N} ’'.-]/gu, ' ').trim() || 'Open conversation'
    const link = 'https://ivanmanfre.github.io/ivan-inbox/#exp/d/dms?thread=' + encodeURIComponent(row.prospect_id)
    const issue = row.kind === 'overdue_reaction_queue' ? 'The approved opener is still queued after four hours of sending time.' : 'The request is at least 48 hours old. I found no sent reply or active draft for it.'
    return '- [' + name + '](' + link + ') (' + (seats[row.seat] ?? 'Outreach') + '). ' + issue
  })
  const rest = total - lines.length
  return 'I found ' + total + (total === 1 ? ' thread' : ' threads') + ' to check.\n\n' + lines.join('\n') +
    (rest ? '\n\nShowing the ten oldest.' : '') + queueNote
}
