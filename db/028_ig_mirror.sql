-- 028: Instagram mirror state on carousel_drafts (2026-08-05)
--
-- The mirror is event-driven off the LinkedIn publish, so it needs exactly one
-- new fact per row: has this already gone to Instagram. Everything else it needs
-- (scheduled_at, published_at, post_body, image_urls, pdf_url, video_url) already
-- exists, which is the point: there is no second schedule to drift.

alter table carousel_drafts add column if not exists ig_published_at timestamptz;
alter table carousel_drafts add column if not exists ig_post_url text;
-- Last failure, human-readable. Cleared on success. A row with ig_error set and
-- ig_published_at null is the queue's dead-letter.
alter table carousel_drafts add column if not exists ig_error text;
-- Bounded retries. Instagram's transient failures (2207003/2207052/2207032/2207020)
-- clear on a retry; its permanent ones never will, and an unbounded retry loop on a
-- publish endpoint is how a client feed gets the same post six times.
alter table carousel_drafts add column if not exists ig_attempts integer not null default 0;

-- The mirror's only query.
create index if not exists carousel_drafts_ig_pending_idx
  on carousel_drafts (published_at desc)
  where ig_published_at is null and published_at is not null;
