-- Rollback for db/105_editorial_brief_contract.sql.
--
-- WHAT THIS FILE IS ALLOWED TO TOUCH. Only the objects db/105 created, enumerated explicitly
-- below and in exactly that order. It contains no TRUNCATE and no row removal statement of any
-- kind, and it names no table, view, function or policy that existed before 105. In particular
-- it never touches client_registry, client_research_*, lm_idea_candidates, client_ideas,
-- carousel_drafts, ops_drafts, scheduled_posts, integration_config or any other shared
-- historical object.
--
-- The tables 105 created hold ONLY editorial-contract rows written after 105 was applied, so
-- dropping them removes no historical record from any other surface. If those rows matter, take
-- a copy BEFORE running this file: this is a structural rollback, not an undo.
--
-- Order: triggers, then functions the triggers use, then RPCs, then child tables, then parents.
-- Every statement is IF EXISTS, so a partial application rolls back cleanly and a second run is
-- a no-op.

-- ---------------------------------------------------------------------------
-- 1. Triggers created by 105 (nine of them, on nine tables it created)
-- ---------------------------------------------------------------------------

drop trigger if exists editorial_sources_immutable            on public.editorial_sources;
drop trigger if exists editorial_brief_versions_immutable     on public.editorial_brief_versions;
drop trigger if exists editorial_brief_sources_immutable      on public.editorial_brief_sources;
drop trigger if exists editorial_decisions_immutable          on public.editorial_decisions;
drop trigger if exists editorial_brief_artifacts_immutable    on public.editorial_brief_artifacts;
drop trigger if exists editorial_input_manifests_immutable    on public.editorial_input_manifests;
drop trigger if exists editorial_outcome_snapshots_immutable  on public.editorial_outcome_snapshots;
drop trigger if exists editorial_batches_identity_immutable   on public.editorial_batches;
drop trigger if exists editorial_current_batch_guard          on public.editorial_current_batch;

-- ---------------------------------------------------------------------------
-- 2. Functions created by 105 (three guards, one internal reader, seven RPCs)
-- ---------------------------------------------------------------------------

drop function if exists public.editorial_promote_batch(text, text, text);
drop function if exists public.editorial_link_artifact(text, text, text, integer, text, text, text);
drop function if exists public.editorial_set_source_curation(text, text, text, text, text);
drop function if exists public.editorial_read_brief_outcomes(text, text, text);
drop function if exists public.editorial_record_decision(text, text, text, text, integer, integer, text, text, text, text);
drop function if exists public.editorial_read_brief(text, text, text, integer);
drop function if exists public.editorial_read_briefs(text, text, text, text, integer);
drop function if exists public.editorial_read_research(text, text, jsonb, text, integer);
drop function if exists public.editorial_brief_json(text, text, integer);
drop function if exists public.editorial_guard(text, text);
drop function if exists public.editorial_current_batch_promotable();
drop function if exists public.editorial_batch_identity_guard();
drop function if exists public.editorial_immutable_guard();

-- ---------------------------------------------------------------------------
-- 3. Indexes created by 105. Index drops are listed for completeness; the
--    table drops below would remove them anyway, and both orders are safe.
-- ---------------------------------------------------------------------------

drop index if exists public.editorial_refresh_active_one_per_client;
drop index if exists public.editorial_outcome_snapshots_brief_idx;
drop index if exists public.editorial_decisions_cutoff_idx;
drop index if exists public.editorial_decisions_target_idx;
drop index if exists public.editorial_brief_sources_source_idx;
drop index if exists public.editorial_brief_versions_head_idx;
drop index if exists public.editorial_brief_versions_batch_idx;
drop index if exists public.editorial_batches_status_idx;
drop index if exists public.editorial_source_curation_state_idx;
drop index if exists public.editorial_sources_client_published_idx;
drop index if exists public.editorial_sources_client_kind_idx;

-- ---------------------------------------------------------------------------
-- 4. Tables created by 105, children before parents
-- ---------------------------------------------------------------------------

drop table if exists public.editorial_outcome_snapshots;
drop table if exists public.editorial_refresh_requests;
drop table if exists public.editorial_current_batch;
drop table if exists public.editorial_brief_artifacts;
drop table if exists public.editorial_decisions;
drop table if exists public.editorial_brief_sources;
drop table if exists public.editorial_brief_versions;
drop table if exists public.editorial_batches;
drop table if exists public.editorial_input_manifests;
drop table if exists public.editorial_source_curation;
drop table if exists public.editorial_sources;
