// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { changeDraftFile, DraftFile } from './DraftFile'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

test('shows the stored PDF and uploads its replacement against the file that was shown', async () => {
  const current = { id: 'previous', name: 'Thorium Digital - LinkedIn plan.pdf', size: 1200, sha256: 'a'.repeat(64) }
  const evidence = { dm_attachment: { ...current, id: 'replacement' } }
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { evidence }, error: null })
  const change = vi.fn(async (file: File | { action: 'remove'; file_id: string }) => {
    await changeDraftFile('draft-id', current.id, file)
  })
  render(<DraftFile draftId="draft-id" file={current} locked={false} onChange={change} />)
  expect(screen.getByRole('button', { name: /Thorium Digital - LinkedIn plan\.pdf/ })).toBeTruthy()
  const replacement = new File(['%PDF-1.7'], 'Revised.pdf', { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText('Select PDF'), { target: { files: [replacement] } })
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalled())
  const [name, request] = vi.mocked(supabase.functions.invoke).mock.calls[0]
  expect(name).toBe('inbox-dm-draft-file')
  const body = request?.body as FormData
  expect(body.get('draft_id')).toBe('draft-id')
  expect(body.get('file_id')).toBe(current.id)
  expect((body.get('file') as File).name).toBe('Revised.pdf')
})
