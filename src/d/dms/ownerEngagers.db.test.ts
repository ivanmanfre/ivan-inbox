import { afterAll, beforeAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db = new PGlite()
const migration = readFileSync(new URL('../../../db/20261020_owner_engager_signals.sql', import.meta.url), 'utf8')
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table outreach_agent_accounts(client_id text, operator_ids uuid[]);
    insert into outreach_agent_accounts values ('ivan',array['00000000-0000-0000-0000-000000000009'::uuid]);
    select set_config('request.jwt.claim.role','service_role',false);
    create table integration_config(key text, value text);
    create table client_post_metrics(id uuid, client_id text, title text, post_url text);
    create table client_post_engagers(client_id text, profile_id text, name text, headline text, public_slug text, linkedin_url text, icp_score int, judged_why text, icp_reasoning text, kind text, seen_at timestamptz, post_id uuid, side text);
    create table outreach_prospects(id uuid, campaign_id uuid, linkedin_profile_id text, linkedin_url text);
    create table outreach_campaigns(id uuid, client_id text);
    create function li_slug(text) returns text language sql immutable as $$ select nullif(lower(substring($1 from '/in/([^/?#]+)')),'') $$;
    insert into integration_config values ('rise_do_not_target','["justus skincare"]');
    insert into outreach_campaigns values ('00000000-0000-0000-0000-000000000001','risedtc');
    insert into outreach_prospects values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',null,'https://www.linkedin.com/in/existing-slug');
    insert into client_post_metrics values ('00000000-0000-0000-0000-000000000003','risedtc','Real post','https://www.linkedin.com/posts/real');
    insert into client_post_engagers(client_id,profile_id,name,headline,public_slug,icp_score,kind,seen_at,post_id,side) values
      ('risedtc','buyer','Buyer','Founder at Example','buyer',9,'comment',now(),'00000000-0000-0000-0000-000000000003','owner'),
      ('risedtc','client','Client','Founder at JustUs Skincare','client',9,'reaction',now(),'00000000-0000-0000-0000-000000000003','owner'),
      ('risedtc','client','Client','DTC Founder','client',9,'reaction',now()-interval '1 day','00000000-0000-0000-0000-000000000003','owner'),
      ('risedtc','existing','Existing','Founder at Example','existing-slug',9,'reaction',now(),'00000000-0000-0000-0000-000000000003','owner'),
      ('risedtc','low','Low score','Founder at Example','low',6,'reaction',now(),'00000000-0000-0000-0000-000000000003','owner'),
      ('risedtc','old','Old','Founder at Example','old',9,'reaction',now()-interval '22 days','00000000-0000-0000-0000-000000000003','owner');`)
  await db.exec(migration.slice(migration.indexOf('create table if not exists public.owner_engager_dismissals'), migration.lastIndexOf('commit;')))
})
afterAll(() => db.close())
it('keeps real new buyers, excluding clients, existing prospects, old and weak engagement', async () => {
  const r = await db.query<{profile_id:string}>('select * from owner_engager_cards()')
  expect(r.rows.map(r => r.profile_id)).toEqual(['buyer'])
})
it('keeps anonymous callers out and grants authenticated reads', async () => {
  const r = await db.query<{anon:boolean,authed:boolean}>(`select has_function_privilege('anon','owner_engager_cards()','execute') anon, has_function_privilege('authenticated','owner_engager_cards()','execute') authed`)
  expect(r.rows[0]).toEqual({anon:false,authed:true})
})
it('dismisses until a newer engagement and supports undo', async () => {
  await db.exec(`select owner_engager_dismiss('risedtc','buyer')`)
  expect((await db.query(`select * from owner_engager_cards() where profile_id='buyer'`)).rows).toHaveLength(0)
  await db.exec(`update client_post_engagers set seen_at=now()+interval '1 minute' where profile_id='buyer'`)
  expect((await db.query(`select * from owner_engager_cards() where profile_id='buyer'`)).rows).toHaveLength(1)
  await db.exec(`update client_post_engagers set seen_at=now()-interval '1 minute' where profile_id='buyer'; select owner_engager_undismiss('risedtc','buyer')`)
  expect((await db.query(`select * from owner_engager_cards() where profile_id='buyer'`)).rows).toHaveLength(1)
})

it('denies non-operators for every owner RPC and permits the registered operator', async () => {
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
  for (const call of ["owner_engager_cards()", "owner_engager_dismiss('risedtc','buyer')", "owner_engager_undismiss('risedtc','buyer')"]) {
    await expect(db.query(`select * from ${call}`)).rejects.toMatchObject({code:'42501'})
  }
  await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',false)")
  expect((await db.query('select * from owner_engager_cards()')).rows).toHaveLength(1)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
})
