-- Bind each email leg and envelope to the same atomic inbox approval.
-- Drop the four-argument signature so PostgREST cannot resolve an unguarded overload.
DROP FUNCTION IF EXISTS public.approve_inbox_pipeline_draft(uuid,text,jsonb,text);
CREATE OR REPLACE FUNCTION public.approve_inbox_pipeline_draft(
  p_message_id uuid, p_text text, p_expected_evidence jsonb, p_chat_id text DEFAULT NULL::text,
  p_expected_email_mirror_text text DEFAULT NULL::text,
  p_expected_recipient_email text DEFAULT NULL::text,
  p_expected_email_subject text DEFAULT NULL::text,
  p_expected_email_cc jsonb DEFAULT NULL::jsonb
)
 RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  approved_time timestamptz := now();
  touched integer;
begin
  update public.outreach_messages m set
    message_text=p_text, approved_at=approved_time,
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb) || jsonb_build_object(
      'operator_copy_approval', jsonb_build_object('source','inbox','text',p_text,'approved_at',approved_time,
        'email_mirror_text',coalesce(m.email_mirror_text,''),
        'recipient_email',coalesce(m.recipient_email,''),
        'email_subject',coalesce(m.draft_evidence->>'email_subject',''),
        'email_cc',coalesce(m.draft_evidence->'email_cc','[]'::jsonb))),
    send_blocked_reason=null, send_blocked_at=null,
    unipile_chat_id=coalesce(nullif(p_chat_id,''),m.unipile_chat_id)
  where m.id=p_message_id
    and m.direction='outbound'
    and m.ai_model is distinct from 'inbox_on_demand_reply'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and m.email_mirror_text is not distinct from p_expected_email_mirror_text
    and m.recipient_email is not distinct from p_expected_recipient_email
    and coalesce(m.draft_evidence->>'email_subject','')=coalesce(p_expected_email_subject,'')
    and coalesce(m.draft_evidence->'email_cc','[]'::jsonb)=coalesce(p_expected_email_cc,'[]'::jsonb)
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_'));
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft changed before approval. Refresh before sending.'; end if;
end;
$function$
;
revoke all on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text,text,text,text,jsonb) from public, anon;
grant execute on function public.approve_inbox_pipeline_draft(uuid,text,jsonb,text,text,text,text,jsonb) to authenticated, service_role;
NOTIFY pgrst, 'reload schema';
