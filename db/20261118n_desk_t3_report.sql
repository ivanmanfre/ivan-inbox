-- desk_t3_report: how a T3 Code cloud thread reports back to the Content Desk.
--
-- The caller is an agent on Ivan Cloud holding one job id and that job's
-- one-time token (only its sha256 is stored). It may move the job forward
-- (sent < launched < running < done|failed; stalled may resume) and, on a
-- terminal status, the result lands in the desk as an origin='t3' message.
-- An unknown job and a wrong token get the same answer, so the endpoint is
-- no oracle for which job ids exist.

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

  update public.desk_t3_jobs set
    status = p_status,
    t3_thread_id = coalesce(v_thread, t3_thread_id),
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
