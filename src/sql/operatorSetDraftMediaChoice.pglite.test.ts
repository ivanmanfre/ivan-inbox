import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/20261106_x_tracked_media_choice against a stand-in schema. The media trigger is
// the live body (media half), so the queue fix-up is tested against what really fires.
const migration = readFileSync('db/20261106_x_tracked_media_choice.sql', 'utf8')
const rollback = readFileSync('db/20261106_x_tracked_media_choice_rollback.sql', 'utf8')

const schema = `
create role anon; create role authenticated;
create function public.operator_gate_ok(p text) returns boolean language sql as $$ select p = 'clientops' $$;
create table public.carousel_drafts (
  id uuid primary key default gen_random_uuid(), client_id text, status text not null, type text,
  image_urls text[], video_url text, taxonomy jsonb, source_detail jsonb, published_at timestamptz,
  updated_at timestamptz default now() - interval '1 day'
);
create table public.scheduled_posts (id serial primary key, clickup_task_id text, status text, platform text default 'linkedin',
  post_format text default 'text', media_urls text[]);
create function public.tg_carousel_drafts_propagate_media() returns trigger language plpgsql as $f$
begin
  if new.image_urls is distinct from old.image_urls and new.status in ('scheduled', 'published')
     and coalesce(new.type, '') <> 'carousel' then
    update public.scheduled_posts set media_urls = new.image_urls
     where clickup_task_id = new.id::text and status in ('pending', 'queued_v2');
  end if;
  return new;
end $f$;
create trigger carousel_drafts_propagate_media after update on public.carousel_drafts
  for each row execute function public.tg_carousel_drafts_propagate_media();
`

const V = 'https://x.supabase.co/storage/v1/object/public/post-videos/x-tracked/denisyurchak/1.mp4'
const P = 'https://x.supabase.co/storage/v1/object/public/post-stills/x-tracked/denisyurchak/1-poster.jpg'
const PH = ['https://x.supabase.co/storage/v1/object/public/post-stills/x-tracked/denisyurchak/1-1.jpg',
  'https://x.supabase.co/storage/v1/object/public/post-stills/x-tracked/denisyurchak/1-2.jpg']
const copy = (o: Record<string, unknown> = {}) => JSON.stringify({ kind: 'x_tracked_outlier', media_copy: { video_url: V, poster_url: P, photo_urls: PH, ...o } })

let db: PGlite
const call = async (id: string, choice: string, gate = 'clientops') =>
  (await db.query<{ r: Record<string, unknown> }>(`select public.operator_set_draft_media_choice($1, $2, $3) r`, [gate, id, choice])).rows[0].r
const row = async (id: string) =>
  (await db.query<Record<string, unknown>>(`select type, video_url, image_urls, taxonomy from carousel_drafts where id = $1`, [id])).rows[0]
const add = async (o: { status?: string; type?: string; client?: string | null; sd?: string; tax?: string; pub?: boolean } = {}) =>
  (await db.query<{ id: string }>(
    `insert into carousel_drafts (client_id, status, type, image_urls, video_url, taxonomy, source_detail, published_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) returning id`,
    [o.client ?? null, o.status ?? 'review', o.type ?? 'video', [P], (o.type ?? 'video') === 'video' ? V : null,
      o.tax ?? '{"media_choice":"video","no_photo":false}', o.sd ?? copy(), o.pub ? new Date().toISOString() : null])).rows[0].id

// One database for the file (PGlite start-up is slow); every test makes its own rows.
beforeAll(async () => {
  db = new PGlite()
  await db.exec(schema)
  await db.exec(migration)
}, 180_000)

describe('operator_set_draft_media_choice', () => {
  it('switches a review draft video -> photos -> text -> video', async () => {
    const id = await add()
    expect(await call(id, 'photos')).toMatchObject({ ok: true, type: 'text' })
    expect(await row(id)).toMatchObject({ type: 'text', video_url: null, image_urls: PH, taxonomy: { media_choice: 'photos', no_photo: false } })
    expect(await call(id, 'text')).toMatchObject({ ok: true })
    expect(await row(id)).toMatchObject({ type: 'text', video_url: null, image_urls: [], taxonomy: { media_choice: 'text', no_photo: true } })
    expect(await call(id, 'video')).toMatchObject({ ok: true, type: 'video' })
    expect(await row(id)).toMatchObject({ type: 'video', video_url: V, image_urls: [P], taxonomy: { media_choice: 'video', no_photo: false } })
  })

  it('keeps the other taxonomy keys', async () => {
    const id = await add({ tax: '{"source":"x_tracked_outlier","human_edited":true}' })
    await call(id, 'photos')
    expect((await row(id)).taxonomy).toMatchObject({ source: 'x_tracked_outlier', human_edited: true, media_choice: 'photos' })
  })

  it('fixes the pending LinkedIn queue row of a scheduled draft (format + media)', async () => {
    const id = await add({ status: 'scheduled' })
    await db.query(`insert into scheduled_posts (clickup_task_id, status, post_format, media_urls) values ($1, 'pending', 'video', $2)`, [id, [V]])
    await db.query(`insert into scheduled_posts (clickup_task_id, status, post_format, media_urls) values ($1, 'posted', 'video', $2)`, [id, [V]])
    await call(id, 'photos')
    let q = (await db.query<Record<string, unknown>>(`select status, post_format, media_urls from scheduled_posts where clickup_task_id = $1 order by id`, [id])).rows
    expect(q[0]).toMatchObject({ post_format: 'text', media_urls: PH })
    expect(q[1]).toMatchObject({ status: 'posted', post_format: 'video', media_urls: [V] })
    await call(id, 'video')
    q = (await db.query<Record<string, unknown>>(`select post_format, media_urls from scheduled_posts where clickup_task_id = $1 order by id`, [id])).rows
    // the media trigger copies the poster onto the queue first; the function puts the mp4 back
    expect(q[0]).toMatchObject({ post_format: 'video', media_urls: [V] })
  })

  it('refuses what it must not touch, writing nothing', async () => {
    const base = await add()
    expect(await call(base, 'video', 'nope')).toMatchObject({ ok: false, error: 'bad_gate' })
    expect(await call(base, 'gif')).toMatchObject({ ok: false, error: 'bad_choice' })
    expect(await call(await add({ client: 'rise' }), 'photos')).toMatchObject({ ok: false, error: 'not_ivan' })
    expect(await call(await add({ pub: true }), 'photos')).toMatchObject({ ok: false, error: 'published' })
    expect(await call(await add({ status: 'rejected' }), 'photos')).toMatchObject({ ok: false, error: 'bad_status' })
    expect(await call(await add({ type: 'carousel' }), 'photos')).toMatchObject({ ok: false, error: 'not_text_or_video' })
    expect(await call(await add({ sd: '{"kind":"x_tracked_outlier"}' }), 'photos')).toMatchObject({ ok: false, error: 'no_media_copy' })
    expect(await call(await add({ sd: copy({ photo_urls: [] }) }), 'photos')).toMatchObject({ ok: false, error: 'no_photos' })
    expect(await call(await add({ type: 'text', sd: copy({ video_url: null }) }), 'video')).toMatchObject({ ok: false, error: 'no_video' })
    const ig = await add({ status: 'scheduled' })
    await db.query(`insert into scheduled_posts (clickup_task_id, status, platform) values ($1, 'pending', 'instagram')`, [ig])
    expect(await call(ig, 'photos')).toMatchObject({ ok: false, error: 'ig_queued' })
    const sending = await add({ status: 'scheduled' })
    await db.query(`insert into scheduled_posts (clickup_task_id, status, post_format, media_urls) values ($1, 'posting', 'video', $2)`, [sending, [V]])
    expect(await call(sending, 'text')).toMatchObject({ ok: false, error: 'posting' })
    expect(await row(sending)).toMatchObject({ type: 'video', video_url: V, image_urls: [P] })
    expect(await row(ig)).toMatchObject({ type: 'video', video_url: V })
    expect(await row(base)).toMatchObject({ type: 'video', video_url: V, image_urls: [P] })
  })

  it('anon cannot execute it; the rollback drops it', async () => {
    const g = (await db.query<{ a: boolean }>(`select has_function_privilege('anon', 'public.operator_set_draft_media_choice(text, uuid, text)', 'execute') a`)).rows[0]
    expect(g.a).toBe(false)
    await db.exec(rollback)
    const n = (await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'operator_set_draft_media_choice'`)).rows[0]
    expect(n.n).toBe(0)
  })
})
