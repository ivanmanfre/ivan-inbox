-- db/299p: "Is this post about Poland?" for Ivan's drafts, read by reasoning, never by keywords
-- (review 2026-11-06 #31: Poland meter on Plan > Weeks; Ivan wants about 2 Poland posts a week, memory
-- feedback-more-poland-posts-2026-10-27). Keyword matches (cb16_is_poland) are NOT the gate here.
--
-- Order of evidence, per draft:
--   1. the content-brain invention check's majority vote (taxonomy.content_brain.checks.invention.majority.poland,
--      an LLM judge with the same definition), when the draft carries it;
--   2. otherwise one proxy read (edge function content-poland-read, every 30 min), stored here and valid only
--      while the body is unchanged (body_md5).
-- Polemic, political and migration takes about Poland count as Poland: nothing is filtered.

create table if not exists public.content_poland_reads (
  draft_id uuid primary key references public.carousel_drafts(id) on delete cascade,
  is_poland boolean not null,
  why text,
  model text,
  body_md5 text not null,
  read_at timestamptz not null default now()
);
alter table public.content_poland_reads enable row level security;
revoke all on table public.content_poland_reads from public, anon, authenticated;
grant all on table public.content_poland_reads to service_role;

-- The brain check's vote, when the draft has one: true, false, or null.
create or replace function public.content_poland_brain_vote(p_taxonomy jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(p_taxonomy) = 'object'
               and (p_taxonomy #>> '{content_brain,checks,invention,majority,poland}') in ('true', 'false')
              then (p_taxonomy #>> '{content_brain,checks,invention,majority,poland}')::boolean end
$$;

-- Ivan's drafts the meter can see (review, approved, scheduled, or published in the last 21 days; written in the
-- last 60 days) with no brain vote and no read of their current body. Newest first.
create or replace function public.content_poland_due(p_limit int default 20)
returns table(draft_id uuid, body text, body_md5 text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.post_body, md5(d.post_body)
    from public.carousel_drafts d
    left join public.content_poland_reads r on r.draft_id = d.id
   where d.client_id is null
     and nullif(btrim(coalesce(d.post_body, '')), '') is not null
     and d.created_at > now() - interval '60 days'
     and (d.status in ('review', 'approved', 'scheduled')
          or (d.published_at is not null and d.published_at > now() - interval '21 days'))
     and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
     and public.content_poland_brain_vote(d.taxonomy) is null
     and (r.draft_id is null or r.body_md5 is distinct from md5(d.post_body))
   order by d.created_at desc
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Saves one read, only while the body is still the one that was read.
create or replace function public.content_poland_save(p_draft uuid, p_body_md5 text, p_is_poland boolean, p_why text, p_model text)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if p_draft is null or p_body_md5 is null or p_is_poland is null then return false; end if;
  if not exists (select 1 from public.carousel_drafts d where d.id = p_draft and d.client_id is null and md5(d.post_body) = p_body_md5) then
    return false;
  end if;
  insert into public.content_poland_reads(draft_id, is_poland, why, model, body_md5, read_at)
  values (p_draft, p_is_poland, left(nullif(btrim(coalesce(p_why, '')), ''), 300), p_model, p_body_md5, now())
  on conflict (draft_id) do update
     set is_poland = excluded.is_poland, why = excluded.why, model = excluded.model, body_md5 = excluded.body_md5, read_at = excluded.read_at;
  return true;
end;
$$;

-- What the app reads: one row per asked id on Ivan's seat. poland is null when nothing has read it yet.
create or replace function public.content_poland_of(p_ids uuid[])
returns table(draft_id uuid, poland boolean, source text, why text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
  select d.id,
         coalesce(public.content_poland_brain_vote(d.taxonomy), case when r.body_md5 = md5(d.post_body) then r.is_poland end),
         case when public.content_poland_brain_vote(d.taxonomy) is not null then 'brain_check'
              when r.body_md5 = md5(d.post_body) then 'read' end,
         case when public.content_poland_brain_vote(d.taxonomy) is not null then null::text
              when r.body_md5 = md5(d.post_body) then r.why end
    from public.carousel_drafts d
    left join public.content_poland_reads r on r.draft_id = d.id
   where d.id = any(coalesce(p_ids, '{}'::uuid[])) and d.client_id is null
   limit 500;
end;
$$;

revoke all on function public.content_poland_brain_vote(jsonb) from public, anon, authenticated;
revoke all on function public.content_poland_due(int) from public, anon, authenticated;
revoke all on function public.content_poland_save(uuid, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.content_poland_of(uuid[]) from public, anon;
grant execute on function public.content_poland_brain_vote(jsonb) to service_role;
grant execute on function public.content_poland_due(int) to service_role;
grant execute on function public.content_poland_save(uuid, text, boolean, text, text) to service_role;
grant execute on function public.content_poland_of(uuid[]) to authenticated, service_role;

-- Twice an hour, only when something is due. The secret is read at run time, never stored in the job.
select cron.schedule('content-poland-read', '15,45 * * * *', $cron$
select net.http_post(
  url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-poland-read',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-inbox-secret', (select value from public.integration_config where key = 'inbox_push_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000)
where exists (select 1 from public.content_poland_due(1))
$cron$);
