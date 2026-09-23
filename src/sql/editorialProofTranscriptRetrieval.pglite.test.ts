import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('db/210_editorial_proof_transcript_retrieval.sql','utf8')
const rollback = readFileSync('db/210_editorial_proof_transcript_retrieval_rollback.sql','utf8')
const digest = (value:string) => createHash('sha256').update(value).digest('hex')

async function setup() {
  const db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema extensions;create domain extensions.vector as double precision[];
    create function extensions.cosine_distance(a extensions.vector,b extensions.vector) returns double precision
      language sql immutable as $$ select 1-(select sum(x*y) from unnest(a::double precision[],b::double precision[]) z(x,y)) /
        nullif(sqrt((select sum(x*x) from unnest(a::double precision[]) x)) * sqrt((select sum(y*y) from unnest(b::double precision[]) y)),0) $$;
    create operator extensions.<=> (leftarg=extensions.vector,rightarg=extensions.vector,procedure=extensions.cosine_distance);
    set search_path=public,extensions;
    create table public.transcripts(id uuid primary key,source text,transcript_text text,transcript_json jsonb);
    create table public.transcript_chunks(id uuid primary key,transcript_id uuid,chunk_index integer,chunk_text text,
      speaker text[],embedding extensions.vector,quarantine_reason text);
    create table public.safe_sources(client_id text,source_id text,seen_version integer,source_kind text,
      source_client_scope text,passage text,gap_state jsonb,permission_state text,candidate_fields jsonb);
    create view public.editorial_attribution_safe_sources_v as select * from public.safe_sources;
    create function public.match_documents() returns integer language sql immutable as $$ select 1 $$;`)
  await db.exec(migration)
  return db
}

const attr=(transcript_id:string,transcriptText:string,speaker_name:string,speaker_role:'author'|'third_party',excerpt:string) => ({
  transcript_id,transcript_sha256:digest(`${transcriptText}\n--TRANSCRIPT-JSON--\nnull`),
  transcript_text_sha256:digest(transcriptText),transcript_json_sha256:digest('null'),
  excerpt,excerpt_sha256:digest(excerpt),
  speaker_name,speaker_role,attribution_state:'verified',segment_index:0,quote_start:0,quote_end:excerpt.length,
})
const fields=(a:ReturnType<typeof attr>,firstPerson:boolean) => JSON.stringify({
  transcript_sha256:a.transcript_sha256,transcript_text_sha256:a.transcript_text_sha256,
  transcript_json_sha256:a.transcript_json_sha256,passage_attributions:[a],first_person_eligible:firstPerson,
})

// PGlite extension/operator initialization can exceed Vitest's 5s default on a cold public checkout.
describe('210 proof transcript retrieval',{ timeout:15_000 },()=>{
  it('returns only the exact tenant and single verified speaker excerpt in native row shape',async()=>{
    const db=await setup(), ivan='11111111-1111-4111-8111-111111111111',rise='22222222-2222-4222-8222-222222222222'
    const buyer=attr(ivan,'prefix buyer pain exact suffix','Buyer Name','third_party','buyer pain exact')
    await db.query(`insert into transcripts values($1,'ivan-listener','prefix buyer pain exact suffix',null),
      ($2,'fathom-risedtc','other tenant exact',null)`,[ivan,rise])
    await db.query(`insert into transcript_chunks values
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',$1,0,'prefix buyer pain exact suffix',array['Buyer Name'],array[1.0,0.0]::extensions.vector,null),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',$2,0,'other tenant exact',array['Mattan Danino'],array[1.0,0.0]::extensions.vector,null)`,[ivan,rise])
    await db.query(`insert into safe_sources values
       ('ivan',$1,1,'call','ivan','buyer pain exact',null,'unknown',$3::jsonb),
       ('risedtc',$2,1,'call','risedtc','other tenant exact',null,'unknown',$4::jsonb)`,
      [ivan,rise,fields(buyer,false),fields(attr(rise,'other tenant exact','Mattan Danino','author','other tenant exact'),true)])
    const result=await db.query<Record<string,unknown>>(`select * from public.editorial_match_proof_transcripts(
      array[1.0,0.0]::extensions.vector,'ivan',15)`)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',content:'buyer pain exact'})
    expect(result.rows[0].metadata).toMatchObject({client_id:'ivan',speaker_name:'Buyer Name',speaker_role:'third_party',
      ownership_state:'verified_client_registry_source',first_person_eligible:false,attribution_use:'attributed_research_only'})
    expect(typeof result.rows[0].similarity).toBe('number')
  })

  it('drops ambiguous, mismatched, unowned, quarantined, multi-speaker and fabricated attribution rows',async()=>{
    const db=await setup(),id='33333333-3333-4333-8333-333333333333',good=attr(id,'verified words','Davorin Smit','author','verified words')
    await db.query(`insert into transcripts values($1,'fireflies-arch','verified words',null)`,[id])
    await db.query(`insert into transcript_chunks values
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',$1,0,'verified words',array['Unknown'],array[1.0,0.0]::extensions.vector,null),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',$1,1,'verified words',array['Davorin Smit','Other'],array[1.0,0.0]::extensions.vector,null),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',$1,2,'verified words',array['Davorin Smit'],array[1.0,0.0]::extensions.vector,'legacy_unowned'),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',null,3,'verified words',array['Davorin Smit'],array[1.0,0.0]::extensions.vector,null)`,[id])
    await db.query(`insert into safe_sources values('arch',$1,1,'call','arch','verified words',null,'unknown',$2::jsonb)`,[id,fields(good,true)])
    const result=await db.query(`select * from public.editorial_match_proof_transcripts(
      array[1.0,0.0]::extensions.vector,'arch',15)`)
    expect(result.rows).toEqual([])
  })

  it('fails closed on duplicate attribution, invalid client/count and preserves ordinary match_documents',async()=>{
    const db=await setup(),id='44444444-4444-4444-8444-444444444444',a=attr(id,'author words','Ivan Manfredi','author','author words')
    await db.query(`insert into transcripts values($1,'ivan-listener','author words',null)`,[id])
    await db.query(`insert into transcript_chunks values
      ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',$1,0,'author words',array['Ivan Manfredi'],array[1.0,0.0]::extensions.vector,null)`,[id])
    await db.query(`insert into safe_sources values('ivan',$1,1,'call','ivan','author words',null,'unknown',$2::jsonb)`,
      [id,JSON.stringify({...JSON.parse(fields(a,true)),passage_attributions:[a,a]})])
    expect((await db.query(`select * from editorial_match_proof_transcripts(array[1.0,0.0]::extensions.vector,'ivan',15)`)).rows).toEqual([])
    await expect(db.query(`select * from editorial_match_proof_transcripts(array[1.0,0.0]::extensions.vector,null,15)`)).rejects.toThrow(/unsupported client/)
    await expect(db.query(`select * from editorial_match_proof_transcripts(array[1.0,0.0]::extensions.vector,'other',15)`)).rejects.toThrow(/unsupported client/)
    await expect(db.query(`select * from editorial_match_proof_transcripts(array[1.0,0.0]::extensions.vector,'ivan',16)`)).rejects.toThrow(/1\.\.15/)
    const ordinary=await db.query<{n:string}>(`select count(*) n from pg_proc where proname='match_documents'`)
    expect(Number(ordinary.rows[0].n)).toBe(1)
  })

  it('never resurrects an older safe version when the newest source head is quarantined',async()=>{
    const db=await setup(),id='55555555-5555-4555-8555-555555555555'
    const a=attr(id,'older verified words','Ivan Manfredi','author','older verified words')
    await db.query(`insert into transcripts values($1,'ivan-listener','older verified words',null)`,[id])
    await db.query(`insert into transcript_chunks values
      ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1',$1,0,'older verified words',array['Ivan Manfredi'],array[1.0,0.0]::extensions.vector,null)`,[id])
    await db.query(`insert into safe_sources values
      ('ivan',$1,1,'call','ivan','older verified words',null,'unknown',$2::jsonb),
      ('ivan',$1,2,'call','ivan',null,'{"reason":"partial"}','unknown','{}')`,[id,fields(a,true)])
    const rows=await db.query(`select * from editorial_match_proof_transcripts(
      array[1.0,0.0]::extensions.vector,'ivan',15)`)
    expect(rows.rows).toEqual([])
  })

  it('never resurrects an older call when the newest source head changed kind',async()=>{
    const db=await setup(),id='77777777-7777-4777-8777-777777777777'
    const a=attr(id,'old call words','Ivan Manfredi','author','old call words')
    await db.query(`insert into transcripts values($1,'ivan-listener','old call words',null)`,[id])
    await db.query(`insert into transcript_chunks values
      ('ffffffff-ffff-4fff-8fff-fffffffffff1',$1,0,'old call words',array['Ivan Manfredi'],array[1.0,0.0]::extensions.vector,null)`,[id])
    await db.query(`insert into safe_sources values
      ('ivan',$1,1,'call','ivan','old call words',null,'unknown',$2::jsonb),
      ('ivan',$1,2,'public_post','ivan','replacement post body',null,'public_source','{}')`,[id,fields(a,true)])
    const rows=await db.query(`select * from editorial_match_proof_transcripts(
      array[1.0,0.0]::extensions.vector,'ivan',15)`)
    expect(rows.rows).toEqual([])
  })

  it('drops stale attribution when current transcript bytes change',async()=>{
    const db=await setup(),id='66666666-6666-4666-8666-666666666666'
    const stale=attr(id,'original author words','Davorin Smit','author','original author words')
    await db.query(`insert into transcripts values($1,'fireflies-arch','mutated transcript bytes',null)`,[id])
    await db.query(`insert into transcript_chunks values
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',$1,0,'original author words',array['Davorin Smit'],array[1.0,0.0]::extensions.vector,null)`,[id])
    await db.query(`insert into safe_sources values
      ('arch',$1,1,'call','arch','original author words',null,'unknown',$2::jsonb)`,[id,fields(stale,true)])
    const rows=await db.query(`select * from editorial_match_proof_transcripts(
      array[1.0,0.0]::extensions.vector,'arch',15)`)
    expect(rows.rows).toEqual([])
  })

  it('reapplies and rolls back without touching ordinary retrieval functions',async()=>{
    const db=await setup();await db.exec(migration);await db.exec(rollback);await db.exec(rollback)
    const functions=await db.query<{n:string}>(`select count(*) n from pg_proc where proname='editorial_match_proof_transcripts'`)
    expect(Number(functions.rows[0].n)).toBe(0)
    const ordinary=await db.query<{n:string}>(`select count(*) n from pg_proc where proname='match_documents'`)
    expect(Number(ordinary.rows[0].n)).toBe(1)
  })
})
