-- desk_t3_report: how a T3 Code cloud thread reports back to the Content Desk.
--
-- The caller is an agent on Ivan Cloud holding one job id and that job's
-- one-time token (only its sha256 is stored). It may move the job forward
-- (sent < launched < running < done|failed; stalled may resume) and, on a
-- terminal status, the result lands in the desk as an origin='t3' message.
-- An unknown job and a wrong token get the same answer, so the endpoint is
-- no oracle for which job ids exist.

-- Sol desk-t3 r1 #1: a stable launch id, persisted on the job BEFORE the poller
-- asks Ivan Cloud to start a thread. The host looks for a thread already made for
-- this id before launching, so a lost reply or a lost report never starts a
-- second thread for one job.
alter table public.desk_t3_jobs add column if not exists launch_id uuid;
-- Sol desk-t3 r2 #1: the poller's ownership lease. It is refreshed on every tick for each job
-- the poller holds; a poller without local state may adopt a job only after the lease ran out.
alter table public.desk_t3_jobs add column if not exists poller_seen_at timestamptz;

-- A launch id is set once and never changes (Sol desk-t3 r2 #1).
create or replace function public.desk_t3_jobs_launch_id_once() returns trigger
language plpgsql set search_path = public, pg_temp as $f$
begin
  if old.launch_id is not null and new.launch_id is distinct from old.launch_id then
    raise exception 'desk_t3_jobs.launch_id is set once' using errcode = '23514';
  end if;
  return new;
end $f$;
revoke all on function public.desk_t3_jobs_launch_id_once() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'desk_t3_jobs_launch_id_once') then
    create trigger desk_t3_jobs_launch_id_once before update of launch_id on public.desk_t3_jobs
      for each row execute function public.desk_t3_jobs_launch_id_once();
  end if;
end $t$;

create or replace function public.desk_t3_report(
  p_job uuid,
  p_token text,
  p_status text,
  p_t3_thread_id text default null,
  p_link text default null,
  p_summary text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    -- A late 'launched' after 'running' is not an error, just old news.
    return jsonb_build_object('ok', true, 'status', j.status, 'ignored', true);
  end if;

  v_summary := nullif(left(btrim(coalesce(p_summary, '')), 4000), '');
  v_link := nullif(btrim(coalesce(p_link, '')), '');
  if v_link is not null and (length(v_link) > 500 or v_link !~ '^https://[^\s]+$') then
    v_link := null;
  end if;
  v_thread := nullif(left(btrim(coalesce(p_t3_thread_id, '')), 200), '');

  -- Sol desk-t3 r1 #5: a job is bound to exactly one thread. 'launched' names it,
  -- 'running' and 'done' need it, a binding never changes; only 'failed' may come
  -- without one (a launch that never produced a thread).
  if j.t3_thread_id is not null and v_thread is not null and v_thread <> j.t3_thread_id then
    return jsonb_build_object('ok', false, 'error', 'thread_binding_conflict');
  end if;
  if p_status = 'launched' and v_thread is null and j.t3_thread_id is null then
    return jsonb_build_object('ok', false, 'error', 'thread_required');
  end if;
  -- the first binding happens only on 'launched' (Sol desk-t3 r2 #5)
  if p_status in ('running', 'done') and j.t3_thread_id is null then
    return jsonb_build_object('ok', false, 'error', 'thread_required');
  end if;
  -- a summary needs one visible character; tabs and newlines alone do not count (Sol r3 #5)
  if p_status = 'done' and coalesce(p_summary, '') !~ '[^[:space:]]' then
    return jsonb_build_object('ok', false, 'error', 'summary_required');
  end if;

  update public.desk_t3_jobs set
    status = p_status,
    -- only 'launched' ever binds a thread (Sol r3 #5); other statuses keep the binding as is
    t3_thread_id = case when p_status = 'launched' then coalesce(t3_thread_id, v_thread) else t3_thread_id end,
    t3_link = coalesce(v_link, t3_link),
    result_summary = case when rank_new = 4 then coalesce(v_summary, result_summary) else result_summary end,
    events = events || jsonb_build_array(jsonb_build_object('at', now(), 'status', p_status)),
    updated_at = now()
  where id = j.id
  returning * into j;

  if rank_new = 4 then
    insert into public.desk_messages (user_id, role, origin, body, meta)
    values (
      j.user_id, 'assistant', 't3',
      coalesce(j.result_summary,
        case when p_status = 'done' then 'The cloud job "' || j.title || '" finished.'
             else 'The cloud job "' || j.title || '" failed.' end),
      jsonb_build_object('job_id', j.id, 't3_link', j.t3_link, 'status', j.status, 'title', j.title)
    )
    returning id into v_msg;
  end if;

  return jsonb_build_object('ok', true, 'status', j.status, 'message_id', v_msg);
end;
$$;

revoke all on function public.desk_t3_report(uuid, text, text, text, text, text) from public;
-- Service role only. The Mac poller (~/.claude-resident/desk-t3/poll.py) is the
-- one caller: it holds each job's token and reads the thread state on Ivan
-- Cloud itself, so the cloud thread never needs a token or a URL. The token
-- check stays as a second lock and keeps one code path for status changes.
revoke execute on function public.desk_t3_report(uuid, text, text, text, text, text) from anon, authenticated;
grant execute on function public.desk_t3_report(uuid, text, text, text, text, text) to service_role;
