// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { OutlierLabelControls } from './OutlierLabelControls'
afterEach(cleanup)
it('saves an explicit human choice and offers version-guarded Undo after the receipt', async () => {
 const save = vi.fn().mockResolvedValue({ verdict: 'keep', reason: 'relevant', version: 'fixture-revision', canEdit: true, undoInvocationId: 'fixture-invocation' })
 const undo = vi.fn().mockResolvedValue(null)
 renderInFrame(<OutlierLabelControls identity="ivan:x:123" label={null} onSave={save} onUndo={undo} />)
 fireEvent.change(screen.getByRole('textbox'), { target: { value: 'relevant' } })
 fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
 await waitFor(() => expect(screen.getByText('Keep saved. Save idea stays separate.')).toBeTruthy())
 expect(save).toHaveBeenCalledWith('keep', 'relevant')
 fireEvent.click(screen.getByRole('button', { name: 'Undo label' }))
 await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo label' })).toBeNull())
 expect(undo).toHaveBeenCalledWith('fixture-revision')
})
it('preserves the previous saved truth on a failed write and disables foreign ownership', async () => {
 renderInFrame(<OutlierLabelControls identity="arch:x:123" label={{ verdict: 'keep', reason: null, version: 'fixture' }} onSave={vi.fn().mockRejectedValue(new Error('Fixture health hold'))} onUndo={vi.fn()} />)
 fireEvent.click(screen.getByRole('button', { name: 'Drop' }))
 await waitFor(() => expect(screen.getByText('Fixture health hold')).toBeTruthy())
 expect(screen.getByRole('button', { name: 'Keep' }).getAttribute('aria-pressed')).toBe('true')
})
it('does not offer mutation during an unavailable read or for another operator label', () => {
 renderInFrame(<OutlierLabelControls identity="arch:x:123" label={{ verdict: 'drop', reason: null, version: 'fixture', canEdit: false }} onSave={vi.fn()} onUndo={vi.fn()} />)
 expect((screen.getByRole('button', { name: 'Keep' }) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByText('Label belongs to another operator.')).toBeTruthy()
})
