-- The RISE brief sender is the booking push. A successful attribution summary
-- precedes it and used to ring the phone for the same meeting a second time.
-- Keep the summary in the feed. Bare/warning headlines still report failures.
-- Prepend because the relay uses the first matching signature. Preserve all
-- other rules and source mappings, including Ivan/unattributed push mutes.
update public.integration_config
set value = jsonb_set(value::jsonb, '{__sig}',
  '[{"src":"siEM4bDSfevuVCII","re":"^📊\\s*RISE booking attribution\\s+[—-]\\s+\\d+ attributed$","family":"booking_notice","push":false,"url":"./#exp/brain-b/ops","key":"full"}]'::jsonb
  || coalesce(value::jsonb -> '__sig', '[]'::jsonb)
)::text,
updated_at = now()
where key = 'inbox_family_map'
  and not exists (
    select 1 from jsonb_array_elements(value::jsonb -> '__sig') rule
    where rule ->> 'src' = 'siEM4bDSfevuVCII'
      and rule ->> 're' = '^📊\s*RISE booking attribution\s+[—-]\s+\d+ attributed$'
      and rule ->> 'push' = 'false'
  );
