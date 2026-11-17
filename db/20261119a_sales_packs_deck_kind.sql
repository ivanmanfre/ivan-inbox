-- db/20261119a — sales_packs.kind gains 'deck'.
-- Task 8.1 (plan 2026-11-17 daily-brief-trim-and-wispr-calls). The Mac-side
-- publisher (scripts/sales-pack-publish.py) now reads the call-pack folders
-- (cloud-output/<slug>-call-pack-YYYY-MM-DD/) and publishes their
-- sales-deck.html as kind 'deck', beside sales-script.html as kind 'call_sheet'.
--
-- One change: the kind check from db/052 (line 33) keeps every value it allowed
-- and adds 'deck'. Read live before writing this (pg_get_constraintdef):
--   CHECK ((kind = ANY (ARRAY['card','call_sheet','audience_audit',
--                             'asset_ideas','prospect','extra'])))
-- No grant, policy, index or publication changes: the table stays closed to the
-- public key (anon has no grant; authenticated reads its own rows under RLS).
--
-- Apply via the Management API. Test: 20261119a_sales_packs_deck_kind.test.sql.
-- Rollback: 20261119a_sales_packs_deck_kind_rollback.sql.

begin;

alter table public.sales_packs drop constraint if exists sales_packs_kind_check;
alter table public.sales_packs add constraint sales_packs_kind_check check (kind in
  ('card','call_sheet','audience_audit','asset_ideas','prospect','extra','deck'));

commit;
