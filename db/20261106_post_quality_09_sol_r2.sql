-- 20261106_post_quality_09_sol_r2.sql: cross-review round 2. The relink archives the dead row as read under the lock.
-- Rollback: re-apply ivan_own_post_relink from 20261106_post_quality_09_sol_r1.sql.
begin;
create or replace function public.ivan_own_post_relink(p_apply boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare p record; v_task text; v_live_task text; v_moved boolean; v_spid text; v_row jsonb; out jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ivan-own-post-relink', 0));
  for p in
    with o as (
      select x.*, lower(left(regexp_replace(btrim(coalesce(x.post_text, '')), '\s+', ' ', 'g'), 30)) k30
        from public.own_posts x where x.posted_at > now() - interval '120 days'),
    dead as (
      select * from o where coalesce(num_impressions, 0) = 0 and metrics_updated_at is null
         and posted_at < now() - interval '48 hours' and length(k30) >= 20)
    select d.id dead_id, d.social_id dead_urn, d.clickup_task_id dead_task, to_jsonb(dx) dead_row,
           (array_agg(l.id order by l.num_impressions desc))[1] live_id,
           (array_agg(l.social_id order by l.num_impressions desc))[1] live_urn,
           count(l.id) n_live
      from dead d
      join public.own_posts dx on dx.id = d.id
      join o l on l.id <> d.id and l.k30 = d.k30 and (l.posted_at at time zone 'UTC')::date = (d.posted_at at time zone 'UTC')::date
              and coalesce(l.num_impressions, 0) > 0 and l.metrics_updated_at is not null
              -- a twin is the same post: the full text matches (all 9 real pairs on 2026-11-06 were >= 0.97), not only its opening
              and similarity(coalesce(l.post_text, ''), coalesce(d.post_text, '')) >= 0.9
     group by d.id, d.social_id, d.clickup_task_id, dx.id
  loop
    if p.n_live <> 1 then skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twins: ' || p.n_live)); continue; end if;
    -- lock both rows (fixed order), then re-read what the decision rests on (sol r1 #3)
    perform 1 from public.own_posts where id in (p.dead_id, p.live_id) order by id for update;
    if not exists (select 1 from public.own_posts where id = p.dead_id and coalesce(num_impressions, 0) = 0 and metrics_updated_at is null)
       or not exists (select 1 from public.own_posts where id = p.live_id and coalesce(num_impressions, 0) > 0 and metrics_updated_at is not null) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'changed since the read')); continue;
    end if;
    -- the archived row is the row as it is under the lock (sol r2 #3)
    select nullif(btrim(coalesce(x.clickup_task_id, '')), ''), to_jsonb(x) into v_task, v_row from public.own_posts x where x.id = p.dead_id;
    select nullif(btrim(coalesce(clickup_task_id, '')), '') into v_live_task from public.own_posts where id = p.live_id;
    if v_task is not null and v_live_task is not null and v_live_task <> v_task then
      skipped := skipped || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'why', 'live twin links another draft'));
      continue;
    end if;
    v_moved := v_task is not null and v_live_task is null;
    select source_post_id into v_spid from public.carousel_drafts where v_task is not null and id::text = v_task;
    if p_apply then
      if v_moved then update public.own_posts set clickup_task_id = v_task where id = p.live_id and nullif(btrim(coalesce(clickup_task_id, '')), '') is null; end if;
      if v_task is not null then
        update public.carousel_drafts set source_post_id = p.live_urn where id::text = v_task and source_post_id is not distinct from p.dead_urn;
      end if;
      update public.video_ideas set source_post_id = p.live_id where source_post_id = p.dead_id;
      insert into public.own_post_relinks (dead_id, dead_social_id, live_id, live_social_id, draft_id, moved_task_id, draft_source_post_before, dead_row)
      values (p.dead_id, p.dead_urn, p.live_id, p.live_urn, v_task, v_moved, v_spid, v_row);
      delete from public.own_posts where id = p.dead_id and coalesce(num_impressions, 0) = 0 and metrics_updated_at is null;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('dead', p.dead_urn, 'live', p.live_urn, 'draft', v_task, 'moved_task', v_moved, 'draft_pointed_at_dead', v_spid is not distinct from p.dead_urn and v_task is not null));
  end loop;
  return jsonb_build_object('applied', p_apply, 'relinked', out, 'skipped', skipped);
end $$;

commit;
