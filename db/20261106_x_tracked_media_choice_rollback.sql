-- Rollback for 20261106_x_tracked_media_choice.sql. Drafts keep whatever media
-- they hold; only the switch goes away (the inbox hides it when the RPC fails).
DROP FUNCTION IF EXISTS public.operator_set_draft_media_choice(text, uuid, text);
