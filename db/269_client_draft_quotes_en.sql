-- db/269: English versions of client call quotes on drafts, so client panels show English
-- (ARCH calls are in Croatian). The panel reads source_detail.quote_en first (personal PR).
-- Reuses the content-plan-quotes function and cron: the function now also asks this list.
-- Stored on carousel_drafts.source_detail as quote_en + quote_en_src (the exact quote it was made from),
-- and patched into the same draft on client_boards.board.queue so a panel already holding the post updates.
-- The original quote is never changed.

create or replace function public.content_plan_draft_quotes_due(p_limit int default 20)
returns table(draft_id uuid, src text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.source_detail->>'quote'
    from public.carousel_drafts d
   where d.client_id is not null and d.client_id <> 'ivan'
     and d.status in ('review','approved','scheduled','published')
     and d.created_at > now() - interval '90 days'
     and jsonb_typeof(d.source_detail) = 'object'
     and nullif(btrim(d.source_detail->>'quote'), '') is not null
     and (nullif(btrim(d.source_detail->>'quote_en'), '') is null
          or (d.source_detail ? 'quote_en_src' and d.source_detail->>'quote_en_src' is distinct from d.source_detail->>'quote'))
   order by (d.status = 'review') desc, coalesce(d.scheduled_at, d.created_at) desc, d.id
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Writes only a non-empty answer, and only while the draft's quote is still p_src.
create or replace function public.content_plan_draft_quote_save(p_draft uuid, p_src text, p_en text)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_en     text := nullif(btrim(coalesce(p_en, '')), '');
  v_client text;
begin
  if p_draft is null or p_src is null or v_en is null then
    return false;
  end if;
  update public.carousel_drafts d
     set source_detail = d.source_detail || jsonb_build_object('quote_en', v_en, 'quote_en_src', p_src)
   where d.id = p_draft and d.source_detail->>'quote' = p_src
  returning d.client_id into v_client;
  if v_client is null then
    return false;
  end if;
  -- Same in-place patch as client_board_mirror_draft: only the matching queue item, only while it holds this quote.
  update public.client_boards b
     set board = jsonb_set(b.board, '{queue}', (
       select jsonb_agg(case when q->>'id' = p_draft::text and q->'source_detail'->>'quote' = p_src
                             then jsonb_set(q, '{source_detail,quote_en}', to_jsonb(v_en)) else q end order by ord)
         from jsonb_array_elements(b.board->'queue') with ordinality as t(q, ord)))
   where b.client_id = v_client
     and jsonb_typeof(b.board->'queue') = 'array'
     and b.board->'queue' @> jsonb_build_array(jsonb_build_object('id', p_draft::text));
  return true;
end;
$$;

revoke all on function public.content_plan_draft_quotes_due(int) from public, anon, authenticated;
revoke all on function public.content_plan_draft_quote_save(uuid, text, text) from public, anon, authenticated;
grant execute on function public.content_plan_draft_quotes_due(int) to service_role;
grant execute on function public.content_plan_draft_quote_save(uuid, text, text) to service_role;

-- Same job, now also fires when a draft quote is due.
select cron.schedule('content-plan-quotes', '*/30 * * * *', $cron$
select net.http_post(
  url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/content-plan-quotes',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-inbox-secret', (select value from public.integration_config where key = 'inbox_push_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000)
where exists (select 1 from public.content_plan_quotes_due(1))
   or exists (select 1 from public.content_plan_draft_quotes_due(1))
$cron$);
