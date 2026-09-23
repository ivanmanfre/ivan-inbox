import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('db/207_editorial_call_attribution.sql', 'utf8')

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create or replace function public.editorial_guard(p_gate text,p_client_id text) returns void
      language plpgsql as $$ begin if p_gate<>'clientops' or p_client_id not in ('ivan','risedtc','arch')
        then raise exception 'denied'; end if; end $$;
    create table public.transcripts(id uuid primary key,source text,fireflies_id text,date timestamptz,
      transcript_text text,transcript_json jsonb,participants text[]);
    create table public.lm_idea_candidates(id uuid primary key,source text,source_ref text,evidence jsonb);
    create table public.client_ideas(id uuid primary key,client_id text,source_label text,meta jsonb,
      score_breakdown jsonb);
    create table public.editorial_sources(client_id text,source_id text,seen_version integer,source_kind text,
      source_client_scope text,source_url text,excerpt_pointer text,owner text,source_published_at timestamptz,
      published_date_state text,captured_at timestamptz,body_sha256 text,passage text,retained_context text,
      limitation text,independent boolean,derived_from text,permission_state text,gap_state jsonb,
      candidate_fields jsonb,snapshot_hash text,created_at timestamptz default now(),
      primary key(client_id,source_id,seen_version));`)
  await db.exec(migration)
  await db.exec(migration)
  return db
}

describe('207 editorial call attribution', { timeout: 60_000 }, () => {
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  it('returns only unique speaker-bound quote ranges for all three transcript shapes', async () => {
    const db = await setup()
    await db.exec(`insert into public.transcripts values
      ('11111111-1111-4111-8111-111111111111','ivan-listener','ivan-call-1','2026-09-01',
       'joined text','[{"speaker":"External Buyer","start":1,"end":2,"text":"buyer pain exactly"},{"speaker":"Unattributed","start":3,"end":4,"text":"ambient gap exactly"}]','{}'),
      ('22222222-2222-4222-8222-222222222222','fathom-risedtc',null,'2026-09-02',
       'joined text','{"recording_id":"rise-call-1","transcript":[{"speaker":{"display_name":"External Buyer"},"timestamp":"00:01:00","text":"merchant pain exactly"}]}','{}'),
      ('33333333-3333-4333-8333-333333333333','fireflies-arch',null,'2026-09-03',
       E'Davorin Smit: delivery example exactly\\nOther Person: other words',
       '{"recording_id":"arch-call-1"}','{}');
      insert into public.lm_idea_candidates values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ivan_call','ivan-call-1','[{"quote":"buyer pain exactly"}]'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','ivan_call','ivan-call-1','[{"quote":"ambient gap exactly"}]');
      insert into public.client_ideas values
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','risedtc','From your sales calls',
       '{"source_ts":"rise-call-1|2026-09-02"}','{"why":"merchant pain exactly"}'),
      ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','arch','From your calls',
       '{"source_ts":"arch-call-1|2026-09-03"}','{"why":"delivery example exactly"}');`)
    const ivan = await db.query<Record<string, unknown>>(`select candidate_id,speaker_name,speaker_role,
      attribution_state,segment_index,segment_start,segment_end,quote_start,quote_end
      from public.editorial_attributed_call_passages('clientops','ivan',array[
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'])`)
    expect(ivan.rows).toEqual([{ candidate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      speaker_name: 'External Buyer', speaker_role: 'third_party', attribution_state: 'verified',
      segment_index: 0, segment_start: '1', segment_end: '2', quote_start: 0, quote_end: 18 }])
    const rise = await db.query<Record<string, unknown>>(`select speaker_name,speaker_role,segment_start
      from public.editorial_attributed_call_passages('clientops','risedtc',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'])`)
    expect(rise.rows).toEqual([{ speaker_name: 'External Buyer', speaker_role: 'third_party', segment_start: '00:01:00' }])
    const arch = await db.query<Record<string, unknown>>(`select speaker_name,speaker_role,segment_index,quote_start
      from public.editorial_attributed_call_passages('clientops','arch',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'])`)
    expect(arch.rows).toEqual([{ speaker_name: 'Davorin Smit', speaker_role: 'author', segment_index: 0, quote_start: 0 }])
  })

  it('binds the digest to structured speaker evidence as well as rendered text', async () => {
    const db = await setup()
    await db.exec(`insert into public.transcripts values
      ('11111111-1111-4111-8111-111111111111','ivan-listener','ivan-call-1','2026-09-01',
       'unchanged text','[{"speaker":"Ivan Manfredi","text":"exact quote"}]','{}');
      insert into public.lm_idea_candidates values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ivan_call','ivan-call-1','[{"quote":"exact quote"}]');`)
    const read = async () => (await db.query<Record<string,string>>(`select transcript_sha256,
      transcript_text_sha256,transcript_json_sha256,speaker_role
      from public.editorial_attributed_call_passages('clientops','ivan',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'])`)).rows[0]
    const author = await read()
    await db.exec(`update public.transcripts set transcript_json='[{"speaker":"Buyer Name","text":"exact quote"}]'
      where id='11111111-1111-4111-8111-111111111111'`)
    const buyer = await read()
    expect(author.transcript_text_sha256).toBe(buyer.transcript_text_sha256)
    expect(author.transcript_json_sha256).not.toBe(buyer.transcript_json_sha256)
    expect(author.transcript_sha256).not.toBe(buyer.transcript_sha256)
    expect([author.speaker_role,buyer.speaker_role]).toEqual(['author','third_party'])
  })

  const rawFixturePath = '../private/attribution-probe.json'
  const sourceHeadsPath = '../private/current-call-source-heads.json'
  const expectedFixturePath = '../private/attribution-expected.json'
  const realFixture = existsSync(rawFixturePath) && existsSync(sourceHeadsPath) && existsSync(expectedFixturePath) ? it : it.skip
  realFixture('attributes the retained raw probes through the database function', async () => {
    const db = await setup()
    const probes = JSON.parse(readFileSync(rawFixturePath, 'utf8')) as Array<Record<string, unknown>>
    const heads = JSON.parse(readFileSync(sourceHeadsPath, 'utf8')) as Array<Record<string, unknown>>
    const expected = (JSON.parse(readFileSync(expectedFixturePath, 'utf8')) as { real_fixture: { sql: {
      unattributed_transcript_id:string;ivan_attributed_transcript_id:string;ivan_attributed_count:number;
      ivan_attributed_match:Record<string,unknown>;risedtc_transcript_id:string;
      risedtc_rows:Array<Record<string,unknown>>;arch_transcript_id:string;arch_rows:Array<Record<string,unknown>>
    } } }).real_fixture.sql
    const laneBySource: Record<string, 'ivan' | 'risedtc' | 'arch'> = {
      'ivan-listener': 'ivan', 'fathom-risedtc': 'risedtc', 'fireflies-arch': 'arch',
    }
    const candidateIds: Record<string, string[]> = {}
    for (const probe of probes) {
      const transcriptId = String(probe.id)
      const clientId = laneBySource[String(probe.source)]
      const head = heads.find(row => row.client_id === clientId && row.source_id === transcriptId)
      if (!head) continue
      const fields = head.candidate_fields as Record<string, unknown>
      const ids = (fields.candidate_ids as string[]).map(String)
      const quotes = String(head.passage).split('\n\n[Verified separate passage from the same call]\n\n')
      candidateIds[transcriptId] = ids
      await db.query(`insert into public.transcripts(id,source,fireflies_id,date,transcript_text,transcript_json,participants)
        values($1,$2,null,$3,$4,$5,$6)`, [transcriptId, probe.source, probe.date, probe.transcript_text,
        JSON.stringify(probe.transcript_json), probe.participants])
      for (let index = 0; index < ids.length; index++) {
        if (clientId === 'ivan') await db.query(`insert into public.lm_idea_candidates values($1,'ivan_call',$2,$3)`,
          [ids[index], transcriptId, JSON.stringify([{ quote: quotes[index % quotes.length] }])])
        else {
          const recordingId = String((probe.transcript_json as Record<string, unknown>).recording_id)
          await db.query(`insert into public.client_ideas values($1,$2,$3,$4,$5)`, [ids[index], clientId,
            clientId === 'risedtc' ? 'From your sales calls' : 'From your calls',
            JSON.stringify({ source_ts: `${recordingId}|${String(probe.date)}` }), JSON.stringify({ why: quotes[index % quotes.length] })])
        }
      }
    }
    const read = async (clientId: string, transcriptId: string) => (await db.query<Record<string, unknown>>(
      `select speaker_name,speaker_role,attribution_state,segment_index,quote_start,quote_end,transcript_sha256,excerpt_sha256
       from public.editorial_attributed_call_passages('clientops',$1,$2) order by candidate_id`,
      [clientId, candidateIds[transcriptId]])).rows
    expect(await read('ivan',expected.unattributed_transcript_id)).toEqual([])
    const ivanAttributed = await read('ivan',expected.ivan_attributed_transcript_id)
    expect(ivanAttributed).toHaveLength(expected.ivan_attributed_count)
    expect(ivanAttributed).toEqual(ivanAttributed.map(() => expect.objectContaining({
      ...expected.ivan_attributed_match,
    })))
    expect(await read('risedtc',expected.risedtc_transcript_id)).toEqual(
      expected.risedtc_rows.map(row => expect.objectContaining(row)))
    expect(await read('arch',expected.arch_transcript_id)).toEqual(
      expected.arch_rows.map(row => expect.objectContaining(row)))
  })

  it('sanitizes every legacy call head and preserves only fully bound attributed passages', async () => {
    const db = await setup()
    const base = `('ivan','%s',1,'call','ivan',null,'transcripts.id=x','private call','2026-09-01','known',
      '2026-09-01','%s','retained quote','context','internal only',true,null,'unknown',null,%s,'%s',now())`
    const legacy = base.replace('%s','urn:transcript:legacy').replace('%s','a'.repeat(64))
      .replace('%s',`'{}'::jsonb`).replace('%s','b'.repeat(64))
    const excerpt = 'retained quote'
    const transcriptHash = 'c'.repeat(64), textHash = 'd'.repeat(64), jsonHash = 'e'.repeat(64)
    const fields = JSON.stringify({ transcript_sha256:transcriptHash, transcript_text_sha256:textHash,
      transcript_json_sha256:jsonHash, passage_attributions: [{ attribution_state:'verified', speaker_name:'Ivan Manfredi',
      speaker_role:'author', transcript_sha256:transcriptHash, transcript_text_sha256:textHash,
      transcript_json_sha256:jsonHash, excerpt, excerpt_sha256:digest(excerpt),
      segment_index:4, quote_start:2, quote_end:2+excerpt.length }] })
    const verified = base.replace('%s','verified').replace('%s',digest(excerpt))
      .replace('%s',`'${fields}'::jsonb`).replace('%s','f'.repeat(64))
    await db.exec(`insert into public.editorial_sources values ${legacy},${verified}`)
    const rows = await db.query<{ source_id:string; passage:string|null; gap_state:unknown; candidate_fields:Record<string, unknown> }>(`
      select source_id,passage,gap_state,candidate_fields from public.editorial_attribution_safe_sources_v order by source_id`)
    expect(rows.rows[0]).toMatchObject({ source_id:'urn:transcript:legacy', passage:null,
      gap_state:{ reason:'partial' }, candidate_fields:{ first_person_eligible:false, attribution_use:'quarantined' } })
    expect(rows.rows[1]).toMatchObject({ source_id:'verified', passage:'retained quote',
      candidate_fields:{ first_person_eligible:true, attribution_use:'author_experience' } })
  })

  it('quarantines every absent/null required attribution field and malformed integer without SQL errors', async () => {
    const db = await setup(), excerpt = 'bound quote'
    const valid = { attribution_state:'verified', speaker_name:'Ivan Manfredi', speaker_role:'author',
      transcript_sha256:'a'.repeat(64), transcript_text_sha256:'b'.repeat(64), transcript_json_sha256:'c'.repeat(64),
      excerpt, excerpt_sha256:digest(excerpt), segment_index:0, quote_start:0, quote_end:excerpt.length }
    const corruptions: unknown[] = []
    for (const key of Object.keys(valid)) {
      const missing: Record<string,unknown> = { ...valid }; delete missing[key]
      corruptions.push([missing], [{ ...valid, [key]:null }])
    }
    for (const key of ['segment_index','quote_start','quote_end'])
      for (const value of [-1, 0.5, '0', 999999999999999999999, true, {}, []])
        corruptions.push([{ ...valid, [key]:value }])
    corruptions.push({}, 'not an array', null, [], [null], ['author'])
    for (let i=0;i<corruptions.length;i++) {
      const fields = { transcript_sha256:valid.transcript_sha256, transcript_text_sha256:valid.transcript_text_sha256,
        transcript_json_sha256:valid.transcript_json_sha256, passage_attributions:corruptions[i] }
      await db.query(`insert into public.editorial_sources values
        ('ivan',$1,1,'call','ivan',null,null,'private',now(),'known',now(),$2,$3,null,null,true,null,
          'unknown',null,$4,$5,now())`, ['bad-required-'+i,digest(excerpt),excerpt,JSON.stringify(fields),'d'.repeat(64)])
    }
    const result = await db.query<{passage:string|null;candidate_fields:Record<string,unknown>}>(
      'select passage,candidate_fields from public.editorial_attribution_safe_sources_v')
    expect(result.rows).toHaveLength(corruptions.length)
    for (const row of result.rows) {
      expect(row.passage).toBeNull()
      expect(row.candidate_fields).toMatchObject({ first_person_eligible:false,attribution_use:'quarantined' })
    }
  })

  it('quarantines null-limitation and corrupted range, excerpt hash, or retained passage rows', async () => {
    const db = await setup()
    const excerpt = 'bound quote', transcriptHash='a'.repeat(64), textHash='b'.repeat(64), jsonHash='c'.repeat(64)
    const valid = { transcript_sha256:transcriptHash, transcript_text_sha256:textHash,
      transcript_json_sha256:jsonHash, passage_attributions:[{ attribution_state:'verified', speaker_name:'Ivan Manfredi',
        speaker_role:'author', transcript_sha256:transcriptHash, transcript_text_sha256:textHash,
        transcript_json_sha256:jsonHash, excerpt, excerpt_sha256:digest(excerpt), segment_index:0,
        quote_start:0, quote_end:excerpt.length }] }
    const corruptions = [
      { ...valid, passage_attributions:[{ ...valid.passage_attributions[0], quote_end:0 }] },
      { ...valid, passage_attributions:[{ ...valid.passage_attributions[0], excerpt_sha256:'d'.repeat(64) }] },
      valid,
    ]
    for (let index=0; index<corruptions.length; index++) await db.query(`insert into public.editorial_sources
      values('ivan',$1,1,'call','ivan',null,null,'private',now(),'known',now(),$2,$3,null,null,true,null,
        'unknown',null,$4,'${'e'.repeat(64)}',now())`, [`corrupt-${index}`, digest(index===2?'different passage':excerpt),
      index===2?'different passage':excerpt, JSON.stringify(corruptions[index])])
    const rows = await db.query<{passage:string|null;limitation:string|null}>(`select passage,limitation
      from public.editorial_attribution_safe_sources_v order by source_id`)
    expect(rows.rows).toHaveLength(3)
    expect(rows.rows.every(row => row.passage===null && Boolean(row.limitation?.includes('lacks verified')))).toBe(true)
  })
})
