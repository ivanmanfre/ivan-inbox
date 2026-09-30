import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table outreach_campaigns(id uuid primary key, client_id text, name text);
    create table outreach_prospects(id uuid primary key, campaign_id uuid, name text, headline text,
      company text, title text, country text, icp_score int, stage text default 'dm_sent', linkedin_url text,
      dm_count int default 1, blacklisted boolean default false, call_booked_at timestamptz,
      enrichment_data jsonb default '{}');
    create table outreach_messages(prospect_id uuid, direction text, sent_at timestamptz,
      created_at timestamptz default now(), message_type text default 'inmail', ai_model text,
      message_text text default '', is_reaction boolean default false);
    create table profile_view_log(prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
    create table post_engagers(prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz,
      engagement_type text, comment_text text, post_social_id text);
    create table client_post_metrics(title text, post_url text, social_id text, captured_at timestamptz);
    create table scan_opens(company_slug text, opened_at timestamptz, is_owner boolean,
      user_agent text, referrer_host text);
    insert into outreach_campaigns values ('00000000-0000-0000-0000-000000000001','arch','ARCH');
  `)
  await db.exec(readFileSync('db/20260930_inbox_profile_interest.sql', 'utf8'))
})
afterAll(async () => { await db?.close() })
let n = 0
async function person(views: Array<{ hours: number; seat?: string; capturedHours?: number }>) {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await db.query(`insert into outreach_prospects(id,campaign_id,name) values ($1,'00000000-0000-0000-0000-000000000001','Prospect')`, [id])
  await db.query(`insert into outreach_messages(prospect_id,direction,sent_at) values ($1,'outbound',now()-interval '5 days')`, [id])
  for (const v of views) await db.query(`insert into profile_view_log values ($1,$2,now()-interval '5 days'+$3*interval '1 hour',now()-interval '5 days'+$4*interval '1 hour')`, [id, v.seat ?? 'arch', v.hours, v.capturedHours ?? v.hours])
  return id
}
type Card = { prospect_id: string; n_views: number; n_engagements: number; signals: Array<{kind:string;profile_return?:boolean}> }
async function cards(id: string) { return (await db.query<Card>('select * from inbox_interest_cards() where prospect_id=$1', [id])).rows }

describe('profile interest from actual visits on the sending seat', () => {
  it('suppresses the first visit 48 minutes after the DM, even when captured again next day', async () => {
    const id = await person([{hours:0.8},{hours:0.8,capturedHours:25}])
    expect(await cards(id)).toEqual([])
  })
  it('keeps a first visit at the 24-hour boundary with no return claim', async () => {
    const id = await person([{hours:24}])
    expect((await cards(id))[0]?.signals[0].profile_return).toBe(false)
  })
  it('marks a distinct visit a day after the first as a return', async () => {
    const id = await person([{hours:1},{hours:25}])
    expect((await cards(id))[0]?.signals[0].profile_return).toBe(true)
    expect((await cards(id))[0]?.n_views).toBe(1)
  })
  it('a repeated capture of a delayed first visit cannot establish a return', async () => {
    const id = await person([{hours:26},{hours:26,capturedHours:60}])
    expect((await cards(id))[0]?.signals[0].profile_return).toBe(false)
    expect((await cards(id))[0]?.n_views).toBe(1)
  })
  it('ignores views on another client seat', async () => {
    const id = await person([{hours:26,seat:'ivan'}])
    expect(await cards(id)).toEqual([])
  })
  it('a visit before this DM cannot establish a post-DM return', async () => {
    const id = await person([{hours:-25},{hours:26}])
    expect((await cards(id))[0]?.signals[0].profile_return).toBe(false)
  })
  it('checks full visit history even when the first visit is outside the display window', async () => {
    const id = await person([{hours:26}])
    await db.query(`update outreach_messages set sent_at=now()-interval '30 days' where prospect_id=$1`, [id])
    await db.query(`insert into profile_view_log values ($1,'arch',now()-interval '25 days',now()-interval '25 days')`, [id])
    expect((await cards(id))[0]?.signals[0].profile_return).toBe(true)
  })
  it('the latest message restarts the initial-view window', async () => {
    const id = await person([{hours:26}])
    await db.query(`insert into outreach_messages(prospect_id,direction,sent_at) values ($1,'outbound',now()-interval '5 days'+interval '25 hours')`, [id])
    expect(await cards(id)).toEqual([])
  })
  it('keeps an early post comment while dropping the early profile view', async () => {
    const id = await person([{hours:1}])
    await db.query(`insert into post_engagers values ($1,now()-interval '4 days 23 hours',null,'comment','Useful',null)`, [id])
    const c = (await cards(id))[0]
    expect(c?.n_views).toBe(0); expect(c?.n_engagements).toBe(1)
    expect(c?.signals.map(s=>s.kind)).toEqual(['comment'])
  })
  it('keeps a trusted scan reopen and continues excluding its first open', async () => {
    const id = await person([])
    await db.query(`update outreach_messages set message_text='https://example.com/scan/test' where prospect_id=$1`, [id])
    await db.exec(`insert into scan_opens values ('test',now()-interval '4 days 23 hours',false,'LinkedInApp','linkedin.com')`)
    expect(await cards(id)).toEqual([])
    await db.exec(`insert into scan_opens values ('test',now()-interval '4 days 21 hours',false,'LinkedInApp','linkedin.com')`)
    expect((await cards(id))[0]?.signals.map(s=>s.kind)).toEqual(['scan_open'])
  })
  it('prioritizes returns above a more recent delayed first visit', async () => {
    const returned = await person([{hours:1},{hours:25}])
    const first = await person([{hours:80}])
    const rows = (await db.query<Card>('select * from inbox_interest_cards() where prospect_id in ($1,$2)', [returned,first])).rows
    expect(rows.map(r=>r.prospect_id)).toEqual([returned,first])
  })
})
