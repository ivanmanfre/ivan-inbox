import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('projects only person-level interest across all four seats from row provenance', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$select 'service_role'::text$$;
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table public.outreach_agent_accounts(client_id text,operator_ids uuid[]);
      create table public.outreach_campaigns(id text primary key, name text, client_id text);
      create table public.outreach_prospects(id text primary key, campaign_id text, trigger_type text, enrichment_data jsonb,
        connection_sent_at timestamptz,connected_at timestamptz,call_booked_at timestamptz,scored_at timestamptz,
        blacklisted boolean,icp_score integer,skip_state text,skip_reason text,stage text);
      create table public.outreach_messages(id text primary key,prospect_id text,direction text,message_text text,
        sent_at timestamptz,created_at timestamptz,message_type text,reply_intent text,approved_at timestamptz,
        is_reaction boolean,channel text,unipile_message_id text,send_blocked_at timestamptz,send_blocked_reason text);
      create table public.outreach_engagement_log(prospect_id text,action_type text,success boolean,created_at timestamptz);`)
    const sql = readFileSync('db/20261020_interest_lanes_read.sql', 'utf8')
    try { await db.exec(sql) } catch (e) {
      const x = e as Error & { position?: string }
      const p = Number(x.position ?? 0)
      throw new Error(`${x.message} near ${sql.slice(Math.max(0,p-100),p+100)}`)
    }
    await db.exec(`insert into public.outreach_campaigns values
      ('iv','Warm',null),('ri','Warm (his engagers)','risedtc'),('ar','ARCH Cold','arch'),('sw','SwishDM anchor','swishdm');
      insert into public.outreach_prospects(id,campaign_id,trigger_type,enrichment_data) values
      ('iv-own','iv','engaged_post','{"lane":"own_post_engager"}'),
      ('iv-hire','iv','hiring','{}'),
      ('ri-person','ri',null,'{"source":"rise_warm_engager","engagement_kind":"reaction","post_id":"p","anchor":"a"}'),
      ('ri-company','ri',null,'{"source":"rise_warm_engager","engagement_kind":"reaction","post_id":"p","anchor":"a","company_first":{"post_url":"u","observed_at":"2026-10-20"}}'),
      ('ri-company-only','ri',null,'{"source":"rise_warm_engager","company_first":{"post_url":"u","observed_at":"2026-10-20"}}'),
      ('ar-warm','ar',null,'{"source_kind":"competitor_post_engager","lane":"engager_warm"}'),
      ('ar-hire','ar',null,'{"source_kind":"hiring_signal","lane":"hiring_signal"}'),
      ('sw-anchor','sw',null,'{"source":"swishdm_anchor_engager"}'),
      ('sw-free','sw',null,'{"source":"swishdm_free_pool"}');`)
    const rows = await db.query<{ id: string; client_id: string; source_lane: string }>('select id,client_id,source_lane from public.inbox_interest_prospects_v order by id')
    expect(rows.rows).toEqual([
      { id: 'ar-warm', client_id: 'arch', source_lane: 'competitor_engager' },
      { id: 'iv-own', client_id: 'ivan', source_lane: 'own_post_engager' },
      { id: 'ri-company', client_id: 'risedtc', source_lane: 'competitor_engager' },
      { id: 'ri-person', client_id: 'risedtc', source_lane: 'competitor_engager' },
      { id: 'sw-anchor', client_id: 'swishdm', source_lane: 'competitor_engager' },
    ])
    await db.exec(`update public.outreach_prospects set connection_sent_at=now()-interval '4 days' where id in ('ar-warm','ar-hire');
      insert into public.outreach_messages(id,prospect_id,direction,message_text,sent_at,created_at,message_type) values
      ('m1','ar-warm','outbound','hello',now()-interval '4 days',now()-interval '4 days','connection_note'),
      ('m2','ar-hire','outbound','hello',now()-interval '4 days',now()-interval '4 days','connection_note');
      insert into public.outreach_engagement_log(prospect_id,action_type,success,created_at) values
      ('ar-warm','connection_request',true,now()-interval '4 days'),('ar-hire','connection_request',true,now()-interval '4 days');`)
    const perf = await db.query<{ client_id: string; source_lane: string; invites_7d: number }>(
      `select client_id,source_lane,invites_7d from public.inbox_interest_perf_v where client_id='arch'`)
    expect(perf.rows).toEqual([{ client_id: 'arch', source_lane: 'competitor_engager', invites_7d: 1 }])
    const flow = await db.query<{ lane: string; sent_out: number }>(
      `select lane,sent_out from public.inbox_interest_replacement_v where client_id='arch'`)
    expect(flow.rows).toEqual([{ lane: 'competitor_engager', sent_out: 1 }])
    const rate = await db.query<{ lane: string; people: number; mature: number }>(
      `select lane,people,mature from public.inbox_interest_rate_comparison(current_date-7,current_date-1)
       where client_id='arch' and channel='invitation' and period='current' order by lane`)
    expect(rate.rows).toEqual([
      { lane: '__all__', people: 1, mature: 1 },
      { lane: 'competitor_engager', people: 1, mature: 1 },
    ])
  } finally { await db.close() }
}, 30_000)
