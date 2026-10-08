// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import fixture from '../../lib/reply-source-v1.fixture.json'
import type { SourceDetail } from '../../lib/replySources'
import { ReplySourceLine } from './ReplySourceSummary'
afterEach(cleanup)
const base = fixture.detail.data as unknown as SourceDetail
const ready = (d: SourceDetail) => ({ kind: 'ready' as const, data: d })
it('shows nothing while loading, unavailable or with an unknown source', () => {
  const { container, rerender } = render(<ReplySourceLine state={{ kind: 'loading' }} />)
  expect(container.textContent).toBe('')
  rerender(<ReplySourceLine state={{ kind: 'unavailable' }} />); expect(container.textContent).toBe('')
  const unknown = { ...base.first_reply!, method: 'unknown' as const, touch: 'unknown' as const }
  rerender(<ReplySourceLine state={ready({ ...base, first_reply: unknown, latest_reply: unknown })} />); expect(container.textContent).toBe('')
})
it('shows one line for a known source, with the detail folded under it', () => {
  const known = { ...base.first_reply!, method: 'inferred_same_chat' as const, touch: 'dm2' as const, product: 'dm' as const }
  render(<ReplySourceLine state={ready({ ...base, first_reply: known, latest_reply: null })} />)
  expect(screen.getByText('Replied after DM2 · LinkedIn DM')).toBeTruthy()
  expect(document.querySelector('details.dx-src:not([open])')).toBeTruthy()
})
