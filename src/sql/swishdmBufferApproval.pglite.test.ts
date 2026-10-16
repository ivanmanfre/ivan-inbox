import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const board = 'bc1dae85-6218-496d-9278-e68dcc9cf61b'
const draft = '11111111-1111-4111-8111-111111111111'
const stamp = '2026-10-16T10:00:00Z'
let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"operator@example.com"}'::jsonb $$;
    create function cb34_p2_operator_lane_allowed(text) returns boolean language sql stable as $$ select $1='ivan' and current_setting('test.allowed',true)='yes' $$;
    create table client_registry(client_id text primary key,is_active boolean);
    insert into client_registry values('swishdm',true);
    create table client_boards(id uuid primary key,slug text,client_id text,board jsonb,updated_at timestamptz);
    create table carousel_drafts(id uuid primary key,client_id text,status text,board_visible boolean,updated_at timestamptz,
      post_body text,type text,title text,topic text,image_urls text[],video_url text,pdf_url text,authored_html text,
      source_label text,funnel_stage text,funnel_source text,source_ref text,source_detail jsonb,taxonomy jsonb,qa jsonb,scheduled_at timestamptz,published_at timestamptz);
    create table client_board_actions(id uuid default gen_random_uuid(),board_slug text,client_id text,action text,ref text,payload jsonb,created_at timestamptz default now());
    insert into client_boards values('${board}','swishdm-live','swishdm','{"queue":[{"id":"unrelated","body":"keep"}],"config":{"hold":true},"directions":{"x":1}}',now());
    insert into carousel_drafts(id,client_id,status,board_visible,updated_at,post_body,type,title,source_detail)
      values('${draft}','swishdm','review',false,'${stamp}','Reviewed copy','text','Title','{"private_transcript":"NEVER EXPOSE"}');
    select set_config('test.uid','22222222-2222-4222-8222-222222222222',false),set_config('test.allowed','yes',false);`)
  const block = readFileSync('db/277_brain_feedback_loop.sql','utf8').split('CREATE OR REPLACE FUNCTION public.cb34_p2_review_block')[1].split('GRANT EXECUTE')[0]
  await db.exec(`CREATE OR REPLACE FUNCTION public.cb34_p2_review_block${block}`)
})
afterEach(async () => { await db.close() })
const migrate = () => db.exec(readFileSync('db/287_swishdm_buffer_approval.sql','utf8'))
const call = async (visible = true, at = stamp) => (await db.query<{ r: any }>(
  `select swishdm_set_buffer_visibility($1,$2,$3) r`,[draft,at,visible])).rows[0].r
const state = async () => ({
  draft: (await db.query<any>('select * from carousel_drafts')).rows[0],
  board: (await db.query<any>('select board from client_boards')).rows[0].board,
  audit: (await db.query<any>('select * from client_board_actions')).rows,
})

describe('Swish operator approval is an atomic buffer handoff', () => {
  it('appends once, retains review and dates, preserves board config and records operator audit', async () => {
    await migrate()
    expect(await call()).toMatchObject({ok:true,board_visible:true,client_id:'swishdm'})
    let s = await state()
    expect(s.draft).toMatchObject({status:'review',board_visible:true,scheduled_at:null,published_at:null})
    expect(s.board).toMatchObject({config:{hold:true},directions:{x:1}})
    expect(s.board.queue).toHaveLength(2)
    expect(s.board.queue[1]).toMatchObject({id:draft,body:'Reviewed copy',stage:'review',kind:'post',style:'text',generating:false})
    expect(JSON.stringify(s.board)).not.toContain('NEVER EXPOSE')
    expect(s.audit[0]).toMatchObject({action:'operator_buffer_approve',ref:draft,payload:{by:'operator@example.com',actor_label:'operator@example.com',applied:true,client_approved:false,before:{board_visible:false,status:'review'},after:{board_visible:true,status:'review'}}})
    await call(true,s.draft.updated_at)
    s = await state()
    expect(s.board.queue).toHaveLength(2)
    expect(s.audit).toHaveLength(1)
    await call(false,s.draft.updated_at)
    s = await state()
    expect(s.board.queue).toEqual([{id:'unrelated',body:'keep'}])
    expect(s.draft.board_visible).toBe(false)
    expect(s.audit[1].action).toBe('operator_buffer_remove')
  })
  it('rejects missing auth, wrong tenant, stale body, known QA block and incomplete media without side effects', async () => {
    await migrate()
    await db.exec(`select set_config('test.allowed','no',false)`)
    await expect(call()).rejects.toThrow(/unauthorized/)
    await db.exec(`select set_config('test.allowed','yes',false)`)
    expect(await call(true,'2026-10-15T10:00:00Z')).toMatchObject({ok:false,error:'stale_draft'})
    for (const [change,error] of [
      [`client_id='ivan'`,'draft_not_found'], [`status='scheduled'`,'not_in_review'],
      [`post_body=''`,'empty_body'], [`qa='{"verdict":"HOLD"}'`,'qa_blocked'],
      [`type='video'`,'awaiting_media'], [`type='carousel'`,'awaiting_media'],
    ]) {
      await db.exec(`update carousel_drafts set client_id='swishdm',status='review',post_body='Reviewed copy',qa=null,type='text'; update carousel_drafts set ${change}`)
      expect(await call()).toMatchObject({ok:false,error})
      expect((await state()).audit).toHaveLength(0)
      expect((await state()).board.queue).toHaveLength(1)
    }
  })
  it('retains playable video and finished carousel media and merges an existing item once', async () => {
    await migrate()
    await db.exec(`update carousel_drafts set type='video',video_url='https://example.com/video.mp4';
      update client_boards set board=jsonb_set(board,'{queue}',board->'queue'||'[{"id":"${draft}","client_note":"keep"},{"id":"${draft}","duplicate":true}]');`)
    await call()
    let s = await state()
    expect(s.board.queue).toHaveLength(2)
    expect(s.board.queue[1]).toMatchObject({video_url:'https://example.com/video.mp4',client_note:'keep'})
    await db.exec(`update carousel_drafts set type='carousel',video_url=null,image_urls=array['https://example.com/slide.png'],pdf_url='https://example.com/deck.pdf'`)
    await call(true,s.draft.updated_at)
    s = await state()
    expect(s.board.queue[1]).toMatchObject({type:'carousel',image_urls:['https://example.com/slide.png'],pdf_url:'https://example.com/deck.pdf'})
  })
  it('refuses video URL prefixes or whitespace instead of exposing unfinished media', async () => {
    await migrate()
    for (const url of ['https://','https://example.com/broken video.mp4']) {
      await db.query(`update carousel_drafts set type='video',video_url=$1`,[url])
      expect(await call()).toMatchObject({ok:false,error:'awaiting_media'})
      expect((await state()).board.queue).toHaveLength(1)
    }
  })
  it('refuses incomplete carousel image arrays even when a later slide has a valid URL', async () => {
    await migrate()
    for (const urls of [[], ['', 'https://example.com/slide.png'], ['/private/slide.png', 'https://example.com/slide.png'], [null, 'https://example.com/slide.png']]) {
      await db.query(`update carousel_drafts set type='carousel',image_urls=$1`,[urls])
      expect(await call()).toMatchObject({ok:false,error:'awaiting_media'})
      expect((await state()).board.queue).toHaveLength(1)
      expect((await state()).audit).toHaveLength(0)
    }
  })
  it('rolls back both writes if audit insertion fails; migration rollback removes only the new RPC', async () => {
    await migrate()
    await db.exec(`alter table client_board_actions add constraint reject_test check(action <> 'operator_buffer_approve')`)
    await expect(call()).rejects.toThrow()
    expect((await state()).draft.board_visible).toBe(false)
    expect((await state()).board.queue).toHaveLength(1)
    await db.exec(readFileSync('db/287_swishdm_buffer_approval_rollback.sql','utf8'))
    await expect(call()).rejects.toThrow(/does not exist/)
    expect((await state()).board.config).toEqual({hold:true})
  })
})
