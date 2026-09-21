-- Reversible only after verifying no Run 3 internal drafts depend on the link.
drop function if exists public.editorial_begin_native_draft(text,text,text,text,integer,text,text,text,text,text);
drop table if exists public.editorial_native_draft_dispatches;
drop index if exists public.lm_drafts_v2_editorial_artifact_uq;
alter table public.lm_drafts_v2 drop column if exists editorial_brief_artifact_id;
drop index if exists public.video_ideas_editorial_artifact_uq;
alter table public.video_ideas drop column if exists editorial_brief_artifact_id;
alter table public.video_ideas drop column if exists client_id;
alter table public.video_ideas drop column if exists editorial_qa;
drop index if exists public.carousel_drafts_editorial_artifact_uq;
alter table public.carousel_drafts drop column if exists editorial_brief_artifact_id;
