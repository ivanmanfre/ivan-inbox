-- Rollback for 252_content_plan.sql. Drops only what 252 created. Run 253 rollback first if 253 was applied.
drop function if exists public.content_plan_monday_lines(timestamptz);
drop function if exists public.content_plan_mark(uuid, text, text);
drop function if exists public.content_plan_log_run(text, jsonb);
drop function if exists public.content_plan_apply(text, date, jsonb, jsonb);
drop function if exists public.content_plan_week(text, timestamptz);
drop function if exists public.content_plan_idea_evidence(text, text);
drop function if exists public.content_plan_post_evidence(uuid);
drop function if exists public.content_plan_service_ok();
drop table if exists public.content_plan_runs;
drop table if exists public.content_plan_slots;
drop table if exists public.content_plan_config;
