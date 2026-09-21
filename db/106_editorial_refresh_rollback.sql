-- Run 2 rollback only. Stop editorial Edge traffic first. This removes Run 2
-- refresh, review and direction state; Run 1 schema 105 and its briefs remain.
-- Apply only after retaining an archive of any Run 2 immutable records.
begin;
drop function if exists public.editorial_commit_review(text,text,text,integer,text,text,text,text,text,jsonb,text);
drop function if exists public.editorial_linked_call_passages(text,text,text[]);
drop function if exists public.editorial_latest_source_versions(text,text,text[]);
drop function if exists public.editorial_release_bridge(text,text,text);
drop function if exists public.editorial_claim_bridge(text,text,text);
drop function if exists public.editorial_reserve_draft(text,text,text,integer,text,text,text);
drop function if exists public.editorial_finish_refresh(text,text,text,jsonb,text,text,jsonb,text);
drop function if exists public.editorial_read_refresh(text,text,text);
drop function if exists public.editorial_begin_refresh(text,text,text,text,jsonb);
drop function if exists public.editorial_adopt_direction(text,text,text,jsonb,text,text,text);
drop function if exists public.editorial_read_direction(text,text);
drop table if exists public.editorial_reviews;
drop table if exists public.editorial_bridge_leases;
drop table if exists public.editorial_collector_cursors;
drop table if exists public.editorial_synthesis_traces;
drop table if exists public.editorial_current_direction;
drop table if exists public.editorial_direction_versions;
alter table public.editorial_input_manifests drop column if exists synthesis_descriptor;
commit;
