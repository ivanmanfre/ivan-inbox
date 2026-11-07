-- Rollback for 20261107_take_screenshot_lane.sql.
-- Fast off switch without a rollback: update integration_config set value = jsonb_set(value::jsonb, '{enabled}', 'false')::text where key = 'ivan_take_lane';
-- Drafts the lane already made stay as normal Review drafts (taxonomy.source = 'take_screenshot'); delete them by hand only if Ivan asks.
begin;
drop function if exists public.ivan_take_candidates_v1(text[], int, int, int);
update public.content_prompts set is_active = false
  where slug in ('ivan-take-screenshot-judge', 'ivan-take-screenshot-format');
delete from public.integration_config where key in ('ivan_take_lane', 'ivan_take_lane_seen');
commit;
