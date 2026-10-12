-- Rollback for db/260 fix1: the live content_plan_quotes_due body captured with pg_get_functiondef before fix1.
CREATE OR REPLACE FUNCTION public.content_plan_quotes_due(p_limit integer DEFAULT 20)
 RETURNS TABLE(idea_id uuid, src text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
