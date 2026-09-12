import { describe, expect, it } from 'vitest'
import { dm1Deliverable, evidenceLine, inviteLine, primaryAction, warmGroup } from './warmSignalsData'

// The first real case, as the RPC returned it on 2026-09-12: the invite already
// went out with the lane's generic note before the hold, so the card is DM1-only
// and Approve stays locked until she accepts.
const natalia = {
  signal_source: 'commented_own_post', trigger_type: 'engaged_post',
  signal_evidence: { comment: 'Fun to hear a hot take on immigration from an immigrant. ', comment_at: '2026-09-07T13:31:12.377628+00:00', n_posts: 1 },
  created_at: '2026-09-11T22:58:50Z',
  signal_invite_state: 'sent:eh_anchor@2026-09-12T01:13:14.164+00:00', note_variant: 'eh_anchor',
  connection_sent_at: '2026-09-12T01:13:14.164+00:00', signal_approved_at: null,
  stage: 'ballot_hold', connected_at: null,
  draft_id: '17dbde48-1720-44ae-a1fb-dd8af3334103', draft_approved_at: null,
}

describe('warm signals helpers', () => {
  it('groups a commenter, a two-post reactor and a viewer', () => {
    expect(warmGroup(natalia)).toBe('commented_own_post')
    expect(warmGroup({ signal_source: 'reacted_two_posts', trigger_type: 'engaged_post' })).toBe('reacted_two_posts')
    expect(warmGroup({ signal_source: 'profile_view', trigger_type: 'profile_view' })).toBe('profile_view')
    // a lane row without a second touch should not exist; it is shown, not hidden
    expect(warmGroup({ signal_source: 'engaged_own_post', trigger_type: 'engaged_post' })).toBe('reacted_two_posts')
  })

  it('names the invite state honestly, including the generic note that already went out', () => {
    const s = inviteLine(natalia)
    expect(s.kind).toBe('sent')
    expect(s.text).toContain('earlier generic note')
    expect(inviteLine({ ...natalia, signal_invite_state: 'first_degree', connection_sent_at: null }).kind).toBe('first_degree')
    expect(inviteLine({ ...natalia, signal_invite_state: 'pending', connection_sent_at: null }).kind).toBe('pending')
    expect(inviteLine({ ...natalia, signal_invite_state: 'pending', connection_sent_at: null, signal_approved_at: '2026-09-12T16:00:00Z' }).kind).toBe('approved')
  })

  it('locks Approve DM1 until the person can actually receive a DM', () => {
    expect(dm1Deliverable(natalia)).toBe(false)
    expect(dm1Deliverable({ stage: 'connected', connected_at: '2026-09-13T10:00:00Z' })).toBe(true)
    expect(dm1Deliverable({ stage: 'profile_view_dm', connected_at: null })).toBe(true)
    expect(dm1Deliverable({ stage: 'connection_sent', connected_at: null })).toBe(false)
  })

  it('picks the loud action: invite while pending, DM1 once the invite is out and a draft waits', () => {
    expect(primaryAction(natalia)).toBe('dm1')
    expect(primaryAction({ ...natalia, signal_invite_state: 'pending', connection_sent_at: null })).toBe('invite')
    expect(primaryAction({ ...natalia, draft_approved_at: '2026-09-13T10:00:00Z' })).toBe(null)
    expect(primaryAction({ ...natalia, draft_id: null })).toBe(null)
  })

  it('writes the evidence line from what they did', () => {
    expect(evidenceLine(natalia)).toMatch(/^commented on your post · Sep 7$/)
    expect(evidenceLine({ signal_source: 'reacted_two_posts', trigger_type: 'engaged_post', signal_evidence: { n_posts: 2 }, created_at: '2026-09-12T00:00:00Z' })).toBe('reacted to 2 posts')
    expect(evidenceLine({ signal_source: 'profile_view', trigger_type: 'profile_view', signal_evidence: { viewed_at: '2026-09-12T09:18:00Z', distance: 'DISTANCE_1' }, created_at: '2026-09-12T11:41:41Z' })).toBe('viewed your profile Sep 12 · 1st degree')
  })
})
