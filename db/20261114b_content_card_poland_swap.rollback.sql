-- Rollback of 20261114b_content_card_poland_swap.sql: removes the six new functions. No existing object was changed,
-- so the card's Post goes back to the next free slot. Run this BEFORE the owner-keep rollback (these read its objects).
BEGIN;
DROP FUNCTION IF EXISTS public.content_card_post_swap(date, uuid, text, uuid, timestamptz, timestamptz, integer);
DROP FUNCTION IF EXISTS public.content_card_post_swap_at(timestamptz, date, uuid, text, uuid, timestamptz, timestamptz, integer);
DROP FUNCTION IF EXISTS public.content_card_swap_plan();
DROP FUNCTION IF EXISTS public.content_card_swap_plan_at(timestamptz);
DROP FUNCTION IF EXISTS public.content_card_swap_incumbents(timestamptz);
DROP FUNCTION IF EXISTS public.content_card_poland_lane(uuid);
COMMIT;
