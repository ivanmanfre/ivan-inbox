import { describe, it, expect } from 'vitest'
import { capCountOf, promoteAudience } from './BulkBar'
import { canPromote, reviewActionable } from '../../lib/content'
import type { RowCap, SelectedRow } from './commandStore'

// ITEM B, THE MEASURED DEFECT AND ITS FIX.
//
// `reviewActionable` is `(review|error) && lane === 'ivan'`, so on a client lane
// the row's capability list evaluated to ['delete'] and nothing else. Selecting
// all 54 of Mattan's review rows offered exactly one bulk button and it was the
// destructive one: the single action that scaled was the one that removes work.
//
// These tests pin the shape of the fix, not its wording.

// The exact expression ContentList's Card computes, kept here as one line so a
// change to the rule has to change this test too.
function capsFor(status: string, lane: 'ivan' | 'risedtc' | 'arch', onBoard: boolean): RowCap[] {
  return [
    ...(reviewActionable(status, lane) ? (['approve', 'skip'] as RowCap[]) : []),
    ...(canPromote(status, lane) && !onBoard ? (['promote'] as RowCap[]) : []),
    ...(lane === 'ivan' || !onBoard ? (['delete'] as RowCap[]) : []),
  ]
}

const row = (over: Partial<SelectedRow> = {}): SelectedRow => ({
  id: 'd1', kind: 'draft', label: 'A post', caps: ['promote', 'delete'], lane: 'risedtc', ...over,
})

describe('a client review row is no longer delete-only', () => {
  it('was delete-only, and now carries promote', () => {
    expect(capsFor('review', 'risedtc', false)).toEqual(['promote', 'delete'])
    expect(capsFor('review', 'arch', false)).toEqual(['promote', 'delete'])
  })

  it('Ivan lane is untouched: no promote, same three caps as before', () => {
    expect(capsFor('review', 'ivan', false)).toEqual(['approve', 'skip', 'delete'])
    expect(capsFor('error', 'ivan', false)).toEqual(['approve', 'skip', 'delete'])
  })

  it('refuses promote on a status the RPC itself refuses', () => {
    // operator_set_board_visible answers 'not_in_review' for anything but review,
    // so offering the button there would be offering a refusal.
    for (const s of ['error', 'approved', 'scheduled', 'published', 'archived']) {
      expect(capsFor(s, 'risedtc', false)).not.toContain('promote')
    }
  })

  it('refuses promote on a row already on the board, which is a no-op sync', () => {
    expect(capsFor('review', 'risedtc', true)).toEqual([])
  })

  it('never offers approve on a client row, which would lock it off the board', () => {
    // approveDraft writes status='approved', the one value the promote RPC
    // refuses. An approve here is permanent damage, not a shortcut.
    for (const s of ['review', 'error']) {
      expect(capsFor(s, 'risedtc', false)).not.toContain('approve')
    }
  })
})

describe('the bulk bar counts and names the audience', () => {
  it('counts promote alongside the caps it already counted', () => {
    const counts = capCountOf([row(), row({ id: 'd2' }), row({ id: 'd3', caps: ['delete'] })])
    // Every cap, including the ones this selection cannot take. `toEqual` is an
    // exhaustive assertion and the compiler does not police it, so the merge
    // that added 'discard' had to be carried into this literal by hand.
    expect(counts).toEqual({ approve: 0, skip: 0, promote: 2, delete: 3, discard: 0 })
  })

  it('names the client, never the database value', () => {
    expect(promoteAudience([row(), row({ id: 'd2' })])).toBe('Mattan Danino')
    expect(promoteAudience([row({ lane: 'arch' })])).toBe('Davorin Smit')
  })

  it('a mixed selection names both rather than picking one', () => {
    expect(promoteAudience([row(), row({ id: 'd2', lane: 'arch' })])).toBe('Mattan Danino and Davorin Smit')
  })

  it('says "a client" rather than inventing a name when no lane is carried', () => {
    expect(promoteAudience([row({ lane: undefined })])).toBe('a client')
  })
})
