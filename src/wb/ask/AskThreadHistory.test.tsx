// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { AskThread } from './AskThread'

vi.mock('./Runner', () => ({
  useRunner: () => ({}), RunnerControl: () => null, RunnerMenuItems: () => null,
  RunnerReport: () => null, RunnerSection: () => null,
}))

afterEach(cleanup)

it.each([false, true])('opens earlier exchanges from the legacy Ask thread (mobile %s)', mobile => {
  const loadEarlier = vi.fn()
  const chat = {
    turns: [{ id: 'latest', turnId: 'latest', role: 'user', text: 'Latest exchange', tools: [] }],
    hasEarlier: true, earlierState: 'idle', loadEarlier,
  } as unknown as ChatHandle
  render(<AskThread chat={chat} job="dms" about={null} mobile={mobile} />)
  fireEvent.click(screen.getByRole('button', { name: 'Earlier messages' }))
  expect(loadEarlier).toHaveBeenCalledOnce()
})
