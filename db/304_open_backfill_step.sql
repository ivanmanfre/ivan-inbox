-- Release step 1b: one bounded backfill batch (own transaction). Run in a loop until the result says done: true.
-- Not a migration: db/304_open_finalize_backfill.sql must be applied first.
select public.open_backfill_step(500);
