DROP TRIGGER cb52_mark_internal_draft ON public.carousel_drafts;
DROP FUNCTION public.cb52_mark_internal_draft();
UPDATE carousel_drafts SET taxonomy=taxonomy-'internal_test' WHERE id='128d563e-e172-4be2-a46b-dbc2cab93a86';
UPDATE carousel_drafts SET taxonomy=taxonomy-'internal_test' WHERE id='214ec915-b07e-4231-a735-8cb2fe81d049';
UPDATE carousel_drafts SET taxonomy=taxonomy-'internal_test' WHERE id='d604afc2-2bd0-4b2b-bc19-84f660d1667a';
UPDATE carousel_drafts SET taxonomy=taxonomy-'internal_test' WHERE id='dddd7870-e017-4b10-b511-a3d85000f6f4';
UPDATE carousel_drafts SET taxonomy=taxonomy-'internal_test' WHERE id='e978a1bc-c9a4-4c89-9356-dda07df66436';
