-- Ivan 2026-11-26: when a prospect opens the report we sent, the thread shows "Opened the report" at that time.
-- Display only: this function is read by the inbox thread timeline and by nothing that drafts, rings or sends.
-- One row per prospect, report and Warsaw day (the timeline's day line), at the first real open of that day.
-- A real open is public.open_is_signal (a person, eligible), after we first sent that link, so scanners, link
-- previews, our own tools and pre-send checks never show. Lanes: SwishDM comparison reports (page token -> one
-- prospect) and the Ivan, RISE and ARCH scan/audit pages (the slug in the link we sent, only when that link went to
-- exactly one person). City/country comes from page_opens and is null for scan pages, which do not record it.
-- New function, nothing existing changes. Rollback: db/20261126b_inbox_report_opens_rollback.sql.
begin;
set local lock_timeout = '3s';
create or replace function public.inbox_report_opens()
returns table(prospect_id uuid, report text, at timestamptz, place text)
language sql stable security definer set search_path = public, pg_temp as $$
with sw as (
  -- SwishDM comparison report: the page token belongs to one prospect.
  select cp.prospect_id, 'swishdm/compare/' || cp.token as report, o.created_at as at,
         nullif(concat_ws(', ', nullif(o.city, ''), nullif(o.country, '')), '') as place
    from public.page_opens o
    join public.swishdm_comparison_pages cp on o.page = 'swishdm/compare/' || cp.token
   where o.page ~ '^swishdm/compare/[a-z2-7]{20}$' and cp.prospect_id is not null
     and public.open_is_signal(o.open_class, o.eligible)
     and o.created_at > (select min(m.sent_at) from public.outreach_messages m
                          where m.prospect_id = cp.prospect_id and m.direction = 'outbound'
                            and m.sent_at is not null and m.sent_at <= now()
                            and position(cp.token in coalesce(m.message_text, '')) > 0)
),
links as (
  -- Ivan / RISE scans and ARCH audits: the slug in the link we sent (scans.prospect_token is null on outreach scans).
  select coalesce(lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')),
                  'arch-' || lower(substring(m.message_text from 'madebyarch\.com/([A-Za-z0-9_-]+-audit)'))) as slug,
         m.prospect_id, m.sent_at
    from public.outreach_messages m
   where m.direction = 'outbound' and m.sent_at is not null and m.sent_at <= now() and m.prospect_id is not null
     and m.message_text ~ '(/scan/[A-Za-z0-9_-]+|madebyarch\.com/[A-Za-z0-9_-]+-audit)'
),
owned as (
  -- Only a link that went to exactly one person: an open of a shared link cannot be pinned on anyone.
  select slug, min(prospect_id::text)::uuid as prospect_id, min(sent_at) as sent_at
    from links where slug is not null group by slug having count(distinct prospect_id) = 1
),
sc as (
  select w.prospect_id, 'scan/' || w.slug as report, so.opened_at as at, null::text as place
    from public.scan_opens so join owned w on lower(so.company_slug) = w.slug
   where public.open_is_signal(so.open_class, so.eligible) and so.opened_at > w.sent_at
)
select distinct on (prospect_id, report, (at at time zone 'Europe/Warsaw')::date) prospect_id, report, at, place
  from (select * from sw union all select * from sc) x
 order by prospect_id, report, (at at time zone 'Europe/Warsaw')::date, at
$$;
revoke all on function public.inbox_report_opens() from public, anon;
grant execute on function public.inbox_report_opens() to authenticated, service_role;
commit;
