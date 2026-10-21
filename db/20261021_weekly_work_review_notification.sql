-- Only the personal weekly-review producer gets permanent per-week uniqueness.
create unique index if not exists inbox_weekly_work_review_once
on public.inbox_notifications (tenant, source, dedupe_key)
where source = 'weekly_work_review' and tenant = 'ivan' and dedupe_key is not null;
