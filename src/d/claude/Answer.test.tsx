// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Turn } from '../../exp/v2c/chat/events'
import { Answer } from './Answer'
import { renderInFrame } from '../test-utils'

afterEach(cleanup)

const common = { last: true, busy: false, offline: false, setText: vi.fn(), onRetry: vi.fn(), send: vi.fn() }
const base: Turn = { id: 'answer', turnId: 'stored', role: 'assistant', tools: [], error: null, text: '' }
const text = 'First paragraph.\n\n' + 'Other details. '.repeat(25) + '\n\nNeeds you:\n- Mira requested a call.'

it('opens a scheduled digest on its decision and expands to the full original', () => {
  render(<Answer {...common} request="Scheduled bundle" turn={{ ...base, text, origin: 'bot', durationMs: 1750 }} />)
  expect(screen.getByText('Mira requested a call.')).toBeTruthy()
  expect(screen.queryByText('First paragraph.')).toBeNull()
  expect(screen.queryByText('Copy')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Read full update' }))
  expect(screen.getByText('First paragraph.')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Message details and actions'))
  expect(screen.getByText('Copy')).toBeTruthy()
})

it('shows an operator-requested reply in full', () => {
  render(<Answer {...common} request="Give me the details" turn={{ ...base, text, origin: 'operator' }} />)
  expect(screen.getByText('First paragraph.')).toBeTruthy()
  expect(screen.queryByText('Read full update')).toBeNull()
})

it('pins the private draft request to the saved alert turn', () => {
  const alert = 'Mira Jones supplied mira@example.test after the scan offer. Mattan shared the report on LinkedIn. I checked the connected RISE sender and found no email to that address. Reply “draft the email” to prepare it here.'
  const send = vi.fn()
  render(<Answer {...common} send={send} turn={{ ...base, text: alert, origin: 'bot',
    sources: [{ kind: 'rise_scan_watch', path: 'request', at: '' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Draft email' }))
  expect(send).toHaveBeenCalledWith('Draft the RISE scan email for Mira Jones.', base.turnId)
})

it('a failed scheduled update can reveal its complete saved reply and original action', () => {
  const extra = text + '\n\n[Open original](https://example.test/source)\n\n' +
    '```actions\n[{"label":"Open original","kind":"open","payload":{"url":"https://example.test/source"}}]\n```'
  renderInFrame(<Answer {...common} request="Scheduled bundle" turn={{ ...base, text: extra, origin: 'bot',
    error: { message: 'test failure', retryable: true } }} />)
  fireEvent.click(screen.getByLabelText('Message details and actions'))
  const expand = screen.queryByRole('button', { name: 'Read full update' })
  if (expand) fireEvent.click(expand)
  expect(screen.queryByRole('button', { name: 'Open original' })).toBeTruthy()
})
