-- 068: block a scheduled post that repeats one already queued or posted.
-- Incident 2026-09-16: "Poland: safety belongs in living standards" published
-- six days after Ivan's own rewrite of the same idea (same Eurostat 14.7% / 2.8%).
-- The publisher's Dedup Guard (0Ym6bP7gEmskPJZn) compares WORDING only (trigram
-- Jaccard 0.6, 7d), and a rewrite shares the figures, not the words.
--
-- Rule (replayed over all 205 historical rows before shipping):
--   same platform, within 30 days either side, other row pending or posted, and
--   (a) 2+ shared distinctive figures (a %, k, m, b or currency figure that is
--       not a round multiple-of-5 percent, which cut the 20/80 and 5/95 noise), or
--   (b) trigram similarity >= 0.8 (near-identical text).
-- A hit sets status='blocked', error_message 'duplicate_of:<id> ...', and drops an
-- inbox alert. The publisher only drains status='pending', so a blocked row never posts.
-- Override: set the blocked row back to 'pending' (or tap Post now) and the guard lets it through.

create or replace function public.scheduled_post_figures(p_text text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct f), '{}') from (
    select lower(replace(m[1], ' ', '')) f
    from regexp_matches(coalesce(p_text, ''), '((?:[$€£]\s?)?\d+(?:[.,]\d+)?\s?(?:%|[kKmMbB]\y))', 'g') m
  ) x
  where f !~ '^\d*[05]%$'
$$;

create or replace function public.guard_scheduled_post_duplicate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  hit record;
  mine text[];
begin
  if new.status is distinct from 'pending' or coalesce(new.is_repost, false) then
    return new;
  end if;
  -- deliberate release of a row this guard blocked
  if tg_op = 'UPDATE' and old.status = 'blocked' and coalesce(old.error_message, '') like 'duplicate_of:%' then
    return new;
  end if;
  -- only re-check an already-pending row when its copy or slot changed
  if tg_op = 'UPDATE' and old.status = 'pending'
     and old.post_text is not distinct from new.post_text
     and old.scheduled_at is not distinct from new.scheduled_at then
    return new;
  end if;

  mine := public.scheduled_post_figures(new.post_text);

  select s.id, s.status, s.scheduled_at, left(s.post_text, 80) t,
         array(select unnest(mine) intersect select unnest(public.scheduled_post_figures(s.post_text))) shared,
         similarity(coalesce(s.post_text, ''), coalesce(new.post_text, '')) sim
    into hit
  from public.scheduled_posts s
  where s.id <> new.id
    and s.platform is not distinct from new.platform
    and s.status in ('pending', 'posted')
    and s.scheduled_at between new.scheduled_at - interval '30 days' and new.scheduled_at + interval '30 days'
    and (
      cardinality(array(select unnest(mine) intersect select unnest(public.scheduled_post_figures(s.post_text)))) >= 2
      or similarity(coalesce(s.post_text, ''), coalesce(new.post_text, '')) >= 0.8
    )
  order by s.scheduled_at
  limit 1;

  if hit.id is not null then
    new.status := 'blocked';
    new.error_message := format('duplicate_of:%s (%s %s) shared=%s sim=%s',
      hit.id, hit.status, to_char(hit.scheduled_at, 'YYYY-MM-DD'),
      array_to_string(hit.shared, ','), round(hit.sim::numeric, 2));
    begin
      insert into public.inbox_notifications (family, source, severity, title, body, url, dedupe_key)
      values ('content_board_activity', 'db:068_duplicate_guard', 'attention',
        left(format('Post held as a duplicate: %s slot repeats the %s post', to_char(new.scheduled_at, 'Mon DD'), to_char(hit.scheduled_at, 'Mon DD')), 200),
        left(format(E'Held: %s\n\nRepeats (%s): %s\n\nShared figures: %s. Set it back to pending on the board if it should still go out.',
          left(new.post_text, 160), hit.status, hit.t, coalesce(nullif(array_to_string(hit.shared, ', '), ''), 'near-identical text')), 4000),
        './#exp/brain-b/content',
        'duplicate_guard:' || coalesce(new.clickup_task_id, new.id::text));
    exception when others then null; -- never block a scheduled_posts write on the alert
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_scheduled_post_duplicate on public.scheduled_posts;
create trigger trg_guard_scheduled_post_duplicate
  before insert or update of post_text, scheduled_at, status on public.scheduled_posts
  for each row execute function public.guard_scheduled_post_duplicate();
