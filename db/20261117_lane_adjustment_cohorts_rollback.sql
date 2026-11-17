-- Removes only what 20261117_lane_adjustment_cohorts.sql added. The settings
-- value 'lane_adjustments' is operator data and is left in place.
drop function if exists public.inbox_lane_adjustment_cohorts();
