CREATE FUNCTION public.cb52_mark_internal_draft() RETURNS trigger LANGUAGE plpgsql SET search_path TO public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(NEW.taxonomy)='object' AND NEW.taxonomy->'internal_test'='true'::jsonb
    OR coalesce(NEW.title,'') ~* '^[[:space:]]*\[new voice test\]'
    OR TG_OP='UPDATE' AND jsonb_typeof(OLD.taxonomy)='object' AND OLD.taxonomy->'internal_test'='true'::jsonb THEN
   NEW.taxonomy := (CASE WHEN jsonb_typeof(NEW.taxonomy)='object' THEN NEW.taxonomy ELSE '{}'::jsonb END) || '{"internal_test":true}'::jsonb;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cb52_mark_internal_draft() FROM PUBLIC;
CREATE TRIGGER cb52_mark_internal_draft BEFORE INSERT OR UPDATE OF title,taxonomy ON public.carousel_drafts FOR EACH ROW EXECUTE FUNCTION public.cb52_mark_internal_draft();
UPDATE carousel_drafts SET taxonomy=coalesce(taxonomy,'{}'::jsonb)||'{"internal_test":true}'::jsonb WHERE id IN ('dddd7870-e017-4b10-b511-a3d85000f6f4','e978a1bc-c9a4-4c89-9356-dda07df66436','d604afc2-2bd0-4b2b-bc19-84f660d1667a','214ec915-b07e-4231-a735-8cb2fe81d049','128d563e-e172-4be2-a46b-dbc2cab93a86');
