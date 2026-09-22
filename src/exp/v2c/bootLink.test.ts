// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { sourcesAliasAtBoot, useOneShotBootLink } from './bootLink'

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

it('resolves the Content Sources alias to the Research tab once, from the boot hash', () => {
  expect(sourcesAliasAtBoot('#exp/v2/strategy?sources=1')).toBe(true)
  expect(sourcesAliasAtBoot('#exp/v2/content?section=sources')).toBe(true)
  expect(sourcesAliasAtBoot('#exp/v2/strategy?lane=arch&section=research')).toBe(false)
  const { result } = renderHook(({ job }) => useOneShotBootLink({}, job, true), { initialProps: { job: 'strategy' } })
  expect(result.current).toEqual({ lane: undefined, section: 'research' })
})
