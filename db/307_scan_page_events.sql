-- 307 open tracking truth, part 5: section views, booking clicks, and tying a booking to the page. Plan Task 8.
-- Written by the scan-open edge function (service role) for an open younger than 6 hours. Events carry no class of
-- their own: readers join scan_opens.open_class = 'human'. Nothing here sends, drafts or rings.

create table if not exists public.scan_page_events (
  id bigserial primary key,
  open_id bigint not null references public.scan_opens(id) on delete cascade,
  company_slug text not null,
  kind text not null check (kind in ('section_view', 'cta_click')),
  name text not null,
  at timestamptz not null default now(),
  unique (open_id, kind, name)
);
create index if not exists scan_page_events_slug_at_idx on public.scan_page_events (lower(company_slug), at);
alter table public.scan_page_events enable row level security;
revoke all on public.scan_page_events from anon, authenticated;
grant all on public.scan_page_events to service_role;
grant usage, select on sequence public.scan_page_events_id_seq to service_role;

-- One row per booking we can tie to a prospect. last_click_* = the newest booking click on a human open of that
-- prospect's scan in the 60 minutes before the booking (null when none). deepest_section = the last section that
-- person had in view before booking (section order is the page's, so "last seen" is the read-depth stand-in).
create or replace view public.scan_booking_page_link as
  with b as (
    select ba.meeting_id, ba.prospect_id, ba.booked_at,
           coalesce(lower(ba.slug), (
             select lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)'))
               from public.outreach_messages m
              where m.prospect_id = ba.prospect_id and m.direction = 'outbound' and m.sent_at is not null
                and m.message_text ~ '/scan/[A-Za-z0-9_-]+'
              order by m.sent_at desc limit 1)) as slug
      from public.booking_attributions ba
     where ba.prospect_id is not null)
  select b.meeting_id, b.prospect_id, b.slug, b.booked_at,
         c.at as last_click_at, c.name as last_click_name, s.name as deepest_section
    from b
    left join lateral (
      select e.at, e.name from public.scan_page_events e
        join public.scan_opens o on o.id = e.open_id and o.open_class = 'human'
       where lower(e.company_slug) = b.slug and e.kind = 'cta_click'
         and e.at <= b.booked_at and e.at > b.booked_at - interval '60 minutes'
       order by e.at desc limit 1) c on true
    left join lateral (
      select e.name from public.scan_page_events e
        join public.scan_opens o on o.id = e.open_id and o.open_class = 'human'
       where lower(e.company_slug) = b.slug and e.kind = 'section_view' and e.at <= b.booked_at
       order by e.at desc limit 1) s on true;
revoke all on public.scan_booking_page_link from anon, authenticated;
grant select on public.scan_booking_page_link to service_role;
