-- Rollback for 20261118m_content_desk_r5.sql. desk_set_* are new (only content-desk calls them).
-- desk_patch_action_echo goes back to its r3 body (db/20261118m_content_desk_r3.sql).
drop function if exists public.desk_set_date(uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_set_photos(uuid, timestamptz, text, text);

create or replace function public.desk_patch_action_echo(p_message uuid, p_action text, p_patch jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.desk_messages m
     set meta = jsonb_set(m.meta, '{actions}', coalesce((
           select jsonb_agg(case when x->>'id' = p_action then x || p_patch else x end order by o)
             from jsonb_array_elements(coalesce(m.meta->'actions', '[]'::jsonb)) with ordinality t(x, o)), '[]'::jsonb)),
         updated_at = now()
   where m.id = p_message
  returning to_jsonb(m.*)
$$;
revoke all on function public.desk_patch_action_echo(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_patch_action_echo(uuid, text, jsonb) to service_role;
