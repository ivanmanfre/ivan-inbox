-- Rollback for 20261118a. Drops every stored review.
alter table public.transcripts drop column if exists call_review;
