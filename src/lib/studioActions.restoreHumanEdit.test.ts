import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentDraft } from './content'

const db = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), write: vi.fn(), update: vi.fn(), readEq: vi.fn(), writeEq: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: db.from } }))
import { restoreHumanEdit } from './studioActions'

const original = {
  id: 'client-error', client_id: 'risedtc', board_visible: false,
  status: 'error', post_body: 'Manual copy', taxonomy: { human_edited: true, pillar: 'old pillar' },
} as unknown as ContentDraft
const fresh = {
  post_body: 'Manual copy', client_id: 'risedtc', board_visible: false,
  taxonomy: { human_edited: 'false', pillar: 'fresh pillar', generating_started_at: 'generation stamp' },
  updated_at: '2026-09-30T18:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  const read = { select: vi.fn().mockReturnThis(), eq: db.readEq.mockReturnThis(), maybeSingle: db.read }
  const write = { update: db.update.mockReturnThis(), eq: db.writeEq.mockReturnThis(), select: db.write }
  db.from.mockReturnValueOnce(read).mockReturnValueOnce(write)
  db.read.mockResolvedValue({ data: fresh, error: null })
  db.write.mockResolvedValue({ data: [{ id: original.id }], error: null })
})

describe('restore manual protection after failed client generation', () => {
  it('protects surviving manual copy using fresh taxonomy and a verified timestamp comparison', async () => {
    expect(await restoreHumanEdit(original)).toBe(true)
    expect(db.update).toHaveBeenCalledWith({ taxonomy: expect.objectContaining({
      human_edited: true, human_edited_at: expect.any(String),
      pillar: 'fresh pillar', generating_started_at: 'generation stamp',
    }) })
    expect(Object.keys(db.update.mock.calls[0][0])).toEqual(['taxonomy'])
    expect(db.writeEq.mock.calls).toEqual([
      ['id', original.id], ['client_id', 'risedtc'], ['updated_at', fresh.updated_at],
    ])
  })

  it.each([
    ['missing row', null],
    ['replaced copy', { ...fresh, post_body: 'Finished generator copy' }],
    ['different client', { ...fresh, client_id: 'arch' }],
    ['visible copy', { ...fresh, board_visible: true }],
    ['missing timestamp', { ...fresh, updated_at: null }],
  ])('leaves %s untouched', async (_reason, row) => {
    db.read.mockResolvedValue({ data: row, error: null })
    expect(await restoreHumanEdit(original)).toBe(false)
    expect(db.update).not.toHaveBeenCalled()
  })

  it.each([
    { ...original, client_id: null },
    { ...original, board_visible: true },
    { ...original, taxonomy: { human_edited: false } },
  ])('does not restore protection outside originally protected internal client copy', async draft => {
    expect(await restoreHumanEdit(draft as ContentDraft)).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('reports a comparison mismatch without claiming protection was restored', async () => {
    db.write.mockResolvedValue({ data: [], error: null })
    expect(await restoreHumanEdit(original)).toBe(false)
  })

  it('throws read failure without attempting a write', async () => {
    const error = new Error('Read refused')
    db.read.mockResolvedValue({ data: null, error })
    await expect(restoreHumanEdit(original)).rejects.toBe(error)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('throws write failure without claiming protection was restored', async () => {
    const error = new Error('Protection refused')
    db.write.mockResolvedValue({ data: null, error })
    await expect(restoreHumanEdit(original)).rejects.toBe(error)
  })
})
