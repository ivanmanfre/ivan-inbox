import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// 2026-11-15: the follow-up read sent verdict.review_context (26 MB raw, ~10 MB gzip, re-read every
// minute on DMs). The copy it returns drops that key and keeps everything the app reads.
it('follow-up sources keep the verdict the app reads and drop review_context', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      create function auth.role() returns text language sql as $$select 'authenticated'::text$$;
      create table outreach_agent_accounts(client_id text,operator_ids uuid[]);
      insert into outreach_agent_accounts values('ivan',array['11111111-1111-4111-8111-111111111111'::uuid]);
      create table outreach_campaigns(id uuid,client_id text);
      create table outreach_prospects(id uuid,campaign_id uuid,name text,company text,stage text,icp_score int,reply_count int,blacklisted boolean,call_booked_at timestamptz,needs_manual_reply boolean,skip_state text,skip_reason text,next_touch_after timestamptz,enrichment_data jsonb);
      create table outreach_messages(id uuid,prospect_id uuid,direction text,message_type text,message_text text,sent_at timestamptz,created_at timestamptz,send_blocked_at timestamptz,send_blocked_reason text,is_reaction boolean,snoozed_until timestamptz,ai_model text,channel text,unipile_message_id text);
      insert into outreach_campaigns values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ivan');
      insert into outreach_prospects(id,campaign_id,stage,icp_score,reply_count,blacklisted,enrichment_data) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','replied',8,1,false,
        '{"followup_review":{"latest_inbound_id":"i1","latest_outbound_id":"o1","at":"2026-11-15","verdict":{"follow_up":true,"angle":"Ask about Q1","review_context":"${'x'.repeat(5000)}"}},"person_hold":false}');
      insert into outreach_messages(id,prospect_id,direction,message_type,message_text,sent_at,created_at) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','inbound','dm','Yes',now(),now());`)
    await db.exec(readFileSync('db/20261115h_followup_sources_drop_review_context.sql', 'utf8'))
    const r = await db.query<{ seat: string; prospect: { enrichment_data: { followup_review: { latest_inbound_id: string; latest_outbound_id: string; verdict: Record<string, unknown> } } }; rows: unknown[] }>('select * from inbox_followup_sources()')
    expect(r.rows).toHaveLength(1)
    const review = r.rows[0].prospect.enrichment_data.followup_review
    expect(review.latest_inbound_id).toBe('i1')
    expect(review.latest_outbound_id).toBe('o1')
    expect(review.verdict).toEqual({ follow_up: true, angle: 'Ask about Q1' })
    expect(r.rows[0].rows).toHaveLength(1)
    // The stored row keeps its context; only the returned copy is slim.
    expect((await db.query<{ n: number }>("select length(enrichment_data->'followup_review'->'verdict'->>'review_context') n from outreach_prospects")).rows[0].n).toBe(5000)
    expect((await db.query<{ ok: boolean }>("select has_function_privilege('anon','public.inbox_followup_sources()','execute') ok")).rows[0].ok).toBe(false)
    // A prospect whose review is JSON null (or not an object) keeps it as is and never fails the read (review r1).
    await db.exec(`update outreach_prospects set enrichment_data='{"followup_review":null}'::jsonb`)
    const n = await db.query<{ prospect: { enrichment_data: { followup_review: unknown } } }>('select * from inbox_followup_sources()')
    expect(n.rows[0].prospect.enrichment_data.followup_review).toBeNull()
    await db.exec(`update outreach_prospects set enrichment_data='{"followup_review":"text"}'::jsonb`)
    expect((await db.query('select * from inbox_followup_sources()')).rows).toHaveLength(1)
  } finally { await db.close() }
}, 30_000)
