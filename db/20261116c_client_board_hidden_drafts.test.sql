-- Test for 20261116c. Run AFTER the migration, as postgres. Everything is rolled back.
--  T1 every live board's schedule (v1) answers ok with an items array, and when t.expected is set
--     ('slug=n,slug=n') every board must be listed there with the same count (missing entry = fail)
--  T2 one real scheduled draft, four visibility states, through v1 (board token) AND v2 (approver session):
--       A visible + on queue   -> listed, editable
--       B hidden  + off queue  -> not listed, not editable (draft_not_editable)
--       C hidden  + on queue   -> listed, editable
--       D visible + off queue  -> listed, editable
-- The helpers are pg_temp functions: they exist only inside this rolled-back transaction.

begin;

create function pg_temp.t20261116c_sched_ids(v int, p_slug text, p_cred text) returns text[] language plpgsql as $f$
declare r jsonb;
begin
  r := case v when 1 then public.client_board_schedule(p_slug, p_cred) else public.client_board_schedule_v2(p_slug, p_cred) end;
  if (r->>'ok') is distinct from 'true' or jsonb_typeof(r->'items') is distinct from 'array' then
    raise exception 'schedule v% on % did not answer ok with items: %', v, p_slug, r;
  end if;
  return array(select x->>'id' from jsonb_array_elements(r->'items') x);
end $f$;

create function pg_temp.t20261116c_try_edit(v int, p_slug text, p_cred text, p_id uuid) returns jsonb language plpgsql as $f$
begin
  return case v when 1 then public.client_board_edit_draft(p_slug, p_cred, p_id, repeat('test copy 20261116c ', 3))
                else public.client_board_edit_draft_v2(p_slug, p_cred, p_id, repeat('test copy 20261116c ', 3), null) end;
end $f$;

do $t1$
declare b record; n int; exp text := current_setting('t.expected', true); m text[];
begin
  for b in select slug, token from public.client_boards where token is not null and (expires_at is null or expires_at > now()) order by slug loop
    n := cardinality(pg_temp.t20261116c_sched_ids(1, b.slug, b.token));
    if exp is not null and exp <> '' then
      m := regexp_match(exp, '(?:^|,)' || b.slug || '=([0-9]+)(?:,|$)');
      if m is null then raise exception 'T1 FAIL: board % missing from the expected map', b.slug; end if;
      if m[1]::int is distinct from n then raise exception 'T1 FAIL: board % lists % drafts, expected %', b.slug, n, m[1]; end if;
    end if;
  end loop;
  raise notice 'T1 ok';
end $t1$;

do $t2$
declare b record; d text; sess text := 'tok-20261116c-approver'; v int; ids text[]; r jsonb; cred text;
begin
  select cb.slug, cb.token, cd.id::text as id into b
    from public.client_boards cb
    join public.carousel_drafts cd on cd.client_id = cb.client_id
   where cb.token is not null and (cb.expires_at is null or cb.expires_at > now())
     and cd.scheduled_at is not null and cd.status in ('review','scheduled') and cd.board_visible is true
     and cd.id::text in (select q->>'id' from jsonb_array_elements(coalesce(cb.board->'queue','[]'::jsonb)) q)
   order by cd.scheduled_at limit 1;
  if b.slug is null then raise exception 'T2 SETUP: no scheduled visible queue draft found'; end if;
  d := b.id;
  insert into public.client_board_sessions (slug, email, token_hash, expires_at)
  values (b.slug, 'test-approver-20261116c@example.invalid', encode(extensions.digest(sess, 'sha256'), 'hex'), now() + interval '1 hour');
  if public._board_member_role(b.slug, 'test-approver-20261116c@example.invalid') is distinct from 'approver' then
    raise exception 'T2 SETUP: fixture session is not an approver';
  end if;

  for v in 1..2 loop
    cred := case v when 1 then b.token else sess end;
    -- A visible + on queue
    ids := pg_temp.t20261116c_sched_ids(v, b.slug, cred);
    if not d = any(ids) then raise exception 'T2A v% FAIL: not listed', v; end if;
    r := pg_temp.t20261116c_try_edit(v, b.slug, cred, d::uuid);
    if (r->>'ok') is distinct from 'true' then raise exception 'T2A v% FAIL: not editable %', v, r; end if;

    -- B hidden + off queue
    update public.carousel_drafts set board_visible = false where id = d::uuid;
    update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
        select jsonb_agg(q) from jsonb_array_elements(board->'queue') q where q->>'id' <> d), '[]'::jsonb))
     where slug = b.slug;
    ids := pg_temp.t20261116c_sched_ids(v, b.slug, cred);
    if d = any(ids) then raise exception 'T2B v% FAIL: hidden draft listed', v; end if;
    r := pg_temp.t20261116c_try_edit(v, b.slug, cred, d::uuid);
    if (r->>'error') is distinct from 'draft_not_editable' then raise exception 'T2B v% FAIL: hidden draft editable %', v, r; end if;

    -- C hidden + on queue
    update public.client_boards set board = jsonb_set(board, '{queue}', coalesce(board->'queue','[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', d)))
     where slug = b.slug;
    ids := pg_temp.t20261116c_sched_ids(v, b.slug, cred);
    if not d = any(ids) then raise exception 'T2C v% FAIL: queued draft not listed', v; end if;
    r := pg_temp.t20261116c_try_edit(v, b.slug, cred, d::uuid);
    if (r->>'ok') is distinct from 'true' then raise exception 'T2C v% FAIL: queued draft not editable %', v, r; end if;

    -- D visible + off queue
    update public.carousel_drafts set board_visible = true where id = d::uuid;
    update public.client_boards set board = jsonb_set(board, '{queue}', coalesce((
        select jsonb_agg(q) from jsonb_array_elements(board->'queue') q where q->>'id' <> d), '[]'::jsonb))
     where slug = b.slug;
    ids := pg_temp.t20261116c_sched_ids(v, b.slug, cred);
    if not d = any(ids) then raise exception 'T2D v% FAIL: visible scheduled draft not listed', v; end if;
    r := pg_temp.t20261116c_try_edit(v, b.slug, cred, d::uuid);
    if (r->>'ok') is distinct from 'true' then raise exception 'T2D v% FAIL: visible draft not editable %', v, r; end if;

    -- back to A for the next version
    update public.client_boards set board = jsonb_set(board, '{queue}', coalesce(board->'queue','[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', d)))
     where slug = b.slug;
  end loop;
  raise notice 'T2 ok: v1 and v2, four states';
end $t2$;

rollback;
