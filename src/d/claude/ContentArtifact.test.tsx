// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContentArtifact } from './ContentArtifact'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }) }) } }))
describe('content artifacts inside the main conversation', () => {
  it('lets Ivan choose exactly which post to put into his existing composer', async () => {
    const card = { id: 'w', handle: '#abc', first_line: 'Winter came early', status: 'review' }
    read.mockResolvedValue({ data: { id: 'answer', body: 'The plan', role: 'assistant', meta: { drafts: [card] } } })
    const setText = vi.fn()
    render(<ContentArtifact id="answer" choose request="Move it to Friday" setText={setText} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Winter came early' }))
    expect(setText).toHaveBeenCalledWith('Content: Move the post that starts “Winter came early” to Friday')
  })
})
