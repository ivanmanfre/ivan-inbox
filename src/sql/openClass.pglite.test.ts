import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './openTrackingSchema'

let db: PGlite
beforeAll(async () => { db = await openDb(1) })
afterAll(async () => { await db?.close() })

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.162 Safari/537.36'
const APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]/9.32.5383'
const c = async (a: unknown[]) => (await db.query(
  `select * from scan_open_classify($1,$2,$3,$4,$5,$6,$7)`, a)).rows[0]

describe('scan_open_classify', () => {
  it('owner flag wins', async () => expect(await c([true, WIN, null, 'desktop', 8075, true, true])).toEqual({ open_class: 'owner', class_reason: 'owner_flag_or_ip' }))
  it('headless is our own tool', async () => expect((await c([false, 'x HeadlessChrome/147', null, 'desktop', 400940, true, false])).open_class).toBe('own_tool'))
  it('Railway network is our own tool', async () => expect((await c([false, WIN, null, 'desktop', 400940, false, false])).class_reason).toBe('own_network'))
  it('seat owner on 3+ scans with a LinkedIn referrer is owner', async () => expect((await c([false, APP, 'www.linkedin.com', 'mobile', null, true, false])).class_reason).toBe('seat_owner_ip_on_3_plus_scans'))
  it('ip on 3+ scans without a LinkedIn referrer is the scanner', async () => expect((await c([false, WIN, null, 'desktop', null, true, false])).class_reason).toBe('ip_on_3_plus_scans'))
  it('a person on a Microsoft network who clicked from LinkedIn is human', async () => expect((await c([false, WIN, 'www.linkedin.com', 'desktop', 8075, false, true])).open_class).toBe('human'))
  it('unknown hash on the Microsoft network is the scanner', async () => expect((await c([false, WIN, null, 'desktop', 8075, false, false])).class_reason).toBe('scanner_network'))
  it('lookup failed, desktop, no referrer, just after a LinkedIn send', async () => expect((await c([false, WIN, null, 'desktop', null, false, true])).class_reason).toBe('unknown_network_after_send'))
  it('known home network just after a send stays human', async () => expect((await c([false, WIN, null, 'desktop', 5089, false, true])).open_class).toBe('human'))
  it('phone with no referrer just after a send stays human', async () => expect((await c([false, 'CriOS/157 Mobile', null, 'mobile', null, false, true])).open_class).toBe('human'))
  it('page: Microsoft org is the scanner', async () => expect((await db.query<{ open_class: string }>(`select * from page_open_classify(true,'Microsoft Limited',$1,false)`, [WIN])).rows[0].open_class).toBe('link_scanner'))
  it('page: bare user agent is our own tool', async () => expect((await db.query<{ open_class: string }>(`select * from page_open_classify(true,'PLAY','Mozilla/5.0',false)`)).rows[0].open_class).toBe('own_tool'))
})
