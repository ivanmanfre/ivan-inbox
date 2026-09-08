import { describe, expect, it } from 'vitest'
import { dmsEmptyKind } from './InboxList'

// W2-5 (absorbs GAPS-3): a screen with 0 rows on it is not always genuinely
// empty. Only a host that has established the fetch resolved (`verifiedAt`
// not null) may claim "nothing waiting on you".
describe('dmsEmptyKind', () => {
  it('renders rows, not an empty state, when there are any', () => {
    expect(dmsEmptyKind(3, '', null)).toBe('none')
  })

  it('shows the row skeleton before the first fetch resolves, cold open', () => {
    expect(dmsEmptyKind(0, '', null)).toBe('loading')
  })

  it('shows the honest empty claim once verifiedAt is a real timestamp', () => {
    expect(dmsEmptyKind(0, '', '2026-09-08T10:00:00Z')).toBe('verified')
  })

  it('a search with no matches wins over the loading state', () => {
    expect(dmsEmptyKind(0, 'nobody', null)).toBe('search')
  })

  it('a search with no matches wins over the verified empty state too', () => {
    expect(dmsEmptyKind(0, 'nobody', '2026-09-08T10:00:00Z')).toBe('search')
  })
})
