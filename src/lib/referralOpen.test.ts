import { describe, expect, it } from 'vitest'
import { laterChecked, laterInbound, openReferral, readLaterVerdict, referralTarget } from '../../supabase/functions/inbox-dm-draft/referral'

// Invented thread: Priya (the prospect) points the author to Tomas Weller at a made-up studio.
const at = (min: number) => new Date(Date.UTC(2026, 10, 5, 12, min)).toISOString()
const m = (id: string, direction: 'inbound' | 'outbound', text: string, min: number, sent = true) =>
  ({ id, direction, message_text: text, sent_at: sent ? at(min) : null, created_at: at(min) })
const pitch = m('pitch', 'outbound', 'Are you running creator campaigns at the moment?', 0)
const handoff = m('handoff', 'inbound', 'You could contact Tomas Weller, he is the influencer manager here', 10)
const ack = m('ack', 'outbound', "Thanks Priya, I'll reach out to Tomas.", 20)
const verified = { status: 'verified', input_message_id: 'handoff', linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', name: 'Tomas Weller' }

describe('which handoff the referral card is about', () => {
  it('a fresh handoff is the newest inbound', () => {
    expect(referralTarget([pitch, handoff], null)).toEqual({ inbound: handoff, anchored: false })
  })
  it.each(['You too!', 'Thanks!', 'Priya reacted ❤️', '🙏'])('a courtesy reply (%s) never hides a verified referral', text => {
    const rows = [pitch, handoff, ack, m('later', 'inbound', text, 30)]
    expect(referralTarget(rows, verified)).toEqual({ inbound: handoff, anchored: true })
  })
  it('without a stored verified referral a courtesy reply after our answer shows nothing', () => {
    expect(referralTarget([pitch, handoff, ack, m('later', 'inbound', 'You too!', 30)], null)).toBeNull()
    expect(referralTarget([pitch, handoff, ack, m('later', 'inbound', 'You too!', 30)], { ...verified, status: 'unresolved' })).toBeNull()
  })
  it('a referral the operator acted on (lead created or dismissed) is closed', () => {
    const rows = [pitch, handoff, ack, m('later', 'inbound', 'You too!', 30)]
    expect(referralTarget(rows, { ...verified, lead_prospect_id: '00000000-0000-4000-8000-000000000001' })).toBeNull()
    expect(referralTarget(rows, { ...verified, dismissed_at: at(40) })).toBeNull()
    expect(openReferral({ ...verified, lead_prospect_id: 'x' })).toBe(false)
  })
  it('a stored referral for a message that is not in this thread never anchors', () => {
    expect(referralTarget([pitch, m('other', 'inbound', 'You too!', 30)], verified)).toBeNull()
  })
  it('a handoff followed by "thanks" in the same unanswered turn is still found', () => {
    const rows = [pitch, handoff, m('thanks', 'inbound', 'thanks!', 11)]
    expect(referralTarget(rows, null)).toEqual({ inbound: handoff, anchored: false })
  })
  it('a newer handoff-like reply is researched first, unless it was already passed over', () => {
    const newer = m('newer', 'inbound', 'You can reach out to someone else from the studio', 30)
    expect(referralTarget([pitch, handoff, ack, newer], verified)?.inbound.id).toBe('newer')
    expect(referralTarget([pitch, handoff, ack, newer], { ...verified, passed_over: ['newer'] })).toEqual({ inbound: handoff, anchored: true })
  })
})

describe('later messages after the handoff', () => {
  const later = [m('l1', 'inbound', 'You too!', 30), m('l2', 'inbound', 'Actually please hold off until January, Tomas is on leave', 40)]
  it('lists only inbound messages after the handoff', () => {
    expect(laterInbound([pitch, handoff, ack, ...later], 'handoff').map(x => x.id)).toEqual(['l1', 'l2'])
  })
  it('a check counts only when it read exactly the replies there are now (a late import changes the set)', () => {
    const check = (ids: string[]) => ({ later: { through_message_id: ids.at(-1) ?? 'handoff', message_ids: ids, verdict: 'go' as const, quote: null, checked_at: at(41) } })
    expect(laterChecked(check(['l1']), later)).toBe(false)
    expect(laterChecked(check(['l1', 'l2']), later)).toBe(true)
    expect(laterChecked(check(['l2']), [later[1]])).toBe(true)
    expect(laterChecked(check(['l2']), later)).toBe(false)
    // The handoff itself is read once even when nothing came after it.
    expect(laterChecked({}, [])).toBe(false)
    expect(laterChecked(check([]), [])).toBe(true)
  })
  it('a dismissed handoff stays closed even while it is the newest message', () => {
    expect(referralTarget([pitch, handoff], { ...verified, dismissed_at: at(20) })).toBeNull()
  })
  it('a hold must quote the referrer; an invented quote falls back to their newest words', () => {
    expect(readLaterVerdict({ verdict: 'hold', quote: 'please hold off until January' }, later)).toEqual({ verdict: 'hold', quote: 'please hold off until January' })
    expect(readLaterVerdict({ verdict: 'hold', quote: 'never written' }, later).quote).toBe(later[1].message_text)
  })
  it('an unreadable verdict pauses instead of contacting', () => {
    expect(readLaterVerdict({ verdict: 'maybe' }, later).verdict).toBe('hold')
    expect(readLaterVerdict({ verdict: 'go', quote: 'You too!' }, later)).toEqual({ verdict: 'go', quote: null })
  })
})
