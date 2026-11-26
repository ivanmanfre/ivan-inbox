import { describe, expect, it } from 'vitest'
import { profileShowsPerson } from '../../supabase/functions/inbox-dm-draft/referral'

// Invented names only (public repo).
describe('profileShowsPerson (Sol r7-r10)', () => {
  it.each([
    ['Tomas Weller', 'Tomas', 'Weller', true],
    ['Tomas Weller', 'Tomás', 'Weller', true],
    ['Tomas Weller', 'Dr. Tomas', 'Weller, MBA', true],
    ['Tomas Garcia Rivera', 'Tomas', 'Garcia Rivera', true],
    ['Tomas Garcia Rivera', 'Tomas', 'Garcia-Rivera', true],
    ['Lin Ma', 'Lin', 'Ma', true],
    ['Tomas', 'Tomas', 'Rivera', true],
    ['Tomas Garcia Rivera', 'Tomas', 'Lopez Rivera', false],
    ['Tomas Weller', 'Tomas Weller', 'Rivera', false],
    ['Tomas Weller', 'Tomas', 'Rivera', false],
    ['Tomas Weller', 'Tomas Andreas', 'Weller', false],
    ['Tomas Weller', 'Marta', 'Weller', false],
    ['', 'Tomas', 'Weller', false],
    ['Tomas Weller', 'Tomas', 'Weller Jr.', false],
    ['Tomas Weller Jr.', 'Tomas', 'Weller Jr.', true],
    ['Tomas Weller Jr', 'Tomas', 'Weller', false],
    ['Tomas Weller', 'Tomas', 'Weller III', false],
    ['Tomas Weller', 'Tomas Weller', '', false],
    ['Tomas Weller MBA', 'Tomas', 'Weller', false],
    ['Tomas Mba', 'Tomas', 'Weller Jr.', false],
    ['Tomas Mba', 'Tomas', 'Mba', true],
    ['Tomas Mba', 'Tomas', '', false],
  ])('%s vs %s / %s → %s', (named, first_name, last_name, want) => {
    expect(profileShowsPerson(named, { first_name, last_name })).toBe(want)
  })
})
