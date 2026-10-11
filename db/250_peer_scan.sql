-- 250_peer_scan.sql: LinkedIn Peer Scan ($99 one-off), thread C 2026-10-11.
-- Order -> Stripe payment -> runner lane peer-scan builds the report -> Resend delivery -> 30-day re-scan.
-- All tables RLS on with no policies: only the service role (edge fns + runner) reads/writes.
-- Rollback: db/250_peer_scan_rollback.sql (drops everything below).

create table if not exists peer_scan_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null default 'purchase' check (kind in ('purchase','rescan','sample')),
  email text,
  linkedin_url text not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','running','delivered','failed','refunded','cancelled')),
  is_test boolean not null default false,          -- Stripe test mode or our own self-tests: excluded from every readout
  stripe_session_id text unique,
  stripe_payment_intent text,
  amount_cents int,
  currency text,
  livemode boolean,
  paid_at timestamptz,
  session_id text,
  utm jsonb not null default '{}'::jsonb,
  referrer text,
  token text unique,                                -- report link token (unguessable)
  stage text,                                       -- job stage on the runner
  stage_data jsonb not null default '{}'::jsonb,
  attempts int not null default 0,
  locked_at timestamptz,
  started_at timestamptz,
  delivered_at timestamptz,
  delivery_email_id text,
  rescan_of uuid references peer_scan_orders(id),
  rescan_due_at timestamptz,
  error text
);
create index if not exists peer_scan_orders_status_idx on peer_scan_orders(status, created_at);
create index if not exists peer_scan_orders_email_idx on peer_scan_orders(lower(email));
create index if not exists peer_scan_orders_rescan_idx on peer_scan_orders(rescan_due_at) where kind <> 'rescan';

create table if not exists peer_scan_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references peer_scan_orders(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  buyer_slug text,
  niche_key text,
  data jsonb not null,
  snapshot jsonb not null default '{}'::jsonb,      -- the buyer's headline numbers, for the 30-day before/after
  pdf_url text,
  views int not null default 0,
  last_viewed_at timestamptz
);
create index if not exists peer_scan_reports_order_idx on peer_scan_reports(order_id);

create table if not exists peer_scan_niches (
  key text primary key,
  label text not null,
  description text,
  search_queries jsonb not null default '[]'::jsonb,
  seed_client_id text,                              -- corpus niche it was seeded from (ivan / risedtc / arch)
  created_at timestamptz not null default now(),
  built_at timestamptz,
  buyers int not null default 0
);

create table if not exists peer_scan_creators (
  niche_key text not null references peer_scan_niches(key) on delete cascade,
  slug text not null,
  profile_url text,
  name text,
  headline text,
  followers int,
  followers_at timestamptz,
  posts_scraped_at timestamptz,
  source text,                                      -- corpus / post_search / buyer
  excluded text,                                    -- why it is not a peer (company page, inactive, ...)
  primary key (niche_key, slug)
);

create table if not exists peer_scan_posts (
  niche_key text not null,
  post_id text not null,
  author_slug text not null,
  posted_at timestamptz,
  kind text,                                        -- text / image / carousel / video / article / poll
  text text,
  likes int, comments int, reposts int,
  observed_at timestamptz not null default now(),
  url text,
  primary key (niche_key, post_id)
);
create index if not exists peer_scan_posts_author_idx on peer_scan_posts(niche_key, author_slug);

create table if not exists peer_scan_spend (
  id bigserial primary key,
  at timestamptz not null default now(),
  order_id uuid,
  niche_key text,
  actor text,
  run_id text,
  usd numeric
);

create table if not exists peer_scan_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  session_id text,
  step text not null,
  utm jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  order_id uuid
);
create index if not exists peer_scan_events_step_idx on peer_scan_events(step, at);

alter table peer_scan_orders enable row level security;
alter table peer_scan_reports enable row level security;
alter table peer_scan_niches enable row level security;
alter table peer_scan_creators enable row level security;
alter table peer_scan_posts enable row level security;
alter table peer_scan_spend enable row level security;
alter table peer_scan_events enable row level security;

-- Anonymous funnel tracking from the static pages. Whitelisted steps, 40 events per session.
create or replace function peer_scan_track(p_session text, p_step text, p_utm jsonb default '{}'::jsonb, p_meta jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_step not in ('view','start','submit','submit_error','checkout_redirect','thanks_view','resend_view','resend_submit','report_view','pdf_click','carousel_click','sample_view','cta_click') then
    return false;
  end if;
  if p_session is null or length(p_session) > 80 then return false; end if;
  if (select count(*) from peer_scan_events where session_id = p_session) >= 40 then return false; end if;
  insert into peer_scan_events(session_id, step, utm, meta)
  values (p_session, p_step, coalesce(p_utm, '{}'::jsonb),
          case when length(coalesce(p_meta, '{}'::jsonb)::text) > 2000 then '{}'::jsonb else coalesce(p_meta, '{}'::jsonb) end);
  return true;
end $$;
revoke all on function peer_scan_track(text, text, jsonb, jsonb) from public;
grant execute on function peer_scan_track(text, text, jsonb, jsonb) to anon, authenticated;

-- Runner dispatch (same pattern as x_article_dispatch).
create or replace function peer_scan_dispatch(p_mode text default 'tick', p_order uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare u text; k text; rid bigint;
begin
  select value into u from runner_secrets where key = 'runner_url';
  select value into k from runner_secrets where key = 'runner_key';
  if u is null or k is null then raise warning 'peer_scan_dispatch: runner_url/runner_key missing'; return null; end if;
  select net.http_post(url := u || '/lanes/peer-scan/run',
    body := jsonb_build_object('body', jsonb_build_object('mode', p_mode, 'order_id', p_order)),
    headers := jsonb_build_object('Content-Type','application/json','x-runner-key',k), timeout_milliseconds := 20000) into rid;
  return rid;
end $$;
revoke all on function peer_scan_dispatch(text, uuid) from public, anon, authenticated;

-- Measurement: one row per day (visits, starts, checkouts, purchases, revenue, data spend).
create or replace view peer_scan_daily_v as
with ev as (
  select (at at time zone 'UTC')::date d,
    count(distinct session_id) filter (where step = 'view') visits,
    count(distinct session_id) filter (where step = 'view' and utm->>'medium' = 'paid') paid_visits,
    count(distinct session_id) filter (where step = 'start') starts,
    count(distinct session_id) filter (where step = 'submit') submits,
    count(distinct session_id) filter (where step = 'checkout_redirect') checkouts
  from peer_scan_events
  where coalesce(utm->>'medium', '') not in ('localtest','livetest','selftest')
  group by 1),
od as (
  select (paid_at at time zone 'UTC')::date d, count(*) purchases, sum(amount_cents) / 100.0 revenue_usd,
    count(*) filter (where utm->>'medium' = 'paid') paid_purchases
  from peer_scan_orders where kind = 'purchase' and status in ('paid','running','delivered') and not is_test and paid_at is not null
  group by 1),
sp as (select (at at time zone 'UTC')::date d, sum(usd) data_usd from peer_scan_spend group by 1)
select coalesce(ev.d, od.d, sp.d) as day, coalesce(visits,0) visits, coalesce(paid_visits,0) paid_visits, coalesce(starts,0) starts,
  coalesce(submits,0) submits, coalesce(checkouts,0) checkouts, coalesce(purchases,0) purchases, coalesce(paid_purchases,0) paid_purchases,
  coalesce(revenue_usd,0) revenue_usd, round(coalesce(data_usd,0)::numeric, 2) data_usd
from ev full join od on od.d = ev.d full join sp on sp.d = coalesce(ev.d, od.d)
order by 1 desc;
revoke all on peer_scan_daily_v from anon, authenticated;

insert into peer_scan_niches(key, label, description, seed_client_id) values
 ('ai-automation', 'AI, automation and LinkedIn growth for agency and service founders', 'Creators who post about AI, automation, outbound, content systems and growing an agency or service business.', 'ivan'),
 ('dtc-ecommerce', 'DTC ecommerce growth', 'Founders, operators and marketers posting about growing direct-to-consumer brands: paid social, retention, CRO, creative.', 'risedtc'),
 ('mobile-games-apps', 'Mobile games and apps growth', 'People posting about user acquisition, monetisation and growth for mobile games and apps.', 'arch')
on conflict (key) do nothing;
