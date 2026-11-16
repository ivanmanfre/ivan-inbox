-- Test for 20261116f. Run AFTER the migration. Rolled back. Each client's context builds in under 7.5 s and has the
-- top-level keys the writer requires.
begin;
do $t$ declare c text; r jsonb; t timestamptz; ms numeric; out text := '';
begin
  foreach c in array array['ivan','risedtc','arch'] loop
    t := clock_timestamp(); r := public.audn_writer_context(c); ms := round(extract(epoch from clock_timestamp()-t)*1000);
    if ms > 7500 then raise exception 'FAIL % took % ms', c, ms; end if;
    if r->>'client_id' is distinct from c or r->'brief' is null or jsonb_typeof(r->'own_posts') is distinct from 'array'
       or r->'measurement' is null or r->'buyer_fit' is null or jsonb_typeof(r->'previous_decisions_and_results') is distinct from 'array' then
      raise exception 'FAIL % shape', c;
    end if;
    out := out || c || '=' || ms || 'ms ';
  end loop;
  raise notice 'ok %', out;
end $t$;
rollback;
