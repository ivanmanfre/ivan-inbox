-- Real-corpus replay for the open classifier (plan 2026-11-17-open-tracking-truth, Task 3 Step 5). READ-ONLY.
-- Run after 303 + 304 are applied (live, or on a local copy of the live rows). Every row must say pass = true.
-- Expected values are frozen in ~/.claude/docs/superpowers/plans/2026-11-17-open-tracking-truth-assets/replay_expectations.r3.json
-- (round 3, rulings P1-P9; round 2 values in replay_expectations.r2.json, round 1 in replay_expectations.json)
-- (scan_opens id <= 3760, read 2026-11-17). Opens after that id are ignored so the numbers stay comparable.
with
cut as (select max(opened_at) as at from public.scan_opens where id <= 3760),
so as (select * from public.scan_opens where id <= 3760),

-- 1. class counts since 1 October (tolerance 3 rows each)
cc as (
  select e.k, e.n as expected, (select count(*) from so where so.opened_at >= timestamptz '2026-10-01T00:00:00Z' and so.open_class = e.k) as actual
    from (values ('owner', 734), ('own_tool', 440), ('link_scanner', 493), ('human', 328), ('suspect', 4)) e(k, n)),

-- 2. the nine Microsoft scanner hashes never feed a signal, and every row on them is the confirmed scanner except the
-- addresses that never opened 3 different scans after a send (ruling P2: one recipient is never 3 prospects): 4 rows
-- on 2 addresses (one row 20 s after an email send, three rows of one scan), all suspect, never eligible.
sh as (
  select count(*) filter (where public.open_is_signal(so.open_class, so.eligible)) as actual,
         count(*) filter (where so.open_class <> 'link_scanner') as not_scanner,
         count(*) filter (where so.open_class = 'suspect') as suspect
    from so
   where so.ip_hash in (
     '17016c70a8d4539e7a6e8b061e65888b337352d5883b36eefdd0b8a6778d8f98',
     '473bc2408fdedb55c729177c782d1f34a931979e2ebfff586d7c6adf2d0003c0',
     '82366861b54c9b8232a54ede5e6b5edc47d647c6bfca1efd703f1b6fa2f705a3',
     '98900a762c7db641819016d6b427a49048f2ff6b19ffc737f43ab869d4f0372a',
     '9dfa4dd746c4ab5edac9e1d2c5269e4118810acec514b40ed1447c4bdf65b23e',
     'd21daa2730a2a9e0bcd964a53620088d87c691a4d6a5300dd2224d3db390541d',
     'd818fa3e301dff5a713525b29c3ca4074b15bb5bf76ef2b0e99063b53cd54e9c',
     'df189e941980a4ca5a5716db66a11ef52bc0e5f1343587c9ea58e13b97a3e694',
     'fdd40003d9cb8d5e90de0cee4bb0cab6f45bad614181204825e2c0d40105c7b5')),

-- link messages to Ivan / RISE scans (one row per message), lane from the host and the campaign
links as (
  select m.prospect_id, m.sent_at,
         lower(substring(m.message_text from '(?:inboundonsteroids\.com|resources\.risedtc\.com)/scan/([A-Za-z0-9_-]+)')) as slug,
         case when m.message_text ~ 'resources\.risedtc\.com/scan/' then 'rise'
              when c.client_id = 'anna' then 'anna' else 'ivan' end as lane
    from public.outreach_messages m
    join public.outreach_prospects p on p.id = m.prospect_id
    left join public.outreach_campaigns c on c.id = p.campaign_id
   where m.direction = 'outbound' and m.sent_at is not null and m.sent_at <= (select at from cut)
     and m.message_text ~ '(inboundonsteroids\.com|resources\.risedtc\.com)/scan/[A-Za-z0-9_-]+'),
perp as (
  select l.prospect_id, min(l.sent_at) as first_at,
         (array_agg(l.lane order by l.sent_at))[1] as lane,
         array_agg(distinct l.slug) as slugs
    from links l group by 1),
ph as (
  select p.prospect_id, p.lane, p.first_at,
         count(so.id) as human_opens,
         count(so.id) filter (where so.eligible) as eligible_opens,
         count(distinct so.opened_at::date) as human_days
    from perp p
    left join so on lower(so.company_slug) = any (p.slugs) and so.opened_at > p.first_at and so.open_class = 'human'
   group by 1, 2, 3),

-- 3. people who booked keep their human opens (at least the listed number), and at least one of them is eligible
--    (round 3, ruling P6). Names stay out of this public repo; the id -> name list is in replay_expectations.r3.json.
bk as (
  select e.name, e.n as expected, coalesce(ph.human_opens, 0) as actual, coalesce(ph.eligible_opens, 0) as eligible
    from (values
      ('30ae409e-6b83-4052-a1d1-8deeb8695633'::uuid, 'booker_01', 3),
      ('10a9f0ce-2ced-460a-9242-0ec8f0a1296d'::uuid, 'booker_02', 5),
      ('45880bd2-3daa-419a-bd96-a6b2cfb81085'::uuid, 'booker_03', 2),
      ('902ad2e4-99fd-4318-a9b2-685a633e151d'::uuid, 'booker_04', 8),
      ('5fbc18cc-2795-4fe9-9d8e-fafb11b22574'::uuid, 'booker_05', 2),
      ('0298f171-64c1-49e2-8ba9-4e87a3cda687'::uuid, 'booker_06', 2),
      ('fcb36c18-f943-4821-88f0-a8013f7a3a5d'::uuid, 'booker_07', 8),
      ('d3b8ff5e-e7e7-40df-ac32-8e95f88d12e9'::uuid, 'booker_08', 1),
      ('0bc5e72d-61e1-4d4c-a97b-cc22c5d61f52'::uuid, 'booker_09', 4),
      ('6c5d1adb-f67d-4acd-a658-d8de21e5aef1'::uuid, 'booker_10', 6)) e(pid, name, n)
    left join ph on ph.prospect_id = e.pid),

-- 4. lanes: links sent since 1 October with a human open after the send (tolerance 2)
ln as (
  select e.lane, e.metric, e.n as expected,
         (select count(*) from ph where ph.lane = e.lane and ph.first_at >= timestamptz '2026-10-01T00:00:00Z' and case e.metric
            when 'links' then true
            when 'human_opened' then ph.human_opens > 0
            when 'two_plus_days' then ph.human_days >= 2
            when 'three_plus_days' then ph.human_days >= 3 end) as actual
    from (values ('ivan', 'links', 82), ('ivan', 'human_opened', 60), ('ivan', 'two_plus_days', 21), ('ivan', 'three_plus_days', 11),
                 ('rise', 'links', 86), ('rise', 'human_opened', 65), ('rise', 'two_plus_days', 14), ('rise', 'three_plus_days', 6)) e(lane, metric, n)),

-- 5. the Railway builder never counts as a person
rw as (select count(*) as actual from so where so.ip_hash = '436790ed5db5de75667c9c8876dfdae56d63ea8e63501f68d1956304c14607ac' and so.open_class = 'human'),

-- 6. SwishDM report pages
sw as (
  select count(*) filter (where open_class = 'link_scanner') as scanner,
         count(*) filter (where open_class = 'suspect' and class_reason = 'microsoft_after_send') as ms_after_send,
         count(*) filter (where open_class = 'owner') as owner,
         count(*) filter (where open_class = 'human' and org ilike 'mullvad%' and city = 'London') as mullvad_human,
         count(*) filter (where open_class = 'suspect' and class_reason = 'burst_no_address') as burst_no_address,
         count(*) filter (where open_class = 'suspect' and class_reason = 'microsoft_uncorroborated') as ms_uncorroborated,
         count(*) filter (where public.open_is_signal(open_class, eligible) and org ~* 'microsoft') as ms_signal
    from public.page_opens where page like 'swishdm/compare/%' and id <= (select max(id) from public.page_opens where created_at <= (select at from cut)))

select 'class_counts:' || k as check_name, expected::text, actual::text, abs(actual - expected) <= 3 as pass from cc
union all select 'scanner_hashes_no_signal', '0', actual::text, actual = 0 from sh
union all select 'scanner_hashes_not_confirmed_all_suspect', '4', not_scanner::text || '/' || suspect::text, not_scanner = 4 and suspect = 4 from sh
union all select 'bookers_stay_human_and_eligible:' || name, '>=' || expected || ' human, >=1 eligible', actual::text || ' human, ' || eligible::text || ' eligible', actual >= expected and eligible >= 1 from bk
union all select 'lanes:' || lane || ':' || metric, expected::text, actual::text, abs(actual - expected) <= 2 from ln
union all select 'railway_arch', '0', actual::text, actual = 0 from rw
-- round 3: page rows carry no address, so no checker address can be confirmed on them (P2): the after-send Microsoft
-- rows are suspect, kept and counted apart, never eligible. No Microsoft page row feeds anything.
union all select 'swishdm_pages:link_scanner', '0', scanner::text, scanner = 0 from sw
union all select 'swishdm_pages:microsoft_after_send', '37', ms_after_send::text, abs(ms_after_send - 37) <= 3 from sw
union all select 'swishdm_pages:microsoft_uncorroborated', '13', ms_uncorroborated::text, abs(ms_uncorroborated - 13) <= 3 from sw
union all select 'swishdm_pages:microsoft_never_a_signal', '0', ms_signal::text, ms_signal = 0 from sw
union all select 'swishdm_pages:owner', '12', owner::text, abs(owner - 12) <= 3 from sw
-- the VPN user who opened 3 reports inside a minute on 11-11 (no address): 3 rows inside 10 minutes with one browser
-- string are burst_no_address (P3); the fourth came later than 10 minutes after the others and stays a person
union all select 'swishdm_pages:mullvad_london_burst_no_address', '3', burst_no_address::text, burst_no_address = 3 from sw
union all select 'swishdm_pages:mullvad_london_human', '1', mullvad_human::text, mullvad_human = 1 from sw;
