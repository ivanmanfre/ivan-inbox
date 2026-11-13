import { beforeEach, expect, it, vi } from 'vitest'

// A tiny stand-in for the query builder: one stored row, every filter recorded, an update only lands
// when its updated_at filter matches the row (the compare-and-swap the real table gives).
const db = vi.hoisted(() => {
  const state = { row: null as Record<string, unknown> | null, updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>, tick: 0, beforeUpdate: null as null | (() => void) }
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    let patch: Record<string, unknown> | null = null
    const q: Record<string, unknown> = {
      select: () => (patch ? Promise.resolve(run()) : q),
      update: (p: Record<string, unknown>) => { patch = p; return q },
      eq: (k: string, v: unknown) => { filters[k] = v; return q },
      is: (k: string, v: unknown) => { filters[k] = v; return q },
      maybeSingle: () => Promise.resolve({ data: state.row ? { ...state.row } : null, error: null }),
    }
    const run = () => {
      state.beforeUpdate?.()
      state.updates.push({ patch: patch!, filters: { table, ...filters } })
      const r = state.row
      if (!r || ('updated_at' in filters && filters.updated_at !== r.updated_at)) return { data: [], error: null }
      Object.assign(r, patch, { updated_at: `t${++state.tick}` })
      return { data: [{ id: r.id }], error: null }
    }
    return q
  }
  return { state, from }
})
const save = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from: db.from } }))
vi.mock('./content', async orig => ({ ...(await orig<typeof import('./content')>()), saveDraftBody: save }))
import { DraftSaveConflict } from './content'
import { readCopyVersions, switchDraftCopy } from './copyVersions'

const SHORT = 'Short copy, near word for word.'
const LONG = `${SHORT}\n\nAdded paragraph.`
const row = (over: Record<string, unknown> = {}) => ({ id: 'd1', post_body: LONG, updated_at: 't0', published_at: null,
  taxonomy: { source: 'x_tracked_outlier' }, source_detail: { kind: 'x_tracked_outlier', short_copy: SHORT, media_check: { photos: [] } }, ...over })
beforeEach(() => { db.state.row = row(); db.state.updates = []; db.state.tick = 0; db.state.beforeUpdate = null; save.mockReset(); save.mockResolvedValue(undefined) })

it('long to short: keeps the long text on the draft, then saves the short one through the editor save', async () => {
  expect(await switchDraftCopy('d1', 'short', LONG)).toBe(SHORT)
  expect(db.state.updates).toHaveLength(1)
  const u = db.state.updates[0]
  // only source_detail is written here, every other key of it kept, gated on the row not having moved
  expect(u.patch).toEqual({ source_detail: { kind: 'x_tracked_outlier', short_copy: SHORT, media_check: { photos: [] }, long_copy: LONG } })
  expect(u.filters).toMatchObject({ table: 'carousel_drafts', id: 'd1', client_id: null, published_at: null, updated_at: 't0' })
  expect(save).toHaveBeenCalledWith('d1', SHORT, { source: 'x_tracked_outlier', copy_choice: 'short' }, LONG, null)
})

it('short back to long: an edit made to the short side is kept, and the kept long text returns', async () => {
  const edited = `${SHORT} His own line.`
  db.state.row = row({ post_body: edited, taxonomy: { copy_choice: 'short', human_edited: true }, source_detail: { short_copy: SHORT, long_copy: LONG } })
  expect(await switchDraftCopy('d1', 'long', edited)).toBe(LONG)
  expect(db.state.updates[0].patch).toEqual({ source_detail: { short_copy: edited, long_copy: LONG } })
  expect(save).toHaveBeenCalledWith('d1', LONG, { copy_choice: 'long', human_edited: true }, edited, null)
})

it('writes nothing when the body moved elsewhere', async () => {
  await expect(switchDraftCopy('d1', 'short', 'what the screen showed')).rejects.toBeInstanceOf(DraftSaveConflict)
  expect(db.state.updates).toHaveLength(0)
  expect(save).not.toHaveBeenCalled()
})

it('never saves the body when keeping the leaving text was refused', async () => {
  // a write lands between the read and the keep: the row's updated_at no longer matches
  db.state.beforeUpdate = () => { db.state.row!.updated_at = 'moved' }
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toBeInstanceOf(DraftSaveConflict)
  expect(save).not.toHaveBeenCalled()
  expect((db.state.row!.source_detail as Record<string, unknown>).long_copy).toBeUndefined()
})

it('refuses a published post, a deleted one, and a draft with one version', async () => {
  db.state.row = row({ published_at: '2026-11-14T09:00:00Z' })
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toThrow('already published')
  expect(await readCopyVersions('d1')).toBeNull()
  db.state.row = row({ source_detail: { kind: 'x_tracked_outlier', short_copy: null } })
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toThrow('one version only')
  db.state.row = null
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toBeInstanceOf(DraftSaveConflict)
  expect(db.state.updates).toHaveLength(0)
  expect(save).not.toHaveBeenCalled()
})

it('the same side is a no-op', async () => {
  expect(await switchDraftCopy('d1', 'long', LONG)).toBe(LONG)
  expect(db.state.updates).toHaveLength(0)
  expect(save).not.toHaveBeenCalled()
})
