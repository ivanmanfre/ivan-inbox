import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/230 against a stand-in schema. `_client_board_apply_media` below is the LIVE
// body, copied verbatim from pg_get_functiondef (read-only, 2026-09-29 14:47Z), so
// the client path is tested against the function it will really call, not a
// reimplementation of it. operator_gate_ok is a stand-in (the real one hashes the
// gate against integration_config).
const migration = readFileSync('db/230_operator_set_draft_media.sql', 'utf8')
const rollback = readFileSync('db/230_operator_set_draft_media_rollback.sql', 'utf8')

const schema = `
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create function public.operator_gate_ok(p text) returns boolean language sql as $$ select p = 'clientops' $$;
create table public.carousel_drafts (
  id uuid primary key default gen_random_uuid(), client_id text, status text not null, type text,
  image_urls text[], taxonomy jsonb, published_at timestamptz, scheduled_at timestamptz,
  board_visible boolean, updated_at timestamptz default now() - interval '1 day'
);
create table public.client_boards (slug text primary key, client_id text, token text, expires_at timestamptz, board jsonb);
create table public.client_board_actions (
  id serial primary key, board_slug text, client_id text, action text, ref text, payload jsonb,
  created_at timestamptz default now()
);
create table public.scheduled_posts (id serial primary key, clickup_task_id text, status text, media_urls text[]);

-- LIVE COPY: tg_carousel_drafts_propagate_media (media half only).
create function public.tg_carousel_drafts_propagate_media() returns trigger language plpgsql as $f$
begin
  if new.image_urls is distinct from old.image_urls and new.status in ('scheduled', 'published') then
    update public.scheduled_posts set media_urls = new.image_urls
     where clickup_task_id = new.id::text and status in ('pending', 'queued_v2');
  end if;
  return new;
end $f$;
create trigger carousel_drafts_propagate_media after update of image_urls on public.carousel_drafts
  for each row execute function public.tg_carousel_drafts_propagate_media();

-- LIVE COPY: _client_board_apply_media, verbatim.
CREATE OR REPLACE FUNCTION public._client_board_apply_media(v_board client_boards, p_slug text, p_draft_id uuid, p_media_url text, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_prev text; v_clear boolean; v_status text; v_type text;
begin
  v_clear := coalesce(p_media_url, '') = '';
  if not v_clear and length(p_media_url) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  select coalesce(image_urls[1], ''), status, type into v_prev, v_status, v_type
    from public.carousel_drafts
   where id = p_draft_id and client_id = v_board.client_id and status in ('review', 'scheduled');
  if not found then return jsonb_build_object('ok', false, 'error', 'draft_not_editable'); end if;
  if v_status = 'scheduled' and v_type not in ('text', 'single_image') then
    return jsonb_build_object('ok', false, 'error', 'unschedule_first'); end if;
  update public.carousel_drafts
     set image_urls = case when v_clear then ARRAY[]::text[] else ARRAY[p_media_url]::text[] end,
         updated_at = now()
   where id = p_draft_id;
  update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
      select jsonb_agg(case when (q->>'id') = p_draft_id::text
        then q || jsonb_build_object(
          'media_url',  case when v_clear then null else p_media_url end,
          'image',      case when v_clear then null else p_media_url end,
          'image_urls', case when v_clear then '[]'::jsonb else jsonb_build_array(p_media_url) end,
          'no_photo',   v_clear)
        else q end)
      from jsonb_array_elements(board->'queue') q), board->'queue'))
    where slug = p_slug;
  insert into public.client_board_actions (board_slug, client_id, action, ref, payload)
  values (p_slug, v_board.client_id, 'set_media', p_draft_id::text,
          jsonb_build_object('applied', true, 'before', v_prev, 'after', coalesce(p_media_url, ''), 'by', p_by));
  return jsonb_build_object('ok', true, 'media_url', coalesce(p_media_url, ''));
end $function$;
`

const IMG = 'https://x.supabase.co/storage/v1/object/public/post-stills/selfie-pool-a/selfie-12.jpg'
const IMG2 = 'https://x.supabase.co/storage/v1/object/public/client-photos/arch-agency/davorin-1.jpg'

type Row = Record<string, unknown>
async function setup() {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(`
    insert into client_boards (slug, client_id, board) values
      ('arch-agency', 'arch', '{"queue":[{"id":"00000000-0000-0000-0000-00000000a001","media_url":null}]}'),
      ('risedtc-com', 'risedtc', '{"queue":[]}'),
      ('bemerci-com', null, '{"queue":[]}'),
      ('sci-rec', null, '{"queue":[]}');
    insert into carousel_drafts (id, client_id, status, type, image_urls, taxonomy, scheduled_at, board_visible) values
      ('00000000-0000-0000-0000-00000000a001', 'arch', 'review', 'text', '{}', '{"pillar":"x"}', '2026-10-07T09:30:00Z', true),
      ('00000000-0000-0000-0000-00000000a002', 'arch', 'review', 'carousel', '{https://s/1.png,https://s/2.png}', null, null, false),
      ('00000000-0000-0000-0000-00000000a003', 'arch', 'approved', 'text', '{}', null, null, false),
      ('00000000-0000-0000-0000-00000000b001', null, 'review', 'text', '{https://old/selfie.jpg}', '{"pillar":"trust"}', null, null),
      ('00000000-0000-0000-0000-00000000b002', null, 'scheduled', 'text', '{https://old/selfie.jpg}', '"hook-list"', '2026-10-01T08:00:00Z', null),
      ('00000000-0000-0000-0000-00000000b003', null, 'scheduled', 'carousel', '{https://s/1.png,https://s/2.png}', null, '2026-10-02T08:00:00Z', null),
      ('00000000-0000-0000-0000-00000000b004', null, 'published', 'text', '{}', null, null, null),
      ('00000000-0000-0000-0000-00000000b005', null, 'idea', 'text', '{}', null, null, null),
      ('00000000-0000-0000-0000-00000000c001', 'ghost', 'review', 'text', '{}', null, null, null);
    update carousel_drafts set published_at = now() where id = '00000000-0000-0000-0000-00000000b004';
    insert into scheduled_posts (clickup_task_id, status, media_urls) values
      ('00000000-0000-0000-0000-00000000b002', 'pending', '{https://old/selfie.jpg}');
  `)
  await db.exec(migration)
  return db
}
const call = async (db: PGlite, id: string, url: string | null, gate = 'clientops') =>
  (await db.query<{ r: Row }>('select public.operator_set_draft_media($1, $2::uuid, $3) as r', [gate, id, url])).rows[0].r
const row = async (db: PGlite, id: string) =>
  (await db.query<Row>('select status, type, image_urls, taxonomy, scheduled_at, board_visible, published_at from carousel_drafts where id = $1', [id])).rows[0]
const id = (s: string) => `00000000-0000-0000-0000-00000000${s}`

describe('db/230 operator_set_draft_media', { timeout: 30_000 }, () => {
  it('refuses a bad gate before reading anything', async () => {
    const db = await setup()
    expect(await call(db, id('b001'), IMG, 'nope')).toEqual({ ok: false, error: 'bad_gate' })
    expect((await row(db, id('b001'))).image_urls).toEqual(['https://old/selfie.jpg'])
    await db.close()
  })

  it("Ivan: swaps the picture and clears no_photo, keeping the taxonomy's other keys", async () => {
    const db = await setup()
    const r = await call(db, id('b001'), IMG)
    expect(r).toMatchObject({ ok: true, media_url: IMG, no_photo: false })
    const after = await row(db, id('b001'))
    expect(after.image_urls).toEqual([IMG])
    expect(after.taxonomy).toEqual({ pillar: 'trust', no_photo: false })
    expect(after.status).toBe('review')
    await db.close()
  })

  it('Ivan: a removal empties image_urls and stamps no_photo; a legacy string taxonomy is kept as structure_used', async () => {
    const db = await setup()
    expect(await call(db, id('b002'), null)).toMatchObject({ ok: true, no_photo: true })
    const after = await row(db, id('b002'))
    expect(after.image_urls).toEqual([])
    expect(after.taxonomy).toEqual({ structure_used: 'hook-list', no_photo: true })
    // date and status untouched
    expect(after.status).toBe('scheduled')
    expect(new Date(after.scheduled_at as string).toISOString()).toBe('2026-10-01T08:00:00.000Z')
    // the propagate trigger carried the removal to the pending queue row
    const q = (await db.query<{ media_urls: string[] }>('select media_urls from scheduled_posts')).rows[0]
    expect(q.media_urls).toEqual([])
    await db.close()
  })

  it('an empty string is a removal, the same as null', async () => {
    const db = await setup()
    expect(await call(db, id('b001'), '')).toMatchObject({ ok: true, no_photo: true })
    expect((await row(db, id('b001'))).image_urls).toEqual([])
    await db.close()
  })

  it('refuses carousels on both lanes, and leaves the deck exactly as it was', async () => {
    const db = await setup()
    expect(await call(db, id('b003'), IMG)).toEqual({ ok: false, error: 'not_single_photo', type: 'carousel' })
    expect(await call(db, id('a002'), IMG2)).toEqual({ ok: false, error: 'not_single_photo', type: 'carousel' })
    expect((await row(db, id('b003'))).image_urls).toEqual(['https://s/1.png', 'https://s/2.png'])
    expect((await row(db, id('a002'))).image_urls).toEqual(['https://s/1.png', 'https://s/2.png'])
    expect((await db.query('select 1 from client_board_actions')).rows).toHaveLength(0)
    await db.close()
  })

  it('refuses published posts, other stages, unknown ids and non-https URLs', async () => {
    const db = await setup()
    expect(await call(db, id('b004'), IMG)).toEqual({ ok: false, error: 'published' })
    expect(await call(db, id('b005'), IMG)).toEqual({ ok: false, error: 'bad_status', status: 'idea' })
    expect(await call(db, id('ffff'), IMG)).toEqual({ ok: false, error: 'not_found' })
    expect(await call(db, id('b001'), 'javascript:alert(1)')).toEqual({ ok: false, error: 'bad_url' })
    expect(await call(db, id('b001'), 'https://x/' + 'a'.repeat(2001))).toEqual({ ok: false, error: 'bad_url' })
    await db.close()
  })

  it('client: goes through the board path, patches the cached queue, logs set_media by operator, never touches status/date/board', async () => {
    const db = await setup()
    const r = await call(db, id('a001'), IMG2)
    expect(r).toMatchObject({ ok: true, media_url: IMG2, client_id: 'arch', slug: 'arch-agency' })
    const after = await row(db, id('a001'))
    expect(after.image_urls).toEqual([IMG2])
    expect(after.status).toBe('review')
    expect(after.board_visible).toBe(true)
    expect(new Date(after.scheduled_at as string).toISOString()).toBe('2026-10-07T09:30:00.000Z')
    expect(after.taxonomy).toEqual({ pillar: 'x' })
    const board = (await db.query<{ board: { queue: Row[] } }>("select board from client_boards where slug = 'arch-agency'")).rows[0].board
    expect(board.queue[0]).toMatchObject({ media_url: IMG2, image: IMG2, image_urls: [IMG2], no_photo: false })
    const log = (await db.query<Row>('select board_slug, client_id, action, ref, payload from client_board_actions')).rows
    expect(log).toEqual([{ board_slug: 'arch-agency', client_id: 'arch', action: 'set_media', ref: id('a001'),
      payload: { applied: true, before: '', after: IMG2, by: 'operator' } }])
    // removal marks no_photo on the board copy
    expect(await call(db, id('a001'), null)).toMatchObject({ ok: true, media_url: '' })
    const b2 = (await db.query<{ board: { queue: Row[] } }>("select board from client_boards where slug = 'arch-agency'")).rows[0].board
    expect(b2.queue[0]).toMatchObject({ media_url: null, image_urls: [], no_photo: true })
    await db.close()
  })

  it("client: passes the board function's own refusal through (approved is not editable there)", async () => {
    const db = await setup()
    expect(await call(db, id('a003'), IMG2)).toEqual({ ok: false, error: 'draft_not_editable' })
    await db.close()
  })

  it('client: a client with no board is refused; a NULL-client board is never matched', async () => {
    const db = await setup()
    expect(await call(db, id('c001'), IMG2)).toEqual({ ok: false, error: 'no_board', client_id: 'ghost' })
    await db.exec("insert into client_boards (slug, client_id, board) values ('arch-two', 'arch', '{\"queue\":[]}')")
    expect(await call(db, id('a001'), IMG2)).toEqual({ ok: false, error: 'ambiguous_board', client_id: 'arch' })
    await db.close()
  })

  it('raises, never reports success, when the row stops matching between the read and the write', async () => {
    const db = await setup()
    // A BEFORE trigger that swallows the update stands in for a concurrent change.
    await db.exec(`create function pg_temp_skip() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger skip_b001 before update on carousel_drafts for each row
        when (old.id = '${id('b001')}') execute function pg_temp_skip();`)
    await expect(call(db, id('b001'), IMG)).rejects.toThrow(/changed before the write/)
    await db.close()
  })

  it('anon cannot execute it, authenticated can; the rollback drops it', async () => {
    const db = await setup()
    const g = (await db.query<{ a: boolean; u: boolean }>(`select
      has_function_privilege('anon', 'public.operator_set_draft_media(text,uuid,text)', 'EXECUTE') as a,
      has_function_privilege('authenticated', 'public.operator_set_draft_media(text,uuid,text)', 'EXECUTE') as u`)).rows[0]
    expect(g).toEqual({ a: false, u: true })
    await db.exec(rollback)
    const left = (await db.query("select 1 from pg_proc where proname = 'operator_set_draft_media'")).rows
    expect(left).toHaveLength(0)
    await db.close()
  })
})
