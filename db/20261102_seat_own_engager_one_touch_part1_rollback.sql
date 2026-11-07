-- Rollback for 20261102_seat_own_engager_one_touch_part1.sql
begin;
update public.outreach_seats set settings = settings - 'own_post_engager' where seat = 'risedtc';
drop function if exists public.seat_own_engager_candidates(text, timestamptz);
drop function if exists public.outreach_seat_own_engager_cfg();
commit;
