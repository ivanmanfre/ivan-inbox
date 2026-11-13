-- Rollback for 302: the function is read-only and only the DM context sheet calls it.
drop function if exists public.prospect_store_numbers(uuid);
