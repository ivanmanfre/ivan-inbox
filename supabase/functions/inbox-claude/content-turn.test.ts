import { assertEquals } from 'jsr:@std/assert@1'
import { contentIntent, namedCommand } from './content-turn.ts'
import { requestedWeek, weekAnswer } from '../content-desk/week-answer.ts'
import type { Rendered } from '../content-desk/brief.ts'

Deno.test('the main composer switches between scan and weekly post questions without a mode toggle', () => {
  assertEquals(contentIntent('Did the prospect get the scan by email?'), null)
  assertEquals(contentIntent("What's on my content plan this week?"), 'read')
  assertEquals(contentIntent('What am I posting next week?'), 'read')
  assertEquals(contentIntent('Can you email the post to Mattan?'), null)
  assertEquals(contentIntent('Which prospects responded to my last post?'), null)
  assertEquals(contentIntent('Show me my last post'), 'read')
  assertEquals(contentIntent('Move it to Friday'), 'reference')
  assertEquals(contentIntent('Move the post that starts “Winter in Warsaw” to Friday'), 'act')
  assertEquals(namedCommand('Move it to Friday', 'Our $25 post'), 'Move the post that starts “Our $25 post” to Friday')
})

Deno.test('weekly list is a model-independent read with exact artifact IDs and Warsaw times', () => {
  const read = "What's on my content plan this week?"
  assertEquals(requestedWeek(read), 0)
  assertEquals(requestedWeek('Which post should I move next week?'), null)
  assertEquals(requestedWeek('What am I posting next week?'), 1)
  const fixture = { weeks: [{ week_start: '2026-11-23', dated: [
    { handle: '#abc', at: '2026-11-25T12:00:00Z' },
  ] }], drafts: new Map([['#abc', { id: '1', first_line: 'What changed on Tuesday', status: 'approved' }]]) } as unknown as Rendered
  const answer = weekAnswer(fixture, 0)
  assertEquals(answer.cards.map(c => c.id), ['1'])
  assertEquals(answer.body.includes('13:00'), true)
  assertEquals(answer.body.includes('What changed on Tuesday'), true)
})

import { askContent, contentParts } from './content-turn.ts'
Deno.test('only this deployment’s uploaded post images become Desk attachments', () => {
  const base = 'https://tenant.example'
  const url = base + '/storage/v1/object/public/post-stills/onepost/photo-1.jpg'
  assertEquals(contentParts('Content: Attach this photo to the post\n[Content photo](' + url + ')', base), {
    text: 'Attach this photo to the post', attachments: [{ kind: 'photo', url }],
  })
  assertEquals(contentParts('Content: Attach it\n[Content photo](https://elsewhere.example/image.jpg)', base).attachments, [])
})

Deno.test('main content dispatch forwards the original owner credential and verifies the Desk reply', async () => {
  const oldFetch = globalThis.fetch
  try {
    for (const expected of [true, false]) {
      globalThis.fetch = async (_url, options) => {
        const opts = options as { body: string; headers: Record<string, string> }
        const data = JSON.parse(opts.body)
        assertEquals(data.client_key, 'assistant:turn-1')
        assertEquals(data.main_thread, 'thread-1')
        assertEquals(data.read_only, true)
        assertEquals(new Headers(opts.headers).get('Authorization'), 'Bearer mock-operator')
        const row = { id: 'answer-1', status: 'done', body: 'Wednesday', meta: { main_thread: expected ? 'thread-1' : 'unrelated' } }
        return new Response('event: final\ndata: ' + JSON.stringify({ message: row }) + '\n\n')
      }
      const result = await askContent({ endpoint: 'https://tenant.example/functions/v1/content-desk', authorization: 'Bearer mock-operator',
        anonKey: 'anon', text: 'My post plan', turnId: 'turn-1', threadId: 'thread-1', readOnly: true }).catch(() => null)
      assertEquals(result?.text ?? null, expected ? 'Wednesday' : null)
    }
  } finally { globalThis.fetch = oldFetch }
})
