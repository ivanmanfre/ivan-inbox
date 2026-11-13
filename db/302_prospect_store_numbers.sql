-- 302: store numbers we already hold for a prospect, for the DM context sheet (2026-11-13).
-- Ivan: "sometimes we over-qualify ... ideally we got the data from the beginning". The sales estimate
-- (storeleads_domains) and our own ad-tag check (rise_store_tech) were on file for prospects he still had
-- to ask "monthly sales?" and "paid or organic?". Read-only, additive. Rollback: 302_..._rollback.sql.
create or replace function public.prospect_store_numbers(p_prospect_id uuid)
returns table (
  est_sales_monthly_usd bigint,
  platform text,
  estimate_updated date,
  meta_tag boolean,
  google_ads_tag boolean,
  tags_checked_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  with p as (
    select nullif(split_part(regexp_replace(regexp_replace(lower(trim(coalesce(company_domain, ''))), '^https?://', ''), '^www\.', ''), '/', 1), '') as dom
    from outreach_prospects where id = p_prospect_id
  ),
  sl as (
    select d.est_sales_monthly_usd, d.platform, d.sl_last_updated_at
    from storeleads_domains d join p on d.domain_norm = p.dom
    order by d.fetched_at desc nulls last limit 1
  ),
  tech as (
    select t.meta, t.google_ads, t.checked_at
    from rise_store_tech t join p on t.domain = p.dom
    where t.status = 'ok'
    order by t.checked_at desc nulls last limit 1
  )
  select sl.est_sales_monthly_usd, sl.platform, sl.sl_last_updated_at, tech.meta, tech.google_ads, tech.checked_at
  from (select 1) one
  left join sl on true
  left join tech on true
  where exists (select 1 from sl) or exists (select 1 from tech);
$$;

revoke all on function public.prospect_store_numbers(uuid) from public;
grant execute on function public.prospect_store_numbers(uuid) to anon, authenticated, service_role;
