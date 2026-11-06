-- Intel feed: Ivan's done-with-this-card stamp (Ivan 11-06: "i already went through these... instead of
-- showing new stuff"). For you shows only rows with ivan_seen_at null; Done and Useful set it; Seen lists them.
-- Separate from ivan_verdict so Done never trains the judge. Authenticated already has table-level update (db/240).
alter table public.intel_items add column if not exists ivan_seen_at timestamptz;
