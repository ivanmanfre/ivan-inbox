import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync('db/20261021_weekly_work_review_notification.sql', 'utf8')

describe('personal weekly review notification idempotency', () => {
  it('keeps one row after dismissal and 24 hours, without changing other producers', async () => {
    const db = new PGlite()
    try {
      await db.exec(`create table public.inbox_notifications (
        tenant text, source text, dedupe_key text, dismissed_at timestamptz,
        created_at timestamptz default now());`)
      await db.exec(migration)
      await db.exec(`insert into inbox_notifications values
        ('ivan','weekly_work_review','WR-2026-43',now(),now()-interval '3 days')`)
      await expect(db.exec(`insert into inbox_notifications(tenant,source,dedupe_key)
        values ('ivan','weekly_work_review','WR-2026-43')`)).rejects.toThrow()
      await db.exec(`insert into inbox_notifications(tenant,source,dedupe_key) values
        ('ivan','weekly_work_review','WR-2026-44'),
        ('ivan','other_producer','same'),('ivan','other_producer','same'),
        ('other','weekly_work_review','same'),('other','weekly_work_review','same')`)
      expect((await db.query<{ n: number }>('select count(*)::int as n from inbox_notifications')).rows[0].n).toBe(6)
      await db.exec(migration)
    } finally { await db.close() }
  })
})
