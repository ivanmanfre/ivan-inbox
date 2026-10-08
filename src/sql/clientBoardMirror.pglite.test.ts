import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// db/241: a carousel_drafts change patches its entry in the client's cached board queue, so the
// client panel shows the post as it is, whoever edited it (Ivan 2026-10-08).
const D = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

it('mirrors copy, title, picture, date and stage onto the client board entry', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create schema net;
      create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as 'select 1::bigint';
      create function operator_gate_ok(t text) returns boolean language sql as $$select t = 'ok'$$;
      create table carousel_drafts(id uuid primary key, client_id text, title text, type text, post_body text, image_urls text[],
        status text, scheduled_at timestamptz, published_at timestamptz, board_visible boolean, updated_at timestamptz);
      create table scheduled_posts(clickup_task_id text, status text, media_urls text[], post_text text, scheduled_at timestamptz);
      create table client_boards(slug text primary key, client_id text, board jsonb);
      insert into carousel_drafts values
        ('${D}','risedtc','Old title','text','Old hook\nOld body',array['https://x/a.jpg'],'review','2026-10-20 14:00+00',null,true,now()),
        ('${OTHER}','risedtc','Other','carousel','Other body',array['https://x/s1.png','https://x/s2.png'],'scheduled','2026-10-21 14:00+00',null,true,now());
      insert into client_boards values
        ('risedtc-com','risedtc', jsonb_build_object('queue', jsonb_build_array(
          jsonb_build_object('id','${D}','body','Old hook\nOld body','post_body','Old hook\nOld body','hook','Old hook','title','Old title','image','https://x/a.jpg','stage','review','pillar','keep me'),
          jsonb_build_object('id','${OTHER}','body','Other body','hook','Other')))),
        ('arch-agency','arch', jsonb_build_object('queue', jsonb_build_array(jsonb_build_object('id','${D}','body','must not change'))));
      insert into scheduled_posts values ('${OTHER}','pending',array['https://x/deck.pdf'],'Other body','2026-10-21 14:00+00');`)
    await db.exec(readFileSync('db/241_client_board_mirror_and_date_guards.sql', 'utf8'))
    const entry = async (slug: string, id = D) => (await db.query<{ q: Record<string, unknown> }>(
      `select q from client_boards b, jsonb_array_elements(b.board->'queue') q where b.slug='${slug}' and q->>'id'='${id}'`)).rows[0].q

    // An inbox copy save (operator_edit_draft_body writes post_body only).
    await db.exec(`update carousel_drafts set post_body = E'\\n  New hook line\\n\\nNew body' where id='${D}'`)
    let q = await entry('risedtc-com')
    expect(q.body).toBe('\n  New hook line\n\nNew body')
    expect(q.post_body).toBe(q.body)
    expect(q.hook).toBe('New hook line')
    expect(q.pillar).toBe('keep me')
    expect((await entry('arch-agency')).body).toBe('must not change')
    expect((await entry('risedtc-com', OTHER)).body).toBe('Other body')

    await db.exec(`update carousel_drafts set title='New title', image_urls=array[]::text[], scheduled_at='2026-10-22 14:00+00', status='scheduled' where id='${D}'`)
    q = await entry('risedtc-com')
    expect(q).toMatchObject({ title: 'New title', image: null, media_url: null, image_urls: [], no_photo: true, publish_date: '2026-10-22', stage: 'scheduled' })

    await db.exec(`update carousel_drafts set image_urls=array['https://x/b.jpg'] where id='${D}'`)
    expect(await entry('risedtc-com')).toMatchObject({ image: 'https://x/b.jpg', image_urls: ['https://x/b.jpg'], no_photo: false })

    // A body wiped mid-regeneration never reaches the board.
    await db.exec(`update carousel_drafts set status='generating', post_body='' where id='${D}'`)
    expect((await entry('risedtc-com')).body).toBe('\n  New hook line\n\nNew body')

    // The queue order is kept.
    const ids = (await db.query<{ id: string }>(`select q->>'id' id from client_boards b, jsonb_array_elements(b.board->'queue') q where b.slug='risedtc-com'`)).rows.map(r => r.id)
    expect(ids).toEqual([D, OTHER])

    // A carousel's queue row keeps its deck PDF when its slide images change.
    await db.exec(`update carousel_drafts set image_urls=array['https://x/s9.png'] where id='${OTHER}'`)
    expect((await db.query<{ m: string[] }>(`select media_urls m from scheduled_posts`)).rows[0].m).toEqual(['https://x/deck.pdf'])

    // No date in the past; clearing is fine.
    const set = (at: string) => db.query<{ r: { ok: boolean; error?: string } }>(`select operator_set_schedule_date('ok','${D}',${at}) r`)
    await db.exec(`update carousel_drafts set status='review' where id='${D}'`)
    expect((await set("now() - interval '1 day'")).rows[0].r).toMatchObject({ ok: false, error: 'past_date' })
    expect((await set('null')).rows[0].r.ok).toBe(true)
    expect((await set("now() + interval '2 days'")).rows[0].r.ok).toBe(true)

    // db/242: Ivan dating a RISE post on the board arms it; an ARCH post and an off-board RISE post stay in review.
    await db.exec(readFileSync('db/242_rise_dated_board_posts_arm.sql', 'utf8').replace(/CREATE OR REPLACE FUNCTION public\.client_board_set_schedule_v2[\s\S]*$/, ''))
    const statusOf = async (id: string) => (await db.query<{ s: string }>(`select status s from carousel_drafts where id='${id}'`)).rows[0].s
    const A = '33333333-3333-4333-8333-333333333333', OFF = '44444444-4444-4444-8444-444444444444'
    await db.exec(`update carousel_drafts set status='review', scheduled_at=null where id='${D}';
      insert into carousel_drafts(id,client_id,type,post_body,status,board_visible) values ('${A}','arch','text','A body','review',true), ('${OFF}','risedtc','text','Off body','review',false)`)
    for (const id of [D, A, OFF]) expect((await db.query<{ r: { ok: boolean } }>(`select operator_set_schedule_date('ok','${id}',now() + interval '3 days') r`)).rows[0].r.ok).toBe(true)
    expect(await statusOf(D)).toBe('scheduled')
    expect(await statusOf(A)).toBe('review')
    expect(await statusOf(OFF)).toBe('review')
  } finally { await db.close() }
}, 30_000)
