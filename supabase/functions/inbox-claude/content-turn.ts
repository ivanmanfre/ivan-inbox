import { requestedWeek } from '../content-desk/week-answer.ts'

// Only a turn written by the authenticated operator can reach this router.
const OUTREACH = /\b(?:scans?|recipients?|inbox|dms?|emails?|prospects?|senders?|outreach)\b/i
const CONTENT = /\b(?:my|our|the|a|this|that|weekly|linkedin|scheduled|original|draft|a new|last|next|recent|latest) (?:linkedin )?(?:posts?|content (?:plan|calendar)|editorial calendar|post ideas?)\b|\bpost (?:plan|ideas?|calendar|drafts?|performance)|\bwhat (?:should|could|can|do) (?:i|we) post\b|\bwhat(?:['’]s| is) going out this week\b/i
const WRITE = /^(?:(?:please|can you|could you)\s+)?(?:move|date|undate|reschedule|schedule|approve|redo|rewrite|revise|shorten|edit|pull|remove|delete|draft|write|attach|stage|save|add)\b/i
const POINTING = /^(?:please )?(?:move|approve|date|reschedule|schedule|redo|pull|delete) (?:it|this one|that one)(?=\s|[.?!]|$)/i

export function contentIntent(prompt: string): 'read' | 'act' | 'reference' | null {
  const explicit = /^content:\s*/i.test(prompt)
  const text = prompt.replace(/^content:\s*/i, '').trim()
  if (!explicit && OUTREACH.test(text)) return null
  if (POINTING.test(text)) return 'reference'
  if (!explicit && !CONTENT.test(text) && requestedWeek(text) === null) return null
  return WRITE.test(text) ? 'act' : 'read'
}

// Repeating Ivan's actual command with the title attached gives him a chance
// to verify the target in the main composer before the Desk plans the write.
export function namedCommand(command: string, firstLine: string): string {
  return command.replace(/\b(it|this one|that one)\b/i, () => 'the post that starts “' + firstLine + '”')
}

export type ContentAnswer = { id?: string; text: string; failed?: boolean }
export function contentParts(prompt: string, endpoint: string) {
  const prefix = new URL('/storage/v1/object/public/post-stills/onepost/', endpoint).href
  const lines = prompt.replace(/^content:\s*/i, '').split('\n')
  const attachments: { kind: 'photo'; url: string }[] = []
  while (lines.length > 1) {
    const photo = /^\[Content photo\]\((https:\/\/[^)]+)\)$/.exec(lines[lines.length - 1])?.[1]
    if (!photo || !photo.startsWith(prefix) || !/^[a-z0-9._-]+$/i.test(photo.slice(prefix.length))) break
    if (attachments.length === 4) throw new Error('too_many_photos')
    attachments.unshift({ kind: 'photo', url: photo }); lines.pop()
  }
  return { text: lines.join('\n').trim(), attachments }
}

export async function askContent(args: {
  endpoint: string; authorization: string; anonKey: string; text: string; turnId: string; threadId: string; readOnly: boolean; targetId?: string
}): Promise<ContentAnswer> {
  const res = await fetch(args.endpoint, {
    method: 'POST', headers: { Authorization: args.authorization, apikey: args.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'send', client_key: 'assistant:' + args.turnId, ...contentParts(args.text, args.endpoint), main_thread: args.threadId, read_only: args.readOnly, main_target_id: args.targetId }),
    signal: AbortSignal.timeout(140_000),
  })
  if (!res.ok) throw new Error('content_unavailable')
  // The Desk writes its final row before emitting this frame. Partial streamed
  // prose is never an approval receipt.
  const lines = (await res.text()).replace(/\r\n/g, '\n').split('\n\n')
  for (const frame of lines) {
    if (!frame.split('\n').some(l => l.trim() === 'event: final')) continue
    const data = JSON.parse(frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('\n'))
    const m = data?.message
    if (typeof m?.id === 'string' && typeof m.body === 'string' && m.meta?.main_thread === args.threadId) {
      return { id: m.id, text: m.body, failed: m.status === 'error' }
    }
  }
  throw new Error('content_unconfirmed')
}

type Db = import('npm:@supabase/supabase-js@2').SupabaseClient
type Card = { id?: string; first_line?: string }

// The question is on the main thread. The caller's bearer goes only to the
// deployment's own Content Desk. Existing content handlers own every write.
export async function answerContent(args: {
  db: Db; userId: string; threadId: string; turnId: string; prompt: string; endpoint: string; anonKey: string; authorization: string
  intent: NonNullable<ReturnType<typeof contentIntent>>; previousContent?: { id: string }
}): Promise<{ text: string; source?: { kind: string; path: string }; failed?: boolean }> {
  let text = args.prompt
  let targetId: string | undefined
  if (args.intent === 'reference') {
    const previous = args.previousContent
    if (!previous) return { text: 'Which post do you mean? Include its opening line.' }
    const { data, error } = await args.db.from('desk_messages').select('meta').eq('id', previous.id).eq('user_id', args.userId)
      .or(`meta->>main_thread.eq.${args.threadId},meta->>mirrored_main_thread.eq.${args.threadId}`).maybeSingle()
    if (error) throw new Error('content_unavailable')
    const cards: Card[] = Array.isArray(data?.meta?.drafts) ? data.meta.drafts : []
    if (cards.length !== 1 || !cards[0].first_line || !cards[0].id) return {
      text: 'Which post do you mean? Choose its opening line, or type it in your reply.',
      ...(cards.length ? { source: { kind: 'content_choice', path: previous.id } } : {}),
    }
    text = namedCommand(text, cards[0].first_line)
    targetId = cards[0].id
  }
  const answer = await askContent({ ...args, text, readOnly: args.intent === 'read', targetId })
  return { text: answer.text, failed: answer.failed, source: answer.id ? { kind: 'content_desk', path: answer.id } : undefined }
}
