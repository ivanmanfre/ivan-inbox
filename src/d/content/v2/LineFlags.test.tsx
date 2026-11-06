// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../../ui/toast'
import { LineFlagsBlock } from './LineFlags'
import { lineFlagsOf } from '../../../lib/lineFlags'
import type { ContentDraft } from '../../../lib/content'

vi.mock('../../../lib/content', async (orig) => ({ ...(await orig<typeof import('../../../lib/content')>()), saveDraftBody: vi.fn(async () => undefined) }))
vi.mock('../../../lib/lineFlags', async (orig) => ({ ...(await orig<typeof import('../../../lib/lineFlags')>()), keepLineFlags: vi.fn(async () => undefined) }))

const body = 'Just back from a wonderful weekend in Kraków.\n\nThe numbers are remarkable.'
const r = { id: 'd1', post_body: body, taxonomy: {}, updated_at: '2026-11-06T00:00:00Z' } as unknown as ContentDraft
const flags = lineFlagsOf({ lines: [{ text: 'Just back from a wonderful weekend in Kraków.', kind: 'dated', ask: 'Were you in Kraków that weekend?' }],
  rerun: { pass: false, impressions: 89, bar: 170, posted_at: '2026-09-30T10:51:44Z', boosted: false } }, body)!

describe('LineFlagsBlock', () => {
  afterEach(cleanup)
  it('shows the line, its ask, the two chips and the re-run note', () => {
    render(<ToastProvider><LineFlagsBlock r={r} flags={flags} sha="s" body={body} edit={null} setEdit={() => {}} onStartEdit={() => false}
      onSaved={() => {}} onChanged={() => {}} asking={false} onKeep={() => {}} onBack={() => {}} /></ToastProvider>)
    expect(screen.getByText('Just back from a wonderful weekend in Kraków.').tagName).toBe('MARK')
    expect(screen.getByText(/Were you in Kraków that weekend\?/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Swap for mine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cut' })).toBeTruthy()
    expect(screen.getByText(/repeats your 30 Sept? post/)).toBeTruthy()
    expect(screen.getByText(/A re-run needs 170 or more/)).toBeTruthy()
  })
  it('Cut while editing changes only the edit box', () => {
    const setEdit = vi.fn()
    render(<ToastProvider><LineFlagsBlock r={r} flags={flags} sha="s" body={body} edit={body} setEdit={setEdit} onStartEdit={() => true}
      onSaved={() => {}} onChanged={() => {}} asking={false} onKeep={() => {}} onBack={() => {}} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }))
    expect(setEdit).toHaveBeenCalledWith('The numbers are remarkable.')
  })
  it('asks once on Approve and keeps then approves', async () => {
    const onKeep = vi.fn()
    render(<ToastProvider><LineFlagsBlock r={r} flags={flags} sha="s" body={body} edit={null} setEdit={() => {}} onStartEdit={() => false}
      onSaved={() => {}} onChanged={() => {}} asking onKeep={onKeep} onBack={() => {}} /></ToastProvider>)
    expect(screen.getByText(/1 flagged line will post as written/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve as written' }))
    await vi.waitFor(() => expect(onKeep).toHaveBeenCalled())
  })
})
