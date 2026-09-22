// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useOneShotBootLink } from './bootLink'

it('hands the boot link to the first Strategy mount', () => {
  const { result } = renderHook(({ job }) => useOneShotBootLink({ lane: 'risedtc', section: 'research' }, job), { initialProps: { job: 'strategy' } })
  expect(result.current).toEqual({ lane: 'risedtc', section: 'research' })
})

it('drops the link once the operator leaves Strategy, so a re-entry never re-asserts the linked lane', () => {
  const { result, rerender } = renderHook(({ job }) => useOneShotBootLink({ lane: 'risedtc', section: 'research' }, job), { initialProps: { job: 'strategy' } })
  expect(result.current?.lane).toBe('risedtc')
  rerender({ job: 'dms' })
  rerender({ job: 'strategy' })
  expect(result.current).toBeNull()
})

it('is null when the boot hash carried no link', () => {
  const { result } = renderHook(() => useOneShotBootLink({}, 'strategy'))
  expect(result.current).toBeNull()
})
