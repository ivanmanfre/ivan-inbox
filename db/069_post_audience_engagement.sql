-- 069: operator_post_audience also carries reactions and comments per post, so
-- the reach block can say what commented posts reached. Same signature, so a
-- plain CREATE OR REPLACE; post_audience_rows(text) is untouched (068).
create or replace function public.operator_post_audience(p_gate text, p_client_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unknown seat'; end if;
  return coalesce((
    select jsonb_agg(
      to_jsonb(r) || jsonb_build_object('reactions', coalesce(t.reactions, h.reactions), 'comments', coalesce(t.comments, h.comments))
      order by r.published_at desc nulls last)
    from public.post_audience_rows(p_client_id) r
    left join lateral (
      select m.reactions, m.comments
      from public.client_post_metrics m,
        lateral (select coalesce(substring(m.post_url from 'activity[-:](\d{15,})'),
                                 substring(m.social_id from 'activity:(\d+)')) as aid) x
      where r.source = 'tracker' and m.client_id = p_client_id and x.aid = r.activity_id
      order by m.captured_at desc nulls last
      limit 1
    ) t on true
    left join public.post_audience_history h
      on r.source = 'backfill' and h.seat = p_client_id and h.activity_id = r.activity_id
  ), '[]'::jsonb);
end $$;
