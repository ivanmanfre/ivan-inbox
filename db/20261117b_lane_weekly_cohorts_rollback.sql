-- Restores the body from 20261117_lane_adjustment_cohorts.sql (rows per
-- targeting change). Apply that file again: the function keeps its name and
-- return columns, so `create or replace` there is the whole rollback. Run with psql;
-- where psql commands are not accepted, run that file's contents directly.
\ir 20261117_lane_adjustment_cohorts.sql
