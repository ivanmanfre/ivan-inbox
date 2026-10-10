import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, afterAll, expect, it } from 'vitest'

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('test.role',true),''),'authenticated')$$;
    create table outreach_agent_accounts(client_id text,operator_ids uuid[]);
    insert into outreach_agent_accounts values ('ivan',array['11111111-1111-4111-8111-111111111111'::uuid]);
    create table outreach_campaigns(id int primary key,client_id text,name text);
    create table outreach_prospects(id int primary key,campaign_id int,connected_at timestamptz);
    create table outreach_engagement_log(id int primary key,prospect_id int,action_type text,success boolean,created_at timestamptz);
    insert into outreach_engagement_log values (1,1,'connection_request',true,'2026-03-27T22:31:00Z'),(2,2,'connection_request',true,'2026-03-28T08:01:00Z'),(3,4,'connection_request',true,'2026-03-28T08:01:00Z');
    create table outreach_messages(id int primary key,prospect_id int,direction text,message_type text,channel text,
      sent_at timestamptz,created_at timestamptz,unipile_message_id text,send_blocked_at timestamptz,
      send_blocked_reason text,is_reaction boolean,message_text text);
    insert into outreach_campaigns values (1,null,'Warm'),(2,'arch','Cold'),(3,'risedtc','Engagers');
    insert into outreach_prospects values
      (1,1,'2026-03-27T22:45:00Z'),(2,1,'2026-03-30T06:00:00Z'),(3,1,null),
      (4,2,'2026-03-28T10:00:00Z'),(5,3,null),(6,1,null),(7,1,null),(8,1,null),(9,1,null);
    insert into outreach_messages(id,prospect_id,direction,message_type,channel,sent_at,unipile_message_id,message_text) values
      (1,1,'outbound','connection_note','linkedin','2026-03-27T22:30:00Z',null,'invite'),
      (2,2,'outbound','connection_note','linkedin','2026-03-28T08:00:00Z',null,'invite'),
      (3,1,'outbound','dm','linkedin','2026-03-27T22:30:00Z','d1','first'),
      (4,1,'outbound','dm','linkedin','2026-03-27T22:30:00Z','d1','duplicate'),
      (5,1,'inbound','dm','linkedin','2026-03-28T08:00:00Z','r1','yes'),
      (6,2,'outbound','dm','linkedin','2026-03-28T08:00:00Z','d2','first'),
      (7,2,'inbound','dm','linkedin','2026-04-01T08:00:00Z','r2','late'),
      (8,3,'outbound','dm','linkedin','2026-03-25T08:00:00Z','d3','prior'),
      (9,3,'outbound','dm','linkedin','2026-03-28T08:00:00Z','d4','followup'),
      (10,3,'inbound','dm','linkedin','2026-03-25T09:00:00Z','r3','reply'),
      (11,4,'outbound','connection_note','linkedin','2026-03-28T08:00:00Z',null,'invite'),
      (12,5,'outbound','dm','linkedin','2026-03-28T08:00:00Z','m1','first'),
      (13,6,'outbound','dm','linkedin','2026-03-28T08:00:00Z',null,'phantom'),
      (14,7,'outbound','dm','linkedin','2026-03-28T08:00:00Z','blocked','blocked'),
      (15,8,'outbound','dm','linkedin','2026-03-28T08:00:00Z','react','first'),
      (16,8,'inbound','dm','linkedin','2026-03-28T09:00:00Z','reaction','reaction'),
      (17,9,'outbound','dm','linkedin_inmail','2026-03-28T08:00:00Z','im','inmail');
    update outreach_messages set send_blocked_reason='refused' where id=14;
    update outreach_messages set is_reaction=true where id=16;`)
  if (existsSync('db/20261010_rate_comparison.sql')) await db.exec(readFileSync('db/20261010_rate_comparison.sql', 'utf8'))
}, 30_000)
afterAll(async () => { await db.close() })
const read = () => db.query<Record<string, unknown>>("select * from inbox_rate_comparison('2026-03-28','2026-03-30')")

it('denies authenticated sessions outside the existing operator roster', async () => {
  await expect(read()).rejects.toThrow(/operator_denied/)
})
it('counts the same mature first-touch population on each side across Warsaw DST', async () => {
  await db.exec("set test.uid='11111111-1111-4111-8111-111111111111'")
  const { rows } = await read()
  const find = (client: string, channel: string, period = 'current') => rows.find(r => r.client_id === client && r.channel === channel && r.period === period && r.lane === '__all__')!
  expect(find('ivan','invitation')).toMatchObject({ people: 1, mature: 1, outcomes: 1, rate_pct: '100.0' })
  // 27 March 22:30 UTC is 27 March in Warsaw, outside this window.
  // The remaining two first-DM recipients have a late reply and a reaction.
  expect(find('ivan','dm')).toMatchObject({ people: 2, mature: 2, outcomes: 0, rate_pct: '0.0' })
  expect(find('ivan','dm','previous')).toMatchObject({ people: 2, mature: 2, outcomes: 2, rate_pct: '100.0' })
  expect(find('arch','invitation')).toMatchObject({ people: 1, outcomes: 1 })
  expect(find('risedtc','dm')).toMatchObject({ people: 1, outcomes: 0 })
  expect(find('risedtc','invitation')).toMatchObject({ people: 0, rate_pct: null })
  expect(rows.some(r => r.client_id === 'ivan' && r.lane === 'Warm')).toBe(true)
  expect(find('ivan','dm').period_from).toEqual(new Date('2026-03-28T00:00:00Z'))
  expect(find('ivan','dm').period_to).toEqual(new Date('2026-03-30T00:00:00Z'))
  expect(find('ivan','dm','previous').period_from).toEqual(new Date('2026-03-25T00:00:00Z'))
  expect(find('ivan','dm','previous').period_to).toEqual(new Date('2026-03-27T00:00:00Z'))
})
it('keeps pending first touches outside the mature rate even if they already replied', async () => {
  await db.exec(`insert into outreach_prospects values(10,1,null);
    insert into outreach_messages(id,prospect_id,direction,message_type,channel,sent_at,unipile_message_id,message_text) values
    (18,10,'outbound','dm','linkedin',now()-interval '1 hour','young','first'),
    (19,10,'inbound','dm','linkedin',now()-interval '30 minutes','young-reply','yes');`)
  const { rows } = await db.query<Record<string,unknown>>("select * from inbox_rate_comparison((now() at time zone 'Europe/Warsaw')::date,(now() at time zone 'Europe/Warsaw')::date)")
  expect(rows.find(r => r.client_id === 'ivan' && r.channel === 'dm' && r.lane === '__all__' && r.period === 'current'))
    .toMatchObject({ people: 1, mature: 0, pending: 1, outcomes: 0, rate_pct: null })
})
it('rejects reversed dates and removes public access without changing messages', async () => {
  await expect(db.query("select * from inbox_rate_comparison('2026-03-30','2026-03-28')")).rejects.toThrow(/invalid_dates/)
  const grants = await db.query<{allowed:boolean}>("select has_function_privilege('anon','inbox_rate_comparison(date,date)','execute') allowed")
  expect(grants.rows[0].allowed).toBe(false)
  expect((await db.query<{n:number}>('select count(*)::int n from outreach_messages')).rows[0].n).toBe(19)
})

it('requires a reconciled successful invite and excludes failed or unmatched claims', async () => {
  await db.exec(`insert into outreach_prospects values(11,1,'2026-03-28T10:00:00Z'),(12,1,'2026-03-28T10:00:00Z');
    insert into outreach_messages(id,prospect_id,direction,message_type,channel,sent_at,message_text) values
    (20,11,'outbound','connection_note','linkedin','2026-03-28T08:00:00Z','failed invite'),
    (21,12,'outbound','connection_note','linkedin','2026-03-28T08:00:00Z','unmatched invite');
    insert into outreach_engagement_log values
    (4,11,'connection_request',false,'2026-03-28T08:01:00Z'),
    (5,12,'connection_request',true,'2026-03-28T08:11:00Z');`)
  const { rows } = await read()
  expect(rows.find(r => r.client_id === 'ivan' && r.channel === 'invitation' && r.period === 'current' && r.lane === '__all__'))
    .toMatchObject({ people: 1, mature: 1, outcomes: 1 })
})
it('excludes email and InMail replies even when their channel is missing', async () => {
  await db.exec(`insert into outreach_messages(id,prospect_id,direction,message_type,channel,sent_at,message_text) values
    (22,5,'inbound','email',null,'2026-03-28T09:00:00Z','email answer'),
    (23,5,'inbound','inmail',null,'2026-03-28T09:00:00Z','InMail answer');`)
  const { rows } = await read()
  expect(rows.find(r => r.client_id === 'risedtc' && r.channel === 'dm' && r.period === 'current' && r.lane === '__all__'))
    .toMatchObject({ people: 1, outcomes: 0 })
})
it('does not use an outbound reaction as the first DM', async () => {
  await db.exec(`insert into outreach_prospects values (13,1,null);
    insert into outreach_messages(id,prospect_id,direction,message_type,channel,sent_at,unipile_message_id,is_reaction,message_text) values
    (24,13,'outbound','dm','linkedin','2026-03-28T08:00:00Z','outbound-reaction',true,'reaction'),
    (25,13,'outbound','dm','linkedin','2026-04-02T08:00:00Z','actual-first',false,'first message');`)
  const { rows } = await read()
  expect(rows.find(r => r.client_id === 'ivan' && r.channel === 'dm' && r.period === 'current' && r.lane === '__all__'))
    .toMatchObject({ people: 2, mature: 2, outcomes: 0 })
})
