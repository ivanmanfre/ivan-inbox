import { warsaw, type Rendered } from './brief.ts'

// Exact calendar reads can finish even when the writing model is unavailable.
// A planning/strategy question still goes to the writer.
export function requestedWeek(text: string): number | null {
  const question = text.toLowerCase().trim().replace(/[’']/g, "'").replace(/[?.!]+$/, '')
  const match = /^(?:(?:what(?:'s| is| are)|show(?: me)?|list)\s+(?:(?:on|in)\s+)?(?:(?:my|our|the)\s+)?(?:content plan|post plan|content calendar|scheduled posts|posts(?: are scheduled| are going out)?|going out)(?:\s+for)?|what (?:am i|are we) (?:posting|publishing))\s+(this|next) week$/.exec(question)
  return match ? (match[1] === 'this' ? 0 : 1) : null
}

export function weekAnswer(brief: Rendered, index: number) {
  const week = brief.weeks[index]
  const cards = week.dated.flatMap(row => {
    const d = brief.drafts.get(row.handle)
    return d ? [{ id: d.id, handle: row.handle, first_line: d.first_line || d.title, status: d.status, scheduled_at: row.at }] : []
  })
  const body = cards.length
    ? 'Your posts for the week of ' + week.week_start + ' (Warsaw time)\n\n' + cards.map(c =>
      '- ' + warsaw(c.scheduled_at) + ' · ' + c.status + ' · ' + c.first_line).join('\n')
    : 'I found no dated posts on your calendar for the week of ' + week.week_start + '.'
  return { body, cards }
}
