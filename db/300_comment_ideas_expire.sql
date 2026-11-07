-- db/300 (review #19, 2026-11-07): comment ideas whose target post is too old to comment on usefully
-- leave the pending pile. Nothing is deleted: the card gets send_blocked_reason = 'expired_post_too_old'
-- (hidden like a discard, but kept apart from Ivan's own discards so discard counts stay his) and every
-- stamp is logged with a run_id, so comment_ideas_expire_undo(run_id) puts the cards back exactly.
--
-- Age rule, from his approvals (ops_drafts comment_outbound, 2026-08-01..11-06): 61 of 62 approved ideas
-- had a target post 72 h old or less (52 of 62 at 48 h; last 30 days all <= 30 h; oldest ever 89 h).
-- So: post older than 72 h, or older than the lane's own posting window when that is longer
-- (RISE owner lane: outreach_seats.settings.owner_comment.max_post_age_days = 4 -> 96 h).
-- A card with no readable post time is left alone (unknown age is not old).

create table if not exists public.comment_idea_expiry_log (
  id bigserial primary key,
  run_id uuid not null,
  ops_draft_id uuid not null references public.ops_drafts(id),
  client_id text,
  lane text,
  post_posted_at timestamptz,
  max_post_age interval not null,
  expired_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists comment_idea_expiry_log_run_idx on public.comment_idea_expiry_log (run_id);
create index if not exists comment_idea_expiry_log_draft_idx on public.comment_idea_expiry_log (ops_draft_id);
alter table public.comment_idea_expiry_log enable row level security;

-- A post time that does not parse (e.g. '2026-02-30T12:00:00Z') is unknown age: null, never an error
-- that would stop the whole sweep.
create or replace function public.comment_idea_ts_or_null(p text)
returns timestamptz
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end
$$;

create or replace function public.comment_ideas_stale(p_now timestamptz default now())
returns table(id uuid, client_id text, lane text, post_posted_at timestamptz, max_post_age interval)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with c as (
    select d.id, d.client_id,
           coalesce(nullif(d.context->>'lane', ''), 'quality') as lane,
           coalesce(nullif(d.context->>'seat', ''), d.client_id) as seat,
           public.comment_idea_ts_or_null(d.context->>'posted_at') as posted_at
      from public.ops_drafts d
     where d.kind = 'comment_outbound'
       and d.approved_at is null and d.sent_at is null and d.send_blocked_reason is null
  ), w as (
    select c.*,
           greatest(interval '72 hours',
                    coalesce((select make_interval(days => (s.settings->'owner_comment'->>'max_post_age_days')::int)
                                from public.outreach_seats s
                               where c.lane = 'owner' and s.seat = c.seat
                                 and s.settings->'owner_comment'->>'max_post_age_days' ~ '^\d{1,2}$'
                               limit 1), interval '0')) as max_age
      from c
  )
  select w.id, w.client_id, w.lane, w.posted_at, w.max_age
    from w
   where w.posted_at is not null and w.posted_at <= p_now
     and p_now - w.posted_at > w.max_age
$$;

create or replace function public.comment_ideas_expire_stale(p_dry_run boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_run uuid := gen_random_uuid();
  v_n int;
  v_by jsonb;
begin
  if p_dry_run then
    select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_by
      from (select client_id || '/' || lane as k, count(*) as n from public.comment_ideas_stale() group by 1) x;
    return jsonb_build_object('dry_run', true, 'would_expire', (select count(*) from public.comment_ideas_stale()), 'by_seat_lane', v_by);
  end if;
  with s as (select * from public.comment_ideas_stale()),
  u as (
    update public.ops_drafts d
       set send_blocked_reason = 'expired_post_too_old'
      from s
     where d.id = s.id
       and d.approved_at is null and d.sent_at is null and d.send_blocked_reason is null
    returning d.id, s.client_id, s.lane, s.post_posted_at, s.max_post_age
  )
  insert into public.comment_idea_expiry_log (run_id, ops_draft_id, client_id, lane, post_posted_at, max_post_age)
  select v_run, u.id, u.client_id, u.lane, u.post_posted_at, u.max_post_age from u;
  get diagnostics v_n = row_count;
  return jsonb_build_object('run_id', v_run, 'expired', v_n);
end
$$;

-- Undo one run (or some ids of it). Only a card still carrying this exact stamp and still unapproved
-- is put back; anything that moved on since is left as it is.
create or replace function public.comment_ideas_expire_undo(p_run_id uuid, p_ids uuid[] default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  with l as (
    select ops_draft_id from public.comment_idea_expiry_log
     where run_id = p_run_id and undone_at is null and (p_ids is null or ops_draft_id = any(p_ids))
  ), u as (
    update public.ops_drafts d
       set send_blocked_reason = null
      from l
     where d.id = l.ops_draft_id
       and d.send_blocked_reason = 'expired_post_too_old' and d.approved_at is null and d.sent_at is null
    returning d.id
  )
  update public.comment_idea_expiry_log g
     set undone_at = now()
    from u
   where g.run_id = p_run_id and g.ops_draft_id = u.id and g.undone_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('run_id', p_run_id, 'restored', v_n);
end
$$;

revoke all on function public.comment_idea_ts_or_null(text) from public, anon, authenticated;
revoke all on function public.comment_ideas_stale(timestamptz) from public, anon, authenticated;
revoke all on function public.comment_ideas_expire_stale(boolean) from public, anon, authenticated;
revoke all on function public.comment_ideas_expire_undo(uuid, uuid[]) from public, anon, authenticated;
revoke all on table public.comment_idea_expiry_log from anon, authenticated;
grant execute on function public.comment_idea_ts_or_null(text), public.comment_ideas_stale(timestamptz), public.comment_ideas_expire_stale(boolean), public.comment_ideas_expire_undo(uuid, uuid[]) to service_role;

-- Daily sweep, so the pile stays honest after the backlog run.
select cron.unschedule(jobid) from cron.job where jobname = 'comment-ideas-expire';
select cron.schedule('comment-ideas-expire', '20 3 * * *', $$select public.comment_ideas_expire_stale(false)$$);

-- Daily cap per seat (review #19): RISE owner drafter keeps the first day_cap survivors in its own order.
update public.outreach_seats
   set settings = jsonb_set(settings, '{owner_comment,day_cap}', '4'::jsonb)
 where seat = 'risedtc' and settings->'owner_comment'->>'day_cap' = '5';
