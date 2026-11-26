-- Cloud jobs: any T3 job on Ivan Cloud started from the inbox, and replies into the same thread.
--
-- Builds on the Content Desk's job machine (db/20261118m, db/20261118n). One desk_t3_jobs row
-- is one turn on Ivan Cloud:
--   origin 'desk'  - the Content Desk (unchanged; every existing row and caller keeps this)
--   origin 'inbox' - Ivan typed a task in the inbox; the poller launches a new root thread
--   origin 'reply' - Ivan answered a finished job; the poller posts his text into the parent's
--                    thread (target_thread_id) and tracks the new turn as its own job
-- Only 'desk' rows write a desk message when they end. 'inbox' and 'reply' rows send one inbox
-- notification instead (family cloud_job), so the phone rings when a cloud job finishes.
--
-- ORDER: the poller that understands origin (poll.py v2) must be live before any 'inbox' or
-- 'reply' row exists; the v1 poller would launch a reply as a new root thread.

alter table public.desk_t3_jobs add column if not exists origin text not null default 'desk';
-- a parent with replies cannot be deleted (Sol r1): its replies would lose their thread anchor
alter table public.desk_t3_jobs add column if not exists parent_job_id uuid references public.desk_t3_jobs(id) on delete restrict;
alter table public.desk_t3_jobs add column if not exists target_thread_id text;
alter table public.desk_t3_jobs add column if not exists context jsonb not null default '{}'::jsonb;
alter table public.desk_t3_jobs add column if not exists notify_request_id bigint;

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'desk_t3_jobs_origin_check') then
    alter table public.desk_t3_jobs add constraint desk_t3_jobs_origin_check
      check (origin in ('desk', 'inbox', 'reply'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desk_t3_jobs_reply_shape') then
    -- a reply always names the job it answers and that job's thread; nothing else carries a target
    alter table public.desk_t3_jobs add constraint desk_t3_jobs_reply_shape
      check ((origin = 'reply' and parent_job_id is not null and target_thread_id is not null)
          or (origin <> 'reply' and parent_job_id is null and target_thread_id is null));
  end if;
end $c$;

create index if not exists desk_t3_jobs_parent_idx on public.desk_t3_jobs (parent_job_id) where parent_job_id is not null;
create index if not exists desk_t3_jobs_origin_created_idx on public.desk_t3_jobs (origin, created_at desc);

-- The one operator who may start cloud jobs, and the switch that opens the door. Both set by hand:
--   insert into public.desk_config (key, value) values ('cloud_operator_uid', to_jsonb('<auth uid>'::text));
--   insert into public.desk_config (key, value) values ('cloud_jobs_enabled', 'true'::jsonb);
-- cloud_jobs_enabled goes true only once the v2 poller (origin-aware) owns the bridge (Sol r1):
-- a v1 poller would launch a reply as a new root thread.
create or replace function public.cloud_job_operator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $f$
  select auth.uid() is not null
     and exists (select 1 from public.desk_config
                  where key = 'cloud_operator_uid' and jsonb_typeof(value) = 'string' and value #>> '{}' = auth.uid()::text)
     and exists (select 1 from public.desk_config where key = 'cloud_jobs_enabled' and value = 'true'::jsonb)
$f$;
revoke all on function public.cloud_job_operator() from public, anon;
grant execute on function public.cloud_job_operator() to authenticated;

-- The job that started a conversation (a reply's chain walked up to its root).
create or replace function public.cloud_job_root(p_job uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  with recursive up as (
    select id, parent_job_id, 0 as depth from public.desk_t3_jobs where id = p_job
    union all
    select j.id, j.parent_job_id, up.depth + 1 from public.desk_t3_jobs j join up on j.id = up.parent_job_id
     where up.depth < 200
  )
  select id from up where parent_job_id is null order by depth desc limit 1
$f$;
revoke all on function public.cloud_job_root(uuid) from public, anon, authenticated;

-- Start a new cloud job. A placeholder token hash nobody keeps, as queueT3Job does: only the
-- poller's own claim can ever report on the row.
create or replace function public.cloud_job_create(p_title text, p_brief text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $f$
declare
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), 120);
  v_brief text := left(btrim(coalesce(p_brief, '')), 8000);
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_id uuid;
begin
  if not public.cloud_job_operator() then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_brief !~ '[^[:space:]]' then
    return jsonb_build_object('ok', false, 'error', 'empty_job');
  end if;
  if jsonb_typeof(v_ctx) <> 'object' or length(v_ctx::text) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'bad_context');
  end if;
  if v_title !~ '[^[:space:]]' then
    v_title := left(btrim(regexp_replace(v_brief, '\s+', ' ', 'g')), 80);
  end if;
  insert into public.desk_t3_jobs (user_id, title, brief, status, origin, context, report_token_hash, events)
  values (auth.uid(), v_title, v_brief, 'queued', 'inbox', v_ctx,
          encode(extensions.digest(gen_random_bytes(32), 'sha256'), 'hex'),
          jsonb_build_array(jsonb_build_object('at', now(), 'status', 'queued', 'by', 'inbox')))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'job_id', v_id);
end $f$;
revoke all on function public.cloud_job_create(text, text, jsonb) from public, anon;
grant execute on function public.cloud_job_create(text, text, jsonb) to authenticated;

-- Answer a cloud job. The parent must be Ivan's and finished, with a thread, and nothing else may
-- be under way in that thread: the poller judges a reply by the run its own message starts, but
-- one turn at a time keeps each phone answer tied to the question it answers.
create or replace function public.cloud_job_reply(p_parent uuid, p_text text, p_client_key text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $f$
declare
  p public.desk_t3_jobs%rowtype;
  v_text text := left(btrim(coalesce(p_text, '')), 8000);
  v_key text := nullif(left(btrim(coalesce(p_client_key, '')), 80), '');
  v_root uuid;
  v_id uuid;
  v_hit uuid;
begin
  if not public.cloud_job_operator() then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_text !~ '[^[:space:]]' then
    return jsonb_build_object('ok', false, 'error', 'empty_reply');
  end if;
  select * into p from public.desk_t3_jobs where id = p_parent and user_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_such_job');
  end if;
  if p.t3_thread_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_thread_yet');
  end if;
  v_root := public.cloud_job_root(p.id);
  -- One reply at a time per thread, whichever turn of it Ivan answered (Sol r1): the busy check and
  -- the insert run under a lock on the thread, not on the parent row.
  perform pg_advisory_xact_lock(hashtextextended('cloud_job_thread:' || p.t3_thread_id, 0));
  -- A phone retry of the same reply returns the job it already made.
  if v_key is not null then
    select id into v_hit from public.desk_t3_jobs
     where origin = 'reply' and target_thread_id = p.t3_thread_id and context->>'client_key' = v_key
     limit 1;
    if v_hit is not null then
      return jsonb_build_object('ok', true, 'job_id', v_hit, 'root_job_id', v_root, 'repeat', true);
    end if;
  end if;
  if p.status not in ('done', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'still_running');
  end if;
  if exists (
    select 1 from public.desk_t3_jobs r
     where (r.t3_thread_id = p.t3_thread_id or r.target_thread_id = p.t3_thread_id)
       and r.status in ('queued', 'sent', 'stalled', 'launched', 'running')
  ) then
    return jsonb_build_object('ok', false, 'error', 'thread_busy');
  end if;
  insert into public.desk_t3_jobs (user_id, title, brief, status, origin, parent_job_id, target_thread_id,
                                   context, report_token_hash, events)
  values (auth.uid(), left('Reply: ' || p.title, 120), v_text, 'queued', 'reply', p.id, p.t3_thread_id,
          jsonb_strip_nulls(jsonb_build_object('root_job_id', v_root, 'client_key', v_key)),
          encode(extensions.digest(gen_random_bytes(32), 'sha256'), 'hex'),
          jsonb_build_array(jsonb_build_object('at', now(), 'status', 'queued', 'by', 'inbox')))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'job_id', v_id, 'root_job_id', v_root);
end $f$;
revoke all on function public.cloud_job_reply(uuid, text, text) from public, anon;
grant execute on function public.cloud_job_reply(uuid, text, text) to authenticated;

-- One inbox notification for a finished 'inbox' or 'reply' job. Called inside desk_t3_report
-- once the row turns terminal, so it fires once per job (a terminal job refuses later reports).
create or replace function public.cloud_job_notify(p_job uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  j public.desk_t3_jobs%rowtype;
  v_url text; v_secret text; v_root uuid; v_req bigint; v_title text; v_body text;
begin
  select * into j from public.desk_t3_jobs where id = p_job;
  if not found or j.origin = 'desk' or j.status not in ('done', 'failed') then return; end if;
  -- integration_config.value is text (Sol r1)
  select value into v_url from public.integration_config where key = 'inbox_notify_url';
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if v_url is null or v_secret is null then return; end if;
  v_root := coalesce(public.cloud_job_root(j.id), j.id);
  v_title := case when j.status = 'done' then 'Cloud: ' else 'Cloud job failed: ' end
             || left(regexp_replace(coalesce((select title from public.desk_t3_jobs where id = v_root), j.title), '\s+', ' ', 'g'), 90);
  v_body := left(regexp_replace(coalesce(j.result_summary, ''), '\s+', ' ', 'g'), 400);
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
    body := jsonb_build_object(
      'family', 'cloud_job',
      'severity', case when j.status = 'done' then 'info' else 'attention' end,
      'title', v_title,
      'body', nullif(v_body, ''),
      'url', './#exp/d/claude/cloud?job=' || v_root::text,
      'dedupe_key', 'cloud_job:' || j.id::text,
      'push', true),
    timeout_milliseconds := 30000) into v_req;
  update public.desk_t3_jobs set notify_request_id = v_req where id = j.id;
exception when others then
  -- a notification must never undo the job's final report
  raise warning 'cloud_job_notify failed for %: %', p_job, sqlstate;
end $f$;
revoke all on function public.cloud_job_notify(uuid) from public, anon, authenticated;

-- desk_t3_report: identical to db/20261118n except (a) a reply may bind only its parent's thread
-- and (b) the terminal branch writes a desk message only for origin 'desk' and sends the
-- cloud_job notification for the others.
create or replace function public.desk_t3_report(
  p_job uuid,
  p_token text,
  p_status text,
  p_t3_thread_id text default null,
  p_link text default null,
  p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  j public.desk_t3_jobs%rowtype;
  rank_old int;
  rank_new int;
  v_summary text;
  v_link text;
  v_thread text;
  v_msg uuid;
begin
  if p_job is null or p_token is null or length(p_token) < 32 or length(p_token) > 200 then
    return jsonb_build_object('ok', false, 'error', 'rejected');
  end if;

  select * into j from public.desk_t3_jobs where id = p_job for update;
  if not found or j.report_token_hash is distinct from encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'rejected');
  end if;

  if p_status not in ('launched', 'running', 'done', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;

  rank_old := case j.status when 'queued' then 0 when 'sent' then 1 when 'stalled' then 1
                            when 'launched' then 2 when 'running' then 3 else 4 end;
  rank_new := case p_status when 'launched' then 2 when 'running' then 3 else 4 end;
  if rank_old = 4 then
    return jsonb_build_object('ok', false, 'error', 'already_final', 'status', j.status);
  end if;
  if rank_new < rank_old then
    return jsonb_build_object('ok', true, 'status', j.status, 'ignored', true);
  end if;

  v_summary := nullif(left(btrim(coalesce(p_summary, '')), 4000), '');
  v_link := nullif(btrim(coalesce(p_link, '')), '');
  if v_link is not null and (length(v_link) > 500 or v_link !~ '^https://[^\s]+$') then
    v_link := null;
  end if;
  v_thread := nullif(left(btrim(coalesce(p_t3_thread_id, '')), 200), '');

  if j.t3_thread_id is not null and v_thread is not null and v_thread <> j.t3_thread_id then
    return jsonb_build_object('ok', false, 'error', 'thread_binding_conflict');
  end if;
  -- a reply runs in its parent's thread and nowhere else
  if j.origin = 'reply' and v_thread is not null and v_thread <> j.target_thread_id then
    return jsonb_build_object('ok', false, 'error', 'thread_binding_conflict');
  end if;
  if p_status = 'launched' and v_thread is null and j.t3_thread_id is null then
    return jsonb_build_object('ok', false, 'error', 'thread_required');
  end if;
  if p_status in ('running', 'done') and j.t3_thread_id is null then
    return jsonb_build_object('ok', false, 'error', 'thread_required');
  end if;
  if p_status = 'done' and coalesce(v_summary, '') !~ '[^[:space:]]' then
    return jsonb_build_object('ok', false, 'error', 'summary_required');
  end if;

  update public.desk_t3_jobs set
    status = p_status,
    t3_thread_id = case when p_status = 'launched' then coalesce(t3_thread_id, v_thread) else t3_thread_id end,
    t3_link = coalesce(v_link, t3_link),
    result_summary = case when rank_new = 4 then coalesce(v_summary, result_summary) else result_summary end,
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'status', p_status)),
    updated_at = now()
  where id = j.id
  returning * into j;

  if rank_new = 4 and j.origin = 'desk' then
    insert into public.desk_messages (user_id, role, origin, body, meta)
    values (
      j.user_id, 'assistant', 't3',
      coalesce(j.result_summary,
        case when p_status = 'done' then 'The cloud job "' || j.title || '" finished.'
             else 'The cloud job "' || j.title || '" failed.' end),
      jsonb_build_object('job_id', j.id, 't3_link', j.t3_link, 'status', j.status, 'title', j.title)
    )
    returning id into v_msg;
  elsif rank_new = 4 then
    perform public.cloud_job_notify(j.id);
  end if;

  return jsonb_build_object('ok', true, 'status', j.status, 'message_id', v_msg);
end;
$function$;
revoke all on function public.desk_t3_report(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.desk_t3_report(uuid, text, text, text, text, text) to service_role;
