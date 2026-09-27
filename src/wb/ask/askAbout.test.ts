import { describe, expect, it } from 'vitest'
import { askAbout, listenAskAbout, subjectForThread } from './askAbout'
import type { Thread } from '../../lib/inbox'

const thread = {
  prospect_id: 'abcdef12-3456-7890-abcd-ef1234567890',
  prospect_name: 'Lou Example',
  prospect_company: 'Example Co',
  client_id: 'ivan',
  channel: 'linkedin',
  stage: 'dm_sent',
  messages: [
    { direction: 'outbound', created_at: '2026-09-20T10:00:00Z', message_text: 'secret outbound body' },
    { direction: 'inbound', created_at: '2026-09-21T10:00:00Z', message_text: 'secret inbound body' },
  ],
  draft: null,
  draftSnoozedUntil: null,
} as unknown as Thread

describe('askAbout', () => {
  it('builds the same shallow thread subject the desktop drawer attaches', () => {
    const s = subjectForThread(thread)
    expect(s.key).toBe(`thread:${thread.prospect_id}`)
    expect(s.label).toBe('Lou Example')
    expect(s.summary).toContain('Ivan')
    expect(s.summary).not.toContain('secret')
    expect(s.full).toContain('secret inbound body')
  })

  it('hands the subject to the phone listener, parking it until one mounts', () => {
    const got: string[] = []
    askAbout(thread) // no listener yet (node has no window: the phone path)
    const off = listenAskAbout(s => got.push(s.label))
    expect(got).toEqual(['Lou Example'])
    askAbout(thread)
    expect(got).toEqual(['Lou Example', 'Lou Example'])
    off()
  })
})
