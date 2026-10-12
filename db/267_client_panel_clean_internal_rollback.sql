-- Rollback for db/267. Unschedules the hourly job, drops the cleaner and restores the old values
-- of the keys it changed (captured 2026-10-13 before apply; full backup in
-- ~/.local/state/offfix/build/phase3/client-boards-before.json).
do $c$
begin
  if exists (select 1 from cron.job where jobname = 'client-board-clean-internal') then
    perform cron.unschedule('client-board-clean-internal');
  end if;
end
$c$;

drop function if exists public.client_board_clean_internal();

select public.client_board_apply_ops('risedtc-com', $ops$[
  {"op":"set","path":["week_plan","text"],"value":"Week of Oct 12.\nThe mix is balanced across new audience, trust, and proof this week.\n5 posts planned: 1 Reach, 3 Trust, 1 Buyers.\nShape: 1 founder-story post.\nStory bank: 2 eligible / 0 in cooldown / 0 pending consent.\nLast week impressions: 2685 across 7 posts."},
  {"op":"set","path":["engine_updates"],"value":[
    {"date":"2026-07-17","note":"Your LinkedIn connect link tested end to end and confirmed working"},
    {"date":"2026-07-17","note":"First-week drafts generated in your voice, now live on your board"},
    {"date":"2026-07-17","note":"Outreach built and ready. First sends wait only on your approval."}]}
]$ops$::jsonb);

select public.client_board_apply_ops('arch-agency', $ops$[
  {"op":"set","path":["engine_updates"],"value":[
    {"date":"2026-08-13","note":"18 post topics banked: your 4 week-one stances plus 14 harvested from Reddit UA threads, X and competitor feeds, all scored against your buyer"},
    {"date":"2026-08-13","note":"Prospect list upgraded to 36 named decision makers, tiered, with the screening gates now written on the Outreach tab"}]}
]$ops$::jsonb);
