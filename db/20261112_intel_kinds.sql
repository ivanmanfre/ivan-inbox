-- Intel feed: sources beyond YouTube (Ivan 11-11: Kyle calls, niche GitHub, practitioner blogs, Reddit if a probe passes).
-- intel_sources.kind accepts the new kinds; intel_items gets its own kind (old rows are all videos) and a small
-- meta object (stars, comment count, article length) the card shows as a chip.
-- Readers checked with who-reads on 11-11: ~/.claude/intel-feed/run.py and ivan-inbox src/d/intel only. No view or
-- function depends on either table.
--
-- Live constraints before this file (pg_constraint, 2026-11-11):
--   intel_sources_kind_check     CHECK (kind = ANY (ARRAY['youtube','podcast']))
--   intel_sources_added_by_check CHECK (added_by = ANY (ARRAY['ivan','discovery']))          unchanged
--   intel_sources_status_check   CHECK (status = ANY (ARRAY['core','trial','muted','dropped'])) unchanged
--   intel_items_found_via_check  CHECK (found_via = ANY (ARRAY['source','discovery']))       unchanged
--   intel_items_verdict_check    CHECK (verdict = ANY (ARRAY['keep','drop']))                unchanged
--   intel_items has no kind and no meta column.
begin;
set local lock_timeout = '3s';

alter table public.intel_sources drop constraint intel_sources_kind_check;
alter table public.intel_sources add constraint intel_sources_kind_check
  check (kind in ('youtube', 'podcast', 'github', 'reddit', 'blog', 'kyle'));

alter table public.intel_items add column kind text not null default 'youtube';
alter table public.intel_items add constraint intel_items_kind_check
  check (kind in ('youtube', 'podcast', 'github', 'reddit', 'blog', 'kyle'));
alter table public.intel_items add column meta jsonb;

commit;
