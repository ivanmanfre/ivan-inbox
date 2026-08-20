-- 031_scan_audit_v3.sql — RISE audit v3 (goal-run rise-audit-v3-2026-08-07)
-- APPLIED 2026-08-07 via mgmt API (POST /v1/projects/bjbvqvzbzczjbatgmccb/database/query).
-- Two operations, both additive/reversible:

-- 1. PDP screenshot column (homepage_screenshot_url already exists; this is its sibling).
ALTER TABLE scans ADD COLUMN IF NOT EXISTS pdp_screenshot_url text;

-- 2. Kill the fabricated growth score on ALL historical dtc_growth rows.
--    The score was a 2-state constant (8 if gap else 16 per lever): 47 of 53 rows scored
--    exactly 40, five 80, one 60 — a default dressed as a measurement. The page renderer
--    never displayed it, but the pre-call brief's scoreReal gate would print a mixed-
--    breakdown row's score as real. Nulling makes that gate permanently false.
--    Pre-change snapshot of every row's {id, slug, growth_score, score_breakdown}:
--    memory/goal-runs/rise-audit-v3-2026-08-07/phase2-score-backfill-snapshot.json
--    Restore: for each snapshot row, jsonb_set report_json back to the saved values.
UPDATE scans
SET report_json = jsonb_set(jsonb_set(report_json,
      '{dtc,growth_score}', 'null'::jsonb),
      '{dtc,score_breakdown}', '{}'::jsonb)
WHERE matched_offer = 'dtc_growth' AND report_json->'dtc' IS NOT NULL;
-- Applied result: 53 rows updated; read-back over full population: all None/{}.
