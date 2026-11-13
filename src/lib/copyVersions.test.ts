import { beforeEach, expect, it, vi } from 'vitest'

// A tiny stand-in for the query builder: one stored row, every filter recorded. An update only lands when
// every filter it carries matches the row (the compare-and-swap the real table gives), and bumps updated_at.
// saveDraftBody is the REAL one, so these tests cover the write the switch actually makes.
const db = vi.hoisted(() => {
  const state = { row: null as Record<string, unknown> | null, updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown>; landed: boolean }>, tick: 0, beforeUpdate: null as null | (() => void) }
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    let patch: Record<string, unknown> | null = null
    const run = () => {
      state.beforeUpdate?.()
      const r = state.row
      const ok = !!r && Object.entries(filters).every(([k, v]) => (r[k] ?? null) === v)
      state.updates.push({ patch: patch!, filters: { table, ...filters }, landed: ok })
      if (!ok) return { data: [], error: null }
      Object.assign(r!, patch, { updated_at: `t${++state.tick}` })
      return { data: [{ id: r!.id }], error: null }
    }
    const q: Record<string, unknown> = {
      select: () => (patch ? Promise.resolve(run()) : q),
      update: (p: Record<string, unknown>) => { patch = p; return q },
      eq: (k: string, v: unknown) => { filters[k] = v; return q },
      is: (k: string, v: unknown) => { filters[k] = v; return q },
      maybeSingle: () => Promise.resolve({ data: state.row ? structuredClone(state.row) : null, error: null }),
    }
    return q
  }
  return { state, from }
})
vi.mock('./supabase', () => ({ supabase: { from: db.from, rpc: vi.fn() } }))
import { DraftSaveConflict, saveDraftBody } from './content'
import { copyVersionsOf, readCopyVersions, switchDraftCopy } from './copyVersions'

const SHORT = 'Short copy, near word for word.'
const LONG = `${SHORT}\n\nAdded paragraph.`
const row = (over: Record<string, unknown> = {}) => ({ id: 'd1', client_id: null, post_body: LONG, updated_at: 't0', published_at: null,
  taxonomy: { source: 'x_tracked_outlier' }, source_detail: { kind: 'x_tracked_outlier', short_copy: SHORT, media_check: { photos: [] } }, ...over })
const sd = () => db.state.row!.source_detail as Record<string, unknown>
const tax = () => db.state.row!.taxonomy as Record<string, unknown>
beforeEach(() => { db.state.row = row(); db.state.updates = []; db.state.tick = 0; db.state.beforeUpdate = null })

it('long to short is ONE write: the body, the long text kept on the draft, and which side the body is', async () => {
  expect(await switchDraftCopy('d1', 'short', LONG)).toBe(SHORT)
  expect(db.state.updates).toHaveLength(1)
  const u = db.state.updates[0]
  expect(Object.keys(u.patch).sort()).toEqual(['post_body', 'source_detail', 'taxonomy'])
  // every other key of source_detail is kept; the write is gated on the row read and on it being unpublished
  expect(u.patch.source_detail).toEqual({ kind: 'x_tracked_outlier', short_copy: SHORT, media_check: { photos: [] }, long_copy: LONG, copy_choice: 'short' })
  expect(u.filters).toMatchObject({ table: 'carousel_drafts', id: 'd1', client_id: null, published_at: null, updated_at: 't0' })
  expect(db.state.row!.post_body).toBe(SHORT)
  expect(tax()).toMatchObject({ source: 'x_tracked_outlier', human_edited: true })
  expect(await readCopyVersions('d1')).toEqual({ now: 'short', long: LONG, short: SHORT })
})

it('switch to Short, then a typed edit saved with the list’s stale taxonomy: the long text is never lost', async () => {
  const stale = structuredClone(db.state.row!.taxonomy)                 // what the list still holds until its next read
  await switchDraftCopy('d1', 'short', LONG)
  const edited = `${SHORT} His own line.`
  await saveDraftBody('d1', edited, stale, SHORT, 't0')                 // the row's in-place editor, a read behind
  // the edited short is still the Short side, and Long is still the long text
  expect(copyVersionsOf(db.state.row!.post_body as string, sd())).toEqual({ now: 'short', long: LONG, short: edited })
  expect(await switchDraftCopy('d1', 'long', edited)).toBe(LONG)
  expect(sd()).toMatchObject({ short_copy: edited, long_copy: LONG, copy_choice: 'long' })
  // and back: his edited short returns
  expect(await switchDraftCopy('d1', 'short', LONG)).toBe(edited)
  expect(sd()).toMatchObject({ short_copy: edited, long_copy: LONG, copy_choice: 'short' })
})

it('an edit to the long side survives the switch and the way back', async () => {
  const editedLong = `${LONG} More.`
  await saveDraftBody('d1', editedLong, db.state.row!.taxonomy, LONG, 't0')
  expect(await switchDraftCopy('d1', 'short', editedLong)).toBe(SHORT)
  expect(await switchDraftCopy('d1', 'long', SHORT)).toBe(editedLong)
})

it('writes nothing when the body moved elsewhere', async () => {
  await expect(switchDraftCopy('d1', 'short', 'what the screen showed')).rejects.toBeInstanceOf(DraftSaveConflict)
  expect(db.state.updates).toHaveLength(0)
})

it('another writer changed the row between the read and the write: nothing lands, their change stays', async () => {
  db.state.beforeUpdate = () => { Object.assign(db.state.row!, { updated_at: 'moved', source_detail: { ...sd(), media_copy: { photo_urls: ['x'] } } }) }
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toThrow()
  expect(db.state.updates.map(u => u.landed)).toEqual([false])
  expect(db.state.row!.post_body).toBe(LONG)
  expect(sd()).toEqual({ kind: 'x_tracked_outlier', short_copy: SHORT, media_check: { photos: [] }, media_copy: { photo_urls: ['x'] } })
})

it('published between the read and the write: nothing lands', async () => {
  db.state.beforeUpdate = () => { db.state.row!.published_at = '2026-11-14T09:00:00Z' }
  await expect(switchDraftCopy('d1', 'short', LONG)).rejects.toThrow()
  expect(db.state.updates.map(u => u.landed)).toEqual([false])
  expect(db.state.row!.post_body).toBe(LONG)
  expect(sd().long_copy).toBeUndefined()
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
})

it('the same side is a no-op, and a typed edit still writes only the body and taxonomy', async () => {
  expect(await switchDraftCopy('d1', 'long', LONG)).toBe(LONG)
  expect(db.state.updates).toHaveLength(0)
  await saveDraftBody('d1', `${LONG} x`, db.state.row!.taxonomy, LONG, 't0')
  expect(Object.keys(db.state.updates[0].patch).sort()).toEqual(['post_body', 'taxonomy'])
  expect(db.state.updates[0].filters).not.toHaveProperty('published_at')
})
