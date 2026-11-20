-- Release step 1b, once, after open_backfill_step reported done: true. A second call returns already_ran.
-- Not a migration: db/304_open_finalize_backfill.sql must be applied first.
select public.open_release_grant();
