-- Rollback for db/20261119a: sales_packs.kind back to the six values of db/052.
-- The old check cannot be re-added while 'deck' rows exist, so this removes
-- them first. They are copies of files on the Mac (cloud-output/*-call-pack-*/
-- sales-deck.html); nothing is lost that the publisher cannot write again.

begin;

delete from public.sales_packs where kind = 'deck';

alter table public.sales_packs drop constraint if exists sales_packs_kind_check;
alter table public.sales_packs add constraint sales_packs_kind_check check (kind in
  ('card','call_sheet','audience_audit','asset_ideas','prospect','extra'));

commit;
