import { describe, expect, it } from 'vitest'
import {
  EMPTY_SEE, attached, buildSeeBlock, draftSubject, laneSubject, leakedBodies, offAll,
  onAll, seeLine, selectionSubject, threadSubject, toggleDeep, toggleOff,
} from './paneContext'

const NOW = Date.parse('2026-08-22T12:00:00Z')

const THREAD = {
  prospect_id: 'p1',
  prospect_name: 'Bill Laurienti',
  prospect_company: 'Northstar',
  channel: 'linkedin',
  stage: 'replied',
  messages: [
    { direction: 'outbound', created_at: '2026-07-01T10:00:00Z', message_text: 'saw you around Kyle content' },
    { direction: 'inbound', created_at: '2026-07-20T10:00:00Z', message_text: 'what does this cost, and can you start Monday' },
  ],
  hasPendingDraft: true,
}

const DRAFT = {
  id: '2694b514',
  title: 'The margin question nobody asks',
  status: 'error',
  type: 'post',
  updated_at: '2026-08-16T12:00:00Z',
  scheduled_at: null,
  qa_verdict: 'QA_BLOCKED',
  qa_score: '63',
  post_body: 'Most agencies price on hours. The ones that survive price on margin.',
}

describe('the shallow form never carries a body', () => {
  it('a thread summary names the person and counts the messages, and quotes neither', () => {
    const s = threadSubject(THREAD, 'Ivan', NOW)
    expect(s.label).toBe('Bill Laurienti')
    expect(s.summary).toContain('Bill Laurienti')
    expect(s.summary).toContain('2 messages')
    expect(s.summary).toContain('waiting 33 days')
    expect(s.summary).toContain('reply draft is waiting')
    expect(leakedBodies(s, THREAD.messages.map(m => m.message_text))).toEqual([])
  })

  it('a draft summary carries the state and the verdict, not the post', () => {
    const s = draftSubject(DRAFT, 'Ivan', NOW)
    expect(s.summary).toContain('Error')
    // The label purge's law reaches the block too: the pane PRINTS this text
    // behind the "show me" toggle, so a raw verdict code here would be the
    // same defect the purge closed everywhere else.
    expect(s.summary).not.toContain('QA_BLOCKED')
    expect(s.summary).toContain('Blocked by QA')
    expect(s.summary).toContain('Has no date')
    expect(leakedBodies(s, [DRAFT.post_body])).toEqual([])
  })

  it('a selection carries ids and labels and has no deep form at all', () => {
    const s = selectionSubject([
      { id: 'a', kind: 'draft', label: 'One', lane: 'Mattan Danino' },
      { id: 'b', kind: 'draft', label: 'Two', lane: 'Mattan Danino' },
    ])!
    expect(s.label).toBe('2 picked')
    expect(s.summary).toContain('2 drafts selected')
    expect(s.summary).toContain('Mattan Danino')
    expect(s.summary).toContain('no text')
    expect(s.full).toBeUndefined()
  })

  it('an empty selection is not a subject', () => {
    expect(selectionSubject([])).toBeNull()
  })
})

describe('the block that travels', () => {
  const subjects = [
    laneSubject('DMs', 'Ivan’s lane'),
    threadSubject(THREAD, 'Ivan', NOW),
    draftSubject(DRAFT, 'Ivan', NOW),
  ]

  it('is undefined when nothing is attached, so an off pane sends no context at all', () => {
    expect(buildSeeBlock(subjects, offAll(EMPTY_SEE, subjects))).toBeUndefined()
    expect(buildSeeBlock([], EMPTY_SEE)).toBeUndefined()
  })

  it('by default states that the texts were held back rather than staying silent about it', () => {
    const block = buildSeeBlock(subjects, EMPTY_SEE)!
    expect(block).toContain('not attached')
    expect(block).not.toContain('price on margin')
    expect(block).not.toContain('can you start Monday')
  })

  it('carries the body only for the one chip that was opened', () => {
    const deep = toggleDeep(EMPTY_SEE, `draft:${DRAFT.id}`)
    const block = buildSeeBlock(subjects, deep)!
    expect(block).toContain('price on margin')
    expect(block).not.toContain('can you start Monday')
  })

  it('a detached chip is gone from the block even when it was opened first', () => {
    let s = toggleDeep(EMPTY_SEE, `draft:${DRAFT.id}`)
    s = toggleOff(s, `draft:${DRAFT.id}`)
    const block = buildSeeBlock(subjects, s)!
    expect(block).not.toContain('price on margin')
    expect(block).not.toContain('2694b514')
    // Turning a chip off also forgets that it was open, so re-attaching it
    // comes back shallow rather than silently re-sending the body.
    const back = toggleOff(s, `draft:${DRAFT.id}`)
    expect(buildSeeBlock(subjects, back)).not.toContain('price on margin')
  })
})

describe('the strip says what is true', () => {
  const subjects = [laneSubject('Content', 'Mattan’s lane'), draftSubject(DRAFT, 'Ivan', NOW)]

  it('names the count and the depth', () => {
    expect(seeLine(subjects, EMPTY_SEE)).toBe('Claude can see 2 things, names and states only')
    expect(seeLine(subjects, toggleDeep(EMPTY_SEE, `draft:${DRAFT.id}`)))
      .toBe('Claude can see 2 things, 1 with the full text')
  })

  it('says so plainly when he has turned it all off', () => {
    expect(seeLine(subjects, offAll(EMPTY_SEE, subjects))).toBe('Claude cannot see your screen')
  })

  it('does not claim a screen with nothing on it is switched off', () => {
    expect(seeLine([], EMPTY_SEE)).toBe('Nothing on screen to attach yet')
  })

  it('turning it all back on restores exactly the chips that are on screen', () => {
    const off = offAll(EMPTY_SEE, subjects)
    expect(attached(subjects, onAll(off, subjects))).toHaveLength(2)
  })
})
