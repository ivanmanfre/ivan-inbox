import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { normalizeAuthorNote } from '../lib/editorialAuthorNotes'

const original = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const start = original.indexOf('create table if not exists public.editorial_sources (')
const sourceDDL = original.slice(start, original.indexOf('\n);', start) + 3)
const migration = readFileSync('db/209_editorial_author_notes.sql', 'utf8')
const rollback = readFileSync('db/209_editorial_author_notes.rollback.sql', 'utf8')
const note = () => normalizeAuthorNote({ clientId: 'ivan', author: 'Ivan Manfredi', noteId: 'themes',
  originPointer: 'task:user-confirmation', originalUserStatement: 'tennis and Poland',
  observedAt: '2026-09-23T00:00:00Z', confirmedFields: ['tennis and Poland themes'], unknownFields: ['exact details'] })
async function insert(db: PGlite, row: Record<string, unknown>) {
  const columns = Object.keys(row)
  await db.query(`insert into editorial_sources (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
    columns.map(k => typeof row[k] === 'object' && row[k] !== null ? JSON.stringify(row[k]) : row[k]))
}
describe('209 private author notes on the actual source-table contract', { timeout: 30_000 }, () => {
  it('applies twice, retains a note, withdraws its head on rollback without deleting history', async () => {
    const db = new PGlite(); await db.exec(sourceDDL); await db.exec(migration); await db.exec(migration)
    await insert(db, await note())
    await db.exec(rollback); await db.exec(rollback)
    const rows = await db.query<{ seen_version: number, permission_state: string }>('select seen_version,permission_state from editorial_sources order by seen_version')
    expect(rows.rows).toEqual([{ seen_version: 1, permission_state: 'unknown' }, { seen_version: 2, permission_state: 'withheld' }])
    await db.close()
  })
  it('rejects public/cross-client scope, absent contract and absent field limits', async () => {
    const db = new PGlite(); await db.exec(sourceDDL); await db.exec(migration)
    const good = await note()
    for (const patch of [{ source_client_scope: 'public' }, { source_client_scope: 'arch' },
      { candidate_fields: null }, { candidate_fields: { author_note_contract: {} } }]) {
      await expect(insert(db, { ...good, ...patch })).rejects.toThrow()
    }
    await insert(db, good); await db.close()
  })
  it('restores the original kind constraint if no note was imported', async () => {
    const db = new PGlite(); await db.exec(sourceDDL); await db.exec(migration); await db.exec(rollback)
    await expect(insert(db, await note())).rejects.toThrow()
    await db.close()
  })
})
