-- Rollback 303. Roll back 305..309 first, or readers will reference dropped columns.
-- The scan-open edge function must already be reverted (it writes the `view` column): see RELEASE-CHECKLIST rollback order.
drop function if exists public.page_open_classify(boolean, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
drop function if exists public.scan_open_classify(boolean, text, text, text, int, text, boolean, boolean, boolean, boolean, boolean, boolean);
drop function if exists public.open_is_signal(text, boolean);
drop function if exists public.open_may_ring(text, boolean, boolean);
drop function if exists public.open_from_linkedin(text, text);
drop function if exists public.open_is_microsoft(int, text);
drop index if exists public.page_opens_ip_hash_created_idx;
drop index if exists public.scan_opens_human_slug_opened_idx;
drop index if exists public.scan_opens_ip_hash_opened_idx;
alter table public.page_opens drop column if exists eligible, drop column if exists near_send, drop column if exists classified_at, drop column if exists class_reason, drop column if exists open_class,
  drop column if exists ip_hash;
alter table public.scan_opens drop column if exists eligible, drop column if exists near_send, drop column if exists classified_at, drop column if exists class_reason, drop column if exists open_class,
  drop column if exists view, drop column if exists net_org, drop column if exists net_asn;
drop table if exists public.open_networks;
drop table if exists public.open_known_networks;
