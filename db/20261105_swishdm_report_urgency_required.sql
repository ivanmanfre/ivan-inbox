-- Applied after the form (resources-hosting b8a86e6, page.mjs?v=2) went live with the urgency question.
alter table public.swishdm_lm_requests add constraint swishdm_lm_requests_report_urgency_required
  check (lead_magnet <> 'ai-search-report' or urgency is not null);
