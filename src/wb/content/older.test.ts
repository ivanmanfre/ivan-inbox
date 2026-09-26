import { describe, expect, it } from 'vitest'
import { splitByAge } from './older'

describe('splitByAge: the badge’s 14 days above, older folded', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  it('splits on created_at at 14 days', () => {
    const { recent, older } = splitByAge([
      { created_at: '2026-09-25T00:00:00Z' },
      { created_at: '2026-09-12T13:00:00Z' },
      { created_at: '2026-09-12T11:00:00Z' },
      { created_at: 'garbage' },
    ], now)
    expect(recent.map(r => r.created_at)).toEqual(['2026-09-25T00:00:00Z', '2026-09-12T13:00:00Z', 'garbage'])
    expect(older.map(r => r.created_at)).toEqual(['2026-09-12T11:00:00Z'])
  })
})
