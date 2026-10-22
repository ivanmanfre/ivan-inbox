begin;
drop function if exists public.operator_delete_ops_note(text,uuid);
drop function if exists public.operator_save_ops_note(text,uuid,text);
drop function if exists public.operator_ops_notes(text);
drop table if exists public.ops_notes;
commit;
