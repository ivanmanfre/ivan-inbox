-- Rollback for db/230_operator_set_draft_media.sql.
--
-- Drops the one function 230 created. Nothing else was created or altered, so
-- nothing else is restored. Rows it already wrote stay as written (a picture
-- is a picture); taxonomy.no_photo stamps stay too, which is what keeps a
-- removal from being re-selfied.
--
-- Roll the app back FIRST (the Picture row calls this function), then run this.

DROP FUNCTION IF EXISTS public.operator_set_draft_media(text, uuid, text);
