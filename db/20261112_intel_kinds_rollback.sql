-- Undo db/20261112_intel_kinds.sql. Refuses while any source or card of a new kind exists: dropping the column
-- would leave those cards showing as videos. Delete or re-kind those rows first.
begin;
set local lock_timeout = '3s';
-- Lock first: a writer could otherwise commit a new-kind row between the check below and the column drop.
lock table public.intel_sources, public.intel_items in access exclusive mode;

do $$
begin
  if exists (select 1 from public.intel_sources where kind not in ('youtube', 'podcast')) then
    raise exception 'intel_sources holds rows of a new kind; rollback refused';
  end if;
  if exists (select 1 from public.intel_items where kind not in ('youtube', 'podcast')) then
    raise exception 'intel_items holds rows of a new kind; rollback refused';
  end if;
end $$;

alter table public.intel_items drop column meta;
alter table public.intel_items drop constraint intel_items_kind_check;
alter table public.intel_items drop column kind;

alter table public.intel_sources drop constraint intel_sources_kind_check;
alter table public.intel_sources add constraint intel_sources_kind_check
  check (kind in ('youtube', 'podcast'));

commit;
