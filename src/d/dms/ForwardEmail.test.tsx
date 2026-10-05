// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { msg } from './fixtures'
import { ForwardEmailSheet } from './ForwardEmail'
import { forwardInboxEmail } from '../../lib/emailForward'

vi.mock('../../lib/emailForward', async orig => ({ ...(await orig<typeof import('../../lib/emailForward')>()), forwardInboxEmail: vi.fn(async () => 'sent-id') }))
const message = msg({ id: 'email-id', prospect_id: 'ofir', client_id: 'arch', channel: 'email', direction: 'inbound', prospect_name: 'Ofir Bello', recipient_email: 'ofir.b@doktorabc.com', message_text: 'Brand presentation https://drive.google.com/file/d/deck/view' })
beforeEach(() => { vi.mocked(forwardInboxEmail).mockReset().mockResolvedValue('sent-id') })
afterEach(() => { cleanup() })

it('keeps focus in the recipient and note while editing', () => {
  renderInFrame(<ForwardEmailSheet message={message} onClose={() => {}} />)
  const to = screen.getByLabelText('Forward to email')
  expect(to).toHaveFocus()
  fireEvent.change(to, { target: { value: 'colleague@arch.agency' } })
  expect(to).toHaveFocus()
  const note = screen.getByLabelText('Add a note')
  note.focus()
  fireEvent.change(note, { target: { value: 'Please review.' } })
  expect(note).toHaveFocus()
})

it('prefills Davorin, previews the source, and forwards to the edited recipient only on submission', async () => {
  const closed = vi.fn()
  renderInFrame(<ForwardEmailSheet message={message} onClose={closed} />)
  expect(screen.getByLabelText('Forward to email')).toHaveValue('davorinsmit@arch.agency')
  expect(screen.getByRole('link', { name: 'https://drive.google.com/file/d/deck/view' })).toHaveAttribute('href', 'https://drive.google.com/file/d/deck/view')
  expect(forwardInboxEmail).not.toHaveBeenCalled()
  fireEvent.submit(screen.getByLabelText('Forward to email').closest('form')!)
  expect(forwardInboxEmail).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Forward to email'), { target: { value: 'colleague@arch.agency' } })
  fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Ofir sent these after your call.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Forward email' }))
  await waitFor(() => expect(closed).toHaveBeenCalledOnce())
  expect(forwardInboxEmail).toHaveBeenCalledWith('email-id', 'colleague@arch.agency', 'Ofir sent these after your call.', expect.any(String))
})

it('keeps the recipient and note on failure, and reuses the request ID for a retry', async () => {
  vi.mocked(forwardInboxEmail).mockRejectedValueOnce(new Error('Email service unavailable. Try again.'))
  renderInFrame(<ForwardEmailSheet message={message} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Please review the decks.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Forward email' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Email service unavailable')
  expect(screen.getByLabelText('Add a note')).toHaveValue('Please review the decks.')
  fireEvent.click(screen.getByRole('button', { name: 'Forward email' }))
  await waitFor(() => expect(forwardInboxEmail).toHaveBeenCalledTimes(2))
  expect(vi.mocked(forwardInboxEmail).mock.calls[0]).toEqual(vi.mocked(forwardInboxEmail).mock.calls[1])
})

it('blocks invalid recipients and double submission while sending', async () => {
  vi.mocked(forwardInboxEmail).mockImplementation(() => new Promise(() => {}))
  renderInFrame(<ForwardEmailSheet message={message} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Forward to email'), { target: { value: 'Davorin' } })
  expect(screen.getByRole('button', { name: 'Forward email' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Forward to email'), { target: { value: 'davorinsmit@arch.agency' } })
  fireEvent.click(screen.getByRole('button', { name: 'Forward email' }))
  expect(screen.getByRole('button', { name: 'Forwarding…' })).toBeDisabled()
  expect(forwardInboxEmail).toHaveBeenCalledOnce()
})
