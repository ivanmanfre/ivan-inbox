// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Refill } from './Refill'
import { supplyOf } from './supply'
import type { LanesData } from './useLanesData'

it('shows RISE candidate counts separately without inflating ready stock or hiding zero', () => {
  const lane = (lane: string, label: string, n: number, capped = false) => ({ seat: 'risedtc', lane, label, n, capped, campaignId: null, off: null })
  const d = {
    ready: { value: { saturdayNy: false, lanes: [lane('engager', 'Competitor engagers', 68), lane('expansion', 'Colleagues of our leads', 103, true), lane('partner', 'CMO partners', 18), lane('view', 'Profile views', 0), lane('reconnect', 'InMail reconnect', 900)] }, failed: null },
    gov: { value: [], failed: null }, pipeline: { value: [], failed: null }, replacement: { value: [], failed: null }, engagers: { value: {}, failed: null },
  } as unknown as LanesData
  const s = supplyOf(d, 'risedtc', Date.now())
  expect(s.ready).toBe(68)
  render(<Refill seat="risedtc" d={d} s={s} now={Date.now()} />)
  const candidates = screen.getByRole('group', { name: 'Other candidate pools' })
  expect(within(candidates).getByText('≥103')).toBeTruthy()
  expect(within(candidates).getByText('18')).toBeTruthy()
  expect(within(candidates).getByText('0')).toBeTruthy()
  expect(within(candidates).queryByText('Competitor engagers')).toBeNull()
  expect(screen.getByText('68')).toBeTruthy()
  expect(screen.queryByText('Qualification not yet verified for this stock count')).toBeNull()
  expect(screen.queryByText('900')).toBeNull()
  expect(screen.getByText('Excluded')).toBeTruthy()
})
