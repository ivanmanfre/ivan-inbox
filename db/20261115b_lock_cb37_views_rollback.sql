-- Rollback of 20261115b_lock_cb37_views.sql: the anon / authenticated grants back (relacl was anon=arwdDxtm,
-- authenticated=arwdDxtm on every view).
BEGIN;

GRANT ALL ON TABLE public.cb37_booking_coverage_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_booking_name_candidates_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_booking_post_links_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_brain_draft_versions_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_brain_fates_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_draft_fates_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_draft_post_links_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_engager_fit_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_engager_journey_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_post_base_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_post_engagers_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_post_results_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb37_post_snapshots_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb44_house_numbers_arch_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb44_house_numbers_ivan_v TO anon, authenticated;
GRANT ALL ON TABLE public.cb44_house_numbers_risedtc_v TO anon, authenticated;
GRANT ALL ON TABLE public.ivan_post_outcome_spine TO anon, authenticated;

COMMIT;
