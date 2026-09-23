-- Disable new reservations without erasing the immutable reservation ledger.
-- Keep the functions as schema history so an already-recorded deployment can be
-- inspected and, if approved later, restored by granting EXECUTE again.
revoke execute on function public.editorial_reserve_provider_call(text,text,text,integer,text,text,integer,text,text,text,text) from service_role;
revoke execute on function public.editorial_begin_provider_job(text,text,text,integer,text,text,integer,text,text) from service_role;
