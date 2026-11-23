-- Execute each statement outside a transaction to keep queue and contact writes available.
create index concurrently if not exists anna_queue_peer_email_idx on public.outreach_prospects(lower(email));
create index concurrently if not exists anna_queue_company_idx on public.outreach_prospects(lower(trim(company)));
create index concurrently if not exists anna_queue_domain_idx on public.outreach_prospects(lower(trim(company_domain)));
create index concurrently if not exists anna_queue_contact_name_idx on public.contacts(lower(trim(name))) where merged_into is null;
create index concurrently if not exists anna_queue_contact_company_idx on public.contacts(lower(trim(company))) where merged_into is null;
create index concurrently if not exists anna_queue_contact_member_idx on public.contacts(linkedin_member_id) where merged_into is null;
