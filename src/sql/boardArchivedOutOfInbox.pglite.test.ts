import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

// db/295: a post archived on the client board (board_archived_at set) leaves the inbox's draft view,
// so it never counts as "in review" there. Restoring it on the board clears the mark and brings it back.
const sql = readFileSync('db/295_board_archived_out_of_inbox_review.sql', 'utf8')
const cols = [...new Set([...sql.matchAll(/\bd\.(\w+)/g)].map(m => m[1]))]

let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  const typed = cols.map(c => c === 'id' ? 'id uuid primary key' : c === 'board_archived_at' ? 'board_archived_at timestamptz' : `${c} text`).join(', ')
  await db.exec(`
    create table carousel_drafts (${typed}${cols.includes('board_archived_at') ? '' : ', board_archived_at timestamptz'});
    create function cb34_p2_read_guard(p uuid) returns jsonb language sql as $$ select '{"visible":true,"member":false}'::jsonb $$;
  `)
  await db.exec(sql)
  await db.exec(`insert into carousel_drafts (id, status, client_id, board_archived_at) values
    ('16caf1c0-3b98-4316-9e42-2d6910e6d83c','review','swishdm','2026-10-19T00:04:05Z'),
    ('b3af1cd8-93d0-446d-b8dc-bdfff7d8726c','review','swishdm','2026-10-19T00:04:05Z'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','review','swishdm',null)`)
})
afterEach(async () => { await db.close() })

it('keeps archived board posts out of the in-review rows and counts', async () => {
  const r = await db.query<{ id: string }>("select id from cb34_p2_safe_drafts where status='review'")
  expect(r.rows.map(x => x.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
})

it('brings a post back once the board restores it', async () => {
  await db.exec("update carousel_drafts set board_archived_at=null where id='16caf1c0-3b98-4316-9e42-2d6910e6d83c'")
  const r = await db.query<{ n: number }>("select count(*)::int n from cb34_p2_safe_drafts where status='review'")
  expect(r.rows[0].n).toBe(2)
})
