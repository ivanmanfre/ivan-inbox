-- Keep research evidence out of URL filters when saving email recipients.
create or replace function public.save_inbox_draft_email_cc(
  p_message_id uuid, p_cc jsonb, p_expected_evidence jsonb
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $function$
declare
  touched integer;
begin
  if p_cc is null or jsonb_typeof(p_cc) <> 'array' then
    raise exception 'Enter valid CC email addresses.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cc) e
    where jsonb_typeof(e) <> 'string'
      or (e #>> '{}') !~ $email$^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$$email$
  ) then raise exception 'Enter valid CC email addresses.'; end if;

  update public.outreach_messages m set
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb) || jsonb_build_object('email_cc',p_cc)
  where m.id=p_message_id and m.direction='outbound'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_'));
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft changed. Refresh before approving.'; end if;
end;
$function$;
revoke all on function public.save_inbox_draft_email_cc(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_inbox_draft_email_cc(uuid,jsonb,jsonb) to authenticated, service_role;
