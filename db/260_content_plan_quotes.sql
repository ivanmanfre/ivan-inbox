-- db/260: English versions of call quotes, cached on client_ideas (quote_en, quote_en_at, quote_en_src from db/259).
-- The source quote rule is public.content_plan_source_quote (db/259), reused here; no second definition.
-- content_plan_brain_items / content_plan_week show quote_en only while quote_en_src = content_plan_source_quote(id),
-- so the cache stores the exact full source text it was made from.

-- Ideas on the plan horizon (plan slots of this week and the next two, or behind drafts dated in those weeks,
-- Warsaw weeks like content_plan_week) whose source quote has no up-to-date English version.
create or replace function public.content_plan_quotes_due(p_limit int default 20)
returns table(idea_id uuid, src text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with h as (
    select ((now() at time zone 'Europe/Warsaw')::date
            - (extract(isodow from (now() at time zone 'Europe/Warsaw')::date)::int - 1)) as w0
  ), tied as (
    select s.idea_ref::uuid as id, (s.week_start::timestamp at time zone 'Europe/Warsaw') as at
      from public.content_plan_slots s, h
     where s.idea_source = 'client_ideas' and s.idea_ref ~ '^[0-9a-fA-F-]{36}$'
       and s.status in ('planned','proposal','requested')
       and s.week_start >= h.w0 and s.week_start < h.w0 + 21
    union all
    -- A slot holding an undated draft: the idea behind that draft.
    select d.client_idea_id, (s.week_start::timestamp at time zone 'Europe/Warsaw')
      from public.content_plan_slots s
      join public.carousel_drafts d on s.idea_source = 'carousel_drafts' and d.id::text = s.idea_ref, h
     where d.client_idea_id is not null
       and s.status in ('planned','proposal','requested')
       and s.week_start >= h.w0 and s.week_start < h.w0 + 21
    union all
    select d.client_idea_id, coalesce(d.published_at, d.scheduled_at)
      from public.carousel_drafts d, h
     where d.client_idea_id is not null
       and d.status in ('review','approved','scheduled','published')
       and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
       and coalesce(d.published_at, d.scheduled_at) >= (h.w0::timestamp at time zone 'Europe/Warsaw')
       and coalesce(d.published_at, d.scheduled_at) < ((h.w0 + 21)::timestamp at time zone 'Europe/Warsaw')
  ), ideas as (
    select t.id, min(t.at) as at from tied t group by t.id
  )
  select q.id, q.src
    from (select i.id, i.at, public.content_plan_source_quote(i.id) as src from ideas i) q
    join public.client_ideas ci on ci.id = q.id
   where q.src is not null and ci.quote_en_src is distinct from q.src
   order by q.at, q.id
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Saves one English version. Writes only a non-empty answer, and only while the source quote is still p_src.
create or replace function public.content_plan_quote_save(p_idea uuid, p_src text, p_en text)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if p_idea is null or p_src is null or nullif(btrim(coalesce(p_en, '')), '') is null then
    return false;
  end if;
  update public.client_ideas ci
     set quote_en = btrim(p_en), quote_en_at = now(), quote_en_src = p_src
   where ci.id = p_idea and public.content_plan_source_quote(ci.id) = p_src;
  return found;
end;
$$;

revoke all on function public.content_plan_quotes_due(int) from public, anon, authenticated;
revoke all on function public.content_plan_quote_save(uuid, text, text) from public, anon, authenticated;
grant execute on function public.content_plan_quotes_due(int) to service_role;
grant execute on function public.content_plan_quote_save(uuid, text, text) to service_role;

-- Every 30 minutes, only when something is due. The secret is read from integration_config at run time
-- (integration_config.value is text), never stored in the job or the repo.
select cron.schedule('content-plan-quotes', '*/30 * * * *', $cron$
select net.http_post(
  url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-plan-quotes',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-inbox-secret', (select value from public.integration_config where key = 'inbox_push_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000)
where exists (select 1 from public.content_plan_quotes_due(1))
$cron$);
