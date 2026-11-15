-- 20261115u_shared_page_edits_functions: step 1 of 2 for shared_page_edits (step 2 = 20261115v, the lock).
-- Additive: nothing that works today changes. It adds the two functions the client review pages on
-- inboundonsteroids.com will call in place of reading and writing the table with the public (anon) key.
--
-- Why: shared_page_edits has three open anon policies (read every row, add any row, change any row). Anyone holding
-- the public key can list every page slug and body and overwrite any page. The two pages that use it
-- (shared/rise-personal-posts-0807.html, shared/proswppp-plan-37386b43/) each only ever touch their own slug.
--
-- How a page is identified: by its slug, a constant in the page script, the same string as its link. There is no
-- other token today, and one written into the same static page would protect nothing more than the link does. So the
-- functions are scoped to one slug per call and refuse any slug that is not registered in shared_page_edit_pages:
--   shared_page_edits_load(slug)             the saved items of that one page (no rows for an unknown slug)
--   shared_page_edits_save(slug, key, body)  add or replace one item of that one page (refused for an unknown slug)
-- What the public key loses once 20261115v is applied: listing slugs, reading or writing a page whose link it does not
-- know, creating new slugs, and unbounded writes (200 items a page, 200 characters a key, 20,000 a body).
-- A save now stamps updated_at (the table upsert left it at the first save).
-- A new shared page that needs saved edits: insert its slug into shared_page_edit_pages (service key or SQL).
-- Rollback: 20261115u_shared_page_edits_functions_rollback.sql (only after the pages are back on the table and
-- 20261115v is rolled back).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.shared_page_edit_pages (
  page_slug  text PRIMARY KEY CHECK (length(page_slug) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_page_edit_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shared_page_edit_pages FROM PUBLIC, anon, authenticated;

INSERT INTO public.shared_page_edit_pages (page_slug)
VALUES ('rise-personal-posts-0807'), ('proswppp-plan-37386b43');

CREATE FUNCTION public.shared_page_edits_load(p_slug text)
RETURNS TABLE (item_key text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT e.item_key, e.body
  FROM public.shared_page_edits e
  WHERE e.page_slug = p_slug
    AND EXISTS (SELECT 1 FROM public.shared_page_edit_pages p WHERE p.page_slug = p_slug);
$fn$;

CREATE FUNCTION public.shared_page_edits_save(p_slug text, p_item_key text, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- The row lock makes saves to one page take turns, so two saves at once cannot both pass the item cap below.
  PERFORM 1 FROM public.shared_page_edit_pages p WHERE p.page_slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown page' USING ERRCODE = '42501';
  END IF;
  IF p_item_key IS NULL OR length(p_item_key) NOT BETWEEN 1 AND 200 OR p_body IS NULL OR length(p_body) > 20000 THEN
    RAISE EXCEPTION 'item key or body missing or too long' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_page_edits e WHERE e.page_slug = p_slug AND e.item_key = p_item_key)
     AND (SELECT count(*) FROM public.shared_page_edits e WHERE e.page_slug = p_slug) >= 200 THEN
    RAISE EXCEPTION 'too many items on this page' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shared_page_edits AS e (page_slug, item_key, body, updated_at)
  VALUES (p_slug, p_item_key, p_body, now())
  ON CONFLICT (page_slug, item_key) DO UPDATE SET body = EXCLUDED.body, updated_at = now();
END
$fn$;

-- Public on purpose: the pages call these with the public key. Nobody else needs them.
REVOKE ALL ON FUNCTION public.shared_page_edits_load(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.shared_page_edits_save(text, text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_page_edits_load(text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.shared_page_edits_save(text, text, text) TO anon, service_role;

COMMIT;
