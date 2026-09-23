import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = (name: string) => readFileSync(`db/${name}`, 'utf8')
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

describe('native draft final QA acceptance', { timeout: 120_000 }, () => {
  it('fails closed until accepted review evidence matches the exact final copy', async () => {
    const db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.carousel_drafts(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        post_body text,qa jsonb,
        board_visible boolean default false,scheduled_at timestamptz,published_at timestamptz);
      create table public.video_ideas(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        script text,editorial_qa jsonb);
      create table public.lm_drafts_v2(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        post_body text,qa jsonb);
      create table public.editorial_brief_versions(client_id text,brief_id text,version integer,payload jsonb);
      create table public.editorial_native_draft_dispatches(client_id text,artifact_id text primary key,
        native_draft_id uuid,request_id text,brief_id text,brief_version integer,brief_hash text,
        dispatch_state text,completed_at timestamptz,last_error text);
      create or replace function public.editorial_guard(text,text) returns void language plpgsql as $$ begin end $$;`)
    await db.exec(sql('108_editorial_native_draft_finalize.sql'))
    await db.exec(sql('109_editorial_native_draft_acceptance.sql'))
    const id = '11111111-1111-4111-8111-111111111111'
    await db.exec(`insert into editorial_brief_versions values ('ivan','brief-1',1,'{"editorial_direction":{"format":"text"}}');
      insert into carousel_drafts(id,client_id,editorial_brief_artifact_id)
        values ('${id}','ivan','artifact-1');
      insert into editorial_native_draft_dispatches values
        ('ivan','artifact-1','${id}','request-1','brief-1',1,'brief-hash','claimed',null,null);`)
    const copy = 'Exact reviewed copy.'
    const base = { assessment_id: 'assessment-1', reviewed_copy_sha256: hash(copy),
      reviewer_response_id: 'provider-response-1', reviewer_provenance: 'provider_response' }
    const call = (qa: object, finalCopy = copy) => db.query<{ r: any }>(
      `select public.editorial_complete_native_draft('clientops','ivan','artifact-1','request-1',
       'brief-hash',$1,'assessment-1',$2::jsonb) r`, [finalCopy, JSON.stringify(qa)])

    expect((await call({ ...base, verdict: 'needs_regenerate' })).rows[0].r)
      .toMatchObject({ decision: 'qa_rejected', rejection_reason: 'accepted QA verdict required' })
    expect((await call({ ...base, verdict: 'accepted', reviewed_copy_sha256: '0'.repeat(64) })).rows[0].r)
      .toMatchObject({ decision: 'qa_rejected', rejection_reason: 'QA review does not match final copy' })
    expect((await call({ ...base, verdict: 'accepted', reviewer_provenance: 'model_output' })).rows[0].r)
      .toMatchObject({ decision: 'qa_rejected', rejection_reason: 'trusted reviewer provenance required' })
    expect((await call({ ...base, verdict: 'accepted' }, `${copy} rewritten`)).rows[0].r)
      .toMatchObject({ decision: 'qa_rejected', rejection_reason: 'QA review does not match final copy' })
    expect((await db.query<any>(`select dispatch_state from editorial_native_draft_dispatches`)).rows[0].dispatch_state)
      .toBe('claimed')

    const accepted = await call({ ...base, verdict: 'accepted' })
    expect(accepted.rows[0].r).toMatchObject({ dispatch_state: 'complete', decision: 'persist_final' })
    const row = (await db.query<any>(`select post_body,qa from carousel_drafts`)).rows[0]
    expect(row.post_body).toBe(copy)
    expect(row.qa).toMatchObject({ verdict: 'accepted', final_copy_sha256: hash(copy),
      reviewer_response_id: 'provider-response-1' })
    const attempts = await db.query<any>(`select accepted,rejection_reason,candidate_copy from
      editorial_native_draft_qa_attempts order by attempt_id`)
    expect(attempts.rows).toHaveLength(5)
    expect(attempts.rows.slice(0, 4).every((attempt: any) => !attempt.accepted)).toBe(true)
    expect(attempts.rows[0].candidate_copy).toBe(copy)
    await db.close()
  })

  it('cannot complete when the linked native row is missing or belongs to another artifact', async () => {
    const db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.carousel_drafts(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        post_body text,qa jsonb,board_visible boolean default false,scheduled_at timestamptz,published_at timestamptz);
      create table public.video_ideas(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        script text,editorial_qa jsonb);
      create table public.lm_drafts_v2(id uuid primary key,client_id text,editorial_brief_artifact_id text,
        post_body text,qa jsonb);
      create table public.editorial_brief_versions(client_id text,brief_id text,version integer,payload jsonb);
      create table public.editorial_native_draft_dispatches(client_id text,artifact_id text primary key,
        native_draft_id uuid,request_id text,brief_id text,brief_version integer,brief_hash text,
        dispatch_state text,completed_at timestamptz,last_error text);
      create or replace function public.editorial_guard(text,text) returns void language plpgsql as $$ begin end $$;`)
    await db.exec(sql('108_editorial_native_draft_finalize.sql'))
    await db.exec(sql('109_editorial_native_draft_acceptance.sql'))
    const copy = 'Exact reviewed copy.'
    const qa = JSON.stringify({ assessment_id: 'assessment-1', verdict: 'accepted',
      reviewed_copy_sha256: hash(copy), reviewer_response_id: 'provider-response-1',
      reviewer_provenance: 'provider_response' })
    const call = () => db.query<{ r: any }>(`select public.editorial_complete_native_draft(
      'clientops','ivan','artifact-missing','request-1','brief-hash',$1,'assessment-1',$2::jsonb) r`,
      [copy,qa])
    const id = '22222222-2222-4222-8222-222222222222'
    await db.exec(`insert into editorial_brief_versions values
      ('ivan','brief-1',1,'{"editorial_direction":{"format":"text"}}');
      insert into editorial_native_draft_dispatches values
      ('ivan','artifact-missing','${id}','request-1','brief-1',1,'brief-hash','claimed',null,null);`)
    expect((await call()).rows[0].r).toMatchObject({ decision: 'qa_rejected', persisted: false,
      rejection_reason: 'linked native draft not found' })
    expect((await db.query<any>(`select dispatch_state from editorial_native_draft_dispatches`)).rows[0].dispatch_state)
      .toBe('claimed')

    await db.exec(`insert into carousel_drafts(id,client_id,editorial_brief_artifact_id)
      values ('${id}','ivan','some-other-artifact')`)
    expect((await call()).rows[0].r).toMatchObject({ decision: 'qa_rejected', persisted: false,
      rejection_reason: 'linked native draft identity mismatch' })
    expect((await db.query<any>(`select dispatch_state from editorial_native_draft_dispatches`)).rows[0].dispatch_state)
      .toBe('claimed')
    await db.close()
  })
})
