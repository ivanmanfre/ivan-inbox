-- Rollback for db/20261106_operator_set_draft_photos.sql.
-- The inbox build that calls it must be rolled back first (or it shows a failed toast
-- on every photo change). taxonomy.photo_options keys already written stay on the rows;
-- nothing else reads them.
DROP FUNCTION IF EXISTS public.operator_set_draft_photos(text, uuid, text[]);
