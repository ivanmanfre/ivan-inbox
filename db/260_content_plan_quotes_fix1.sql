-- db/260 fix1: content_plan_quotes_due also covers the ideas behind the undated Review drafts that
-- content_plan_week lists in `supply` (status review, no date, created in the last 30 days, not operator-deleted,
-- no drop verdict), after the plan-week items. Grants are unchanged (create or replace keeps them).
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
    union all
    -- Undated drafts waiting in Review (content_plan_week's supply list): the idea behind each.
    select d.client_idea_id, ((h.w0 + 21)::timestamp at time zone 'Europe/Warsaw')
      from public.carousel_drafts d, h
     where d.client_idea_id is not null
       and d.status = 'review' and d.scheduled_at is null and d.created_at >= now() - interval '30 days'
       and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
       and not exists (select 1 from public.cb39_draft_verdicts v where v.draft_id = d.id and v.verdict = 'drop')
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
