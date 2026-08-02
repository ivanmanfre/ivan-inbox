import { describe, expect, it } from 'vitest'
import {
  addPeer, contextPeer, dropPeer, hasChat, isWorkJob, jobHasList, peerCapacity,
  peerKey, planWorkbench, type Peer,
} from './layout'
import { parseWbHash, wbHash } from './route'
import { STAGE_LADDER, stageIsOff, stageStep } from './stage'

const chat: Peer = { kind: 'chat' }
const thread: Peer = { kind: 'thread', id: 'p1' }
const draft: Peer = { kind: 'draft', id: 'd1' }

describe('peer set', () => {
  it('keeps at most one context peer, with chat always rightmost', () => {
    let peers = addPeer([], chat)
    peers = addPeer(peers, thread)
    expect(peers.map(peerKey)).toEqual(['thread:p1', 'chat'])
    peers = addPeer(peers, draft)
    expect(peers.map(peerKey)).toEqual(['draft:d1', 'chat'])
    expect(peers).toHaveLength(2)
  })

  it('re-docking chat does not duplicate it', () => {
    const peers = addPeer(addPeer([thread], chat), chat)
    expect(peers.filter(p => p.kind === 'chat')).toHaveLength(1)
  })

  it('drops by key and reports what is left', () => {
    const peers = dropPeer([thread, chat], 'chat')
    expect(hasChat(peers)).toBe(false)
    expect(contextPeer(peers)).toEqual(thread)
    expect(contextPeer([chat])).toBeNull()
  })
})

describe('planWorkbench', () => {
  it('never leaves an empty second region — the ghost pane cannot exist', () => {
    // The A1 defect: Drafts and Settings rendered a "Select a conversation" pane.
    for (const job of ['inbox', 'drafts', 'settings', 'sends'] as const) {
      const plan = planWorkbench(job, 'wide', [], null)
      expect(plan.peers).toEqual([])
      expect(plan.work).toBe('wide')
    }
  })

  it('gives a list job a list column once a peer is open', () => {
    const plan = planWorkbench('inbox', 'wide', [thread, chat], 'thread:p1')
    expect(plan.work).toBe('list')
    expect(plan.peers).toHaveLength(2)
    expect(plan.narrow).toBe(false)
  })

  it('marks a non-list job narrow so viewport-keyed desktop grids collapse', () => {
    const plan = planWorkbench('today', 'wide', [chat], 'chat')
    expect(plan.work).toBe('wide')
    expect(plan.narrow).toBe(true)
  })

  it('shows only the focused peer below wide', () => {
    expect(peerCapacity('desktop')).toBe(1)
    const plan = planWorkbench('inbox', 'desktop', [thread, chat], 'chat')
    expect(plan.peers).toEqual([chat])
  })

  it('falls back to the newest peer when nothing is focused', () => {
    const plan = planWorkbench('inbox', 'desktop', [thread, chat], null)
    expect(plan.peers).toEqual([chat])
  })

  it('degrades to a single takeover on mobile, and to the job when unfocused', () => {
    expect(planWorkbench('inbox', 'mobile', [thread, chat], 'thread:p1'))
      .toEqual({ work: 'hidden', peers: [thread], narrow: false })
    // Chat docked but not focused must NOT take a phone screen over.
    expect(planWorkbench('inbox', 'mobile', [chat], null))
      .toEqual({ work: 'wide', peers: [], narrow: false })
  })
})

describe('job taxonomy', () => {
  it('knows which jobs hand rows to a peer', () => {
    expect(jobHasList('inbox')).toBe(true)
    expect(jobHasList('content')).toBe(true)
    expect(jobHasList('sends')).toBe(false)
    expect(jobHasList('settings')).toBe(false)
  })

  it('shares one mobile slot between Drafts and Content', () => {
    expect(isWorkJob('drafts')).toBe(true)
    expect(isWorkJob('content')).toBe(true)
    expect(isWorkJob('inbox')).toBe(false)
  })
})

describe('hash route', () => {
  it('round-trips a job and a focused chat', () => {
    expect(parseWbHash('#exp/v2c')).toEqual({ job: 'inbox', focus: null })
    expect(parseWbHash('#exp/v2c/content')).toEqual({ job: 'content', focus: null })
    expect(parseWbHash('#exp/v2c/inbox/chat')).toEqual({ job: 'inbox', focus: 'chat' })
    expect(parseWbHash(wbHash('sends', 'chat'))).toEqual({ job: 'sends', focus: 'chat' })
  })

  it('treats an unknown job as the default rather than rendering nothing', () => {
    expect(parseWbHash('#exp/v2c/nope')).toEqual({ job: 'inbox', focus: null })
    expect(parseWbHash('#today')).toEqual({ job: 'inbox', focus: null })
  })

  it('reads a bare /chat as chat over the default job', () => {
    expect(parseWbHash('#exp/v2c/chat')).toEqual({ job: 'inbox', focus: 'chat' })
  })
})

describe('stage ladder', () => {
  it('maps the vocabulary the pipeline actually writes', () => {
    expect(stageStep('connection_sent')).toBe(0)
    expect(stageStep('engaged')).toBe(1)
    expect(stageStep('inbound_request_dm')).toBe(1)
    expect(stageStep('dm_sent')).toBe(2)
    expect(stageStep('replied')).toBe(3)
    expect(stageStep('booked')).toBe(3)
    expect(STAGE_LADDER).toHaveLength(4)
  })

  it('refuses to invent a position for a stage it has not seen', () => {
    expect(stageStep('some_new_stage_2027')).toBeNull()
    expect(stageStep('')).toBeNull()
  })

  it('treats archived as off the ladder, not as a step backwards', () => {
    expect(stageIsOff('archived')).toBe(true)
    expect(stageIsOff('engaged')).toBe(false)
  })
})
