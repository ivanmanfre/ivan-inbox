-- Reversible with no data loss: the function writes only columns db/107 already
-- owns. Dropping it leaves every persisted draft row and dispatch row in place.
drop function if exists public.editorial_complete_native_draft(text,text,text,text,text,text,text,jsonb);
