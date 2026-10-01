// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ clear: null as null | (() => void), fresh: null as null | ((rows: unknown[]) => void), failed: null as null | (() => void) }))
vi.mock('./useBrainMembers', async original => ({ ...(await original<typeof import('./useBrainMembers')>()), useBrainMembers: (_rows: unknown[], clear: () => void, fresh: (rows: unknown[]) => void, _scope: string, _enabled: boolean, failed: () => void) => { calls.clear = clear; calls.fresh = fresh; calls.failed = failed } }))
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => { const c = { on: () => c, subscribe: () => c }; return c }, removeChannel: vi.fn() } }))
vi.mock('../lib/content', async original => ({ ...(await original<typeof import('../lib/content')>()), fetchContentDrafts: async () => ({ rows: [{ id: 'm', cb34_p2_member: true, status: 'review' },{ id: 'ordinary', cb34_p2_member: false, status: 'review' }], count: 2 }), fetchLaneProbe: async () => ({ scoped: 2, total: 2 }) }))
import { useContent } from './useContent'
afterEach(cleanup)
it('subset verification invalidates whole-lane totals and retains the historical full-read stamp without claiming an empty lane', async () => {
 const { result } = renderHook(() => useContent('ivan'))
 await waitFor(() => expect(result.current.loadedAt).not.toBeNull())
 const stamp = result.current.loadedAt
 act(() => calls.clear?.())
 expect(result.current.memberReadState).toBe('pending'); expect(result.current.matched).toBeNull(); expect(result.current.laneTotal).toBeNull()
 expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary']); expect(result.current.loadedAt).toBe(stamp)
 act(() => calls.fresh?.([]))
 expect(result.current.memberReadState).toBe('partial'); expect(result.current.matched).toBeNull(); expect(result.current.loadedAt).toBe(stamp)
 expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary']); expect(result.current.error).toBeNull()
})
it('subset failure has an explicit member status without replacing ordinary content with a whole-list error', async () => {
 const { result } = renderHook(() => useContent('ivan'))
 await waitFor(() => expect(result.current.loadedAt).not.toBeNull())
 act(() => { calls.clear?.(); calls.failed?.() })
 expect(result.current.memberReadState).toBe('failed'); expect(result.current.error).toBeNull(); expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary'])
})
