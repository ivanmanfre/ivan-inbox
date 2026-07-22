-- Unified inbox view. security_invoker so RLS of the caller applies.
create or replace view inbox_messages_v with (security_invoker = on) as
select
  m.id, m.prospect_id, m.direction, m.message_text, m.message_type,
  coalesce(m.channel, 'linkedin') as channel,
  m.sent_at, m.approved_at, m.read_at, m.created_at,
  m.send_blocked_at, m.send_blocked_reason, m.unipile_chat_id,
  p.name as prospect_name, p.company as prospect_company,
  p.headline as prospect_headline, p.stage as prospect_stage,
  p.email as prospect_email, p.profile_photo_url,
  c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id
from outreach_messages m
join outreach_prospects p on p.id = m.prospect_id
join outreach_campaigns c on c.id = p.campaign_id;

-- push_subscriptions PRE-EXISTS (shared with the personal-site dashboard push
-- system: endpoint unique, p256dh, auth, user_agent, device_label). Kept here
-- as a documented dependency only; no policy churn on the shared table.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'outreach_messages'
  ) then
    alter publication supabase_realtime add table outreach_messages;
  end if;
end $$;
