import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-ignore Local release importer has no declaration file.
import { importInitialBatch } from '../../../../tools/import-initial-batch.mjs'

const seed = JSON.parse(readFileSync('../../../content-brain-01-evidence-briefs-2026-09-20-out/INITIAL-BATCH-IMPORT.json','utf8'))
const sql = (name: string) => readFileSync(`db/${name}`,'utf8')
const laneSource = sql('088_lane_allowed.sql')
const laneTail = 'grant execute on function public.lane_allowed(text) to service_role;'
const lane = laneSource.slice(laneSource.indexOf('create or replace function public.lane_allowed'),
  laneSource.indexOf(laneTail) + laneTail.length)

describe('native draft bridge', { timeout: 120_000 }, () => {
  it('maps one exact reservation to one unscheduled UUID draft and refuses drift', async () => {
    const db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.client_registry(client_id text primary key,display_name text,is_active boolean,platform jsonb);
      create or replace function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$ select coalesce(p_gate,'')='clientops' $$;`)
    await db.exec(lane)
    await db.exec(sql('105_editorial_brief_contract.sql'))
    await db.exec(sql('106_editorial_refresh.sql'))
    await db.exec(`create table public.carousel_drafts(
      id uuid primary key,client_id text,title text not null default '',type text not null default 'carousel',
      topic text,description text,status text not null default 'draft',source_detail jsonb,
      scheduled_at timestamptz,published_at timestamptz,board_visible boolean not null default false)`)
    await db.exec(`create table public.video_ideas(id uuid primary key,title text not null,
      description text,status text default 'idea');
      create table public.lm_drafts_v2(id uuid primary key,client_id text,topic text,
      format text,status text not null,spec jsonb)`)
    await db.exec(sql('107_editorial_native_draft_bridge.sql'))
    await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
      ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
      ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}'),
      ('arch','ARCH',true,'{"measurement":{"roster":[{"account":"arch"}]}}')`)
    await importInitialBatch(db, seed)
    const b = seed.plan[3].records.find((x: any) => x.client_id === 'ivan' && x.brief_id === 'brief-ivan-01' && x.version === 2)
    const reserve = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-01',2,$1,'bridge-request','text') result`,[b.content_hash])
    const artifact = reserve.rows[0].result.artifact_id
    expect(reserve.rows[0].result.state).toBe('accepted')
    const args = [artifact,b.content_hash]
    const begin = await db.query<{ result: any }>(`select public.editorial_begin_native_draft('clientops','ivan',
      $1,'brief-ivan-01',2,$2,'bridge-request','A guarded title','text','A guarded topic') result`,args)
    expect(begin.rows[0].result).toMatchObject({ artifact_id: artifact,should_dispatch: true,
      idempotent_replay: false })
    const again = await db.query<{ result: any }>(`select public.editorial_begin_native_draft('clientops','ivan',
      $1,'brief-ivan-01',2,$2,'bridge-request','A guarded title','text','A guarded topic') result`,args)
    expect(again.rows[0].result).toMatchObject({ native_draft_id: begin.rows[0].result.native_draft_id,
      should_dispatch: false,idempotent_replay: true })
    const rows = await db.query<any>(`select * from public.carousel_drafts`)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ editorial_brief_artifact_id: artifact,
      status: 'draft',scheduled_at: null,published_at: null,board_visible: false })
    expect(rows.rows[0].source_detail).toMatchObject({ brief_hash: b.content_hash,internal_only: true })
    await expect(db.query(`select public.editorial_begin_native_draft('clientops','arch',
      $1,'brief-ivan-01',2,$2,'bridge-request','A guarded title','text','A guarded topic')`,args))
      .rejects.toThrow(/exact editorial reservation required/)
    await expect(db.query(`select public.editorial_begin_native_draft('clientops','ivan',
      $1,'brief-ivan-01',2,$2,'bridge-request','A guarded title','text','A guarded topic')`,[artifact,'0'.repeat(64)]))
      .rejects.toThrow(/brief version\/hash mismatch/)
    await expect(db.query(`select public.editorial_begin_native_draft('clientops','ivan',
      $1,'brief-ivan-01',2,$2,'bridge-request','A guarded title','video','A guarded topic')`,args))
      .rejects.toThrow(/native format differs from reserved brief/)
    const imageBrief = seed.plan[3].records.find((x: any) => x.client_id === 'ivan' &&
      x.brief_id === 'brief-ivan-02' && x.version === 1)
    expect(imageBrief.payload.editorial_direction.format).toBe('single_image')
    const imageReserve = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-02',1,$1,'image-copy-request','post') result`,[imageBrief.content_hash])
    expect(imageReserve.rows[0].result.state).toBe('accepted')
    const imageArtifact = imageReserve.rows[0].result.artifact_id
    const imageBegin = await db.query<{ result: any }>(`select public.editorial_begin_native_draft('clientops','ivan',
      $1,'brief-ivan-02',1,$2,'image-copy-request','Image copy','single_image','Follower example') result`,
      [imageArtifact,imageBrief.content_hash])
    expect(imageBegin.rows[0].result.should_dispatch).toBe(true)
    const imageNative = await db.query<any>(`select * from public.carousel_drafts where editorial_brief_artifact_id=$1`,
      [imageArtifact])
    expect(imageNative.rows).toHaveLength(1)
    expect(imageNative.rows[0].type).toBe('text')
    expect(imageNative.rows[0].source_detail).toMatchObject({
      source_format:'single_image',brief_hash:imageBrief.content_hash,internal_only:true})
    const promo = seed.plan[3].records.find((x: any) => x.client_id === 'risedtc' &&
      x.brief_id === 'brief-risedtc-05' && x.version === 2)
    const promoReserve = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','risedtc',
      'brief-risedtc-05',2,$1,'promo-bridge','internal_copy') result`,[promo.content_hash])
    expect(promoReserve.rows[0].result.state).toBe('accepted')
    const promoArtifact = promoReserve.rows[0].result.artifact_id
    const promoNative = await db.query<{ result: any }>(`select public.editorial_begin_native_draft('clientops','risedtc',
      $1,'brief-risedtc-05',2,$2,'promo-bridge','Ungated skills promo','lm_promo','Existing skills kit') result`,
      [promoArtifact,promo.content_hash])
    expect(promoNative.rows[0].result.should_dispatch).toBe(true)
    const lm = await db.query<any>(`select * from public.lm_drafts_v2 where editorial_brief_artifact_id=$1`,[promoArtifact])
    expect(lm.rows).toHaveLength(1)
    expect(lm.rows[0]).toMatchObject({client_id:'risedtc',status:'draft',format:'promo'})
    expect(lm.rows[0].spec).toMatchObject({brief_hash:promo.content_hash,internal_only:true})
    const after = await db.query<{ n: number }>(`select count(*)::int n from public.carousel_drafts`)
    expect(after.rows[0].n).toBe(2)
    await db.close()
  })
})
