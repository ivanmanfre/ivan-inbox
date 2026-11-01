// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEmailDetails } from './useEmailDetails'
import { msg, threads } from './fixtures'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../lib/emailDetails', () => ({ fetchEmailDetails: h.fetch }))

afterEach(() => { cleanup(); h.fetch.mockReset() })

const draft = (text: string) => threads([msg({ id: 'd1', prospect_id: 'lou', client_id: 'arch', channel: 'email', recipient_email: 'lou@x.com', message_text: text })])[0]

it('a draft autosave does not put the email editors back into loading', async () => {
  h.fetch.mockResolvedValue([])
  const { result, rerender } = renderHook(({ t }) => useEmailDetails(t), { initialProps: { t: draft('Hello') } })
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  rerender({ t: draft('Hello there, Lou') })
  expect(result.current.loading).toBe(false)
  await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2))
})
