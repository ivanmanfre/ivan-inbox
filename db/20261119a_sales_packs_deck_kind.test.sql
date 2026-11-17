-- Test for 20261119a. Run AFTER the migration, as postgres. Everything is rolled back.
--  T1 kind 'deck' inserts (the new value)
--  T2 every value the check allowed before still inserts (card, call_sheet, audience_audit, asset_ideas, prospect, extra)
--  T3 kind 'banana' is refused by sales_packs_kind_check
--  T4 the table is still closed to the public key (no anon grant) and RLS is on
-- Fixture slugs are 't-20261119a-*' and never outlive the transaction.

begin;

do $t$
declare k text; refused boolean := false; cname text;
begin
  insert into public.sales_packs (user_id, prospect_slug, kind, title, body, mime)
  values (gen_random_uuid(), 't-20261119a-pack', 'deck', 'Deck', '<p>deck</p>', 'text/html');
  raise notice 'T1 ok';

  foreach k in array array['card','call_sheet','audience_audit','asset_ideas','prospect','extra'] loop
    insert into public.sales_packs (user_id, prospect_slug, kind, title, body, mime)
    values (gen_random_uuid(), 't-20261119a-pack', k, k, 'x', 'text/html');
  end loop;
  raise notice 'T2 ok';

  begin
    insert into public.sales_packs (user_id, prospect_slug, kind, title, body, mime)
    values (gen_random_uuid(), 't-20261119a-pack', 'banana', 'Banana', 'x', 'text/html');
  exception when check_violation then
    get stacked diagnostics cname = constraint_name;
    refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: kind banana was accepted'; end if;
  if cname is distinct from 'sales_packs_kind_check' then raise exception 'T3 FAIL: refused by % instead of sales_packs_kind_check', cname; end if;
  raise notice 'T3 ok';

  if has_table_privilege('anon', 'public.sales_packs', 'select') then raise exception 'T4 FAIL: anon can select'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sales_packs'::regclass) then raise exception 'T4 FAIL: RLS is off'; end if;
  raise notice 'T4 ok';
end $t$;

select 'all ok' as result;

rollback;
