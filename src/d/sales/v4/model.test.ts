import { expect, it } from 'vitest'
import { callsByWeek, fortnightDays, otherPerson } from './model'
import { packIndex, readFortnight } from '../model'
import type { CallRow } from '../../../lib/transcripts'
const row: CallRow = { id:'a', title:'Meeting title', date:'2026-10-25T23:30:00Z', duration_minutes:31, participants:['Ivan Manfredi','Ada'], summary:null,action_items:null,topics:null,follow_up_draft:null,follow_up_sent:false,source:null,meeting_type:null,brief:null }
it('uses fourteen Warsaw civil days across DST and UTC midnight', () => {
  const now = new Date('2026-10-25T23:30:00Z')
  const days = fortnightDays(readFortnight([], packIndex([]), [], now), now)
  expect(days).toHaveLength(14)
  expect(days[0].day).toBe('2026-10-26')
  expect(days[13].day).toBe('2026-11-08')
  expect(days.filter(d=>d.today)).toHaveLength(1)
})
it('eight weekly buckets distinguish no duration from a failed archive', () => {
  const now = new Date('2026-10-26T10:00:00Z')
  expect(callsByWeek([],now,'failed')).toBeNull()
  const weeks = callsByWeek([row],now)!
  expect(weeks).toHaveLength(8)
  expect(weeks[7]).toMatchObject({n:1,avg:31,current:true})
  expect(weeks[0].avg).toBeNull()
})
it('names the other participant with a title fallback', () => {
  expect(otherPerson(row)).toBe('Ada')
  expect(otherPerson({...row,participants:['Ivan Manfredi']})).toBe('Meeting title')
})
