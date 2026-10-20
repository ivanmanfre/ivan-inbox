// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InterestPerformanceRows } from './InterestPerformance'
import type { InterestPerf } from '../interestReads'

afterEach(cleanup)
const row = (source_lane: InterestPerf['source_lane'], invites_7d: number): InterestPerf => ({
  client_id: 'arch', source_lane, invites_7d, dms_7d: 1, replied_7d: 1, positive_7d: 0,
  calls_30d: 0, accept_judged: invites_7d, accept_72h: 1,
})
it('shows only classified sources and their own counts, including mixed ARCH campaign engagers', () => {
  render(<InterestPerformanceRows rows={[row('competitor_engager', 42), row('profile_view', 2), { ...row('content_signal', 9), client_id: 'ivan' }]} seat="arch" />)
  expect(screen.getByText('Competitor / anchor engagers')).toBeTruthy()
  expect(screen.getByText('42')).toBeTruthy()
  expect(screen.getByText('Profile views')).toBeTruthy()
  expect(screen.queryByText('Content interest')).toBeNull()
  expect(screen.queryByText('Cold')).toBeNull()
})
