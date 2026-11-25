-- Re-read the exact obligation and conversation together before preparing a private draft.
begin;
create or replace function public.assistant_rise_scan_draft_current(p_inbound_id uuid, p_as_of timestamptz default now())
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select to_jsonb(e) from public.assistant_rise_scan_email(p_as_of) e
  where e.inbound_id = p_inbound_id and e.disposition is null and e.address_count = 1
    and e.sender is not null and e.report_url is not null and e.email_at is null
    and not exists (
      select 1 from public.outreach_messages m
      where m.prospect_id = e.prospect_id and m.id <> e.inbound_id
        and coalesce(m.sent_at, m.created_at) between e.asked_at and p_as_of
        -- Same quiet-thread rule as assistant_scan_watch_record. Tied event times
        -- are ambiguous, so another inbound or unsent outbound at that instant also holds the draft.
        and (m.direction = 'inbound' or (m.direction = 'outbound' and m.sent_at is null))
    );
$$;
revoke all on function public.assistant_rise_scan_draft_current(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.assistant_rise_scan_draft_current(uuid,timestamptz) to service_role;
commit;
