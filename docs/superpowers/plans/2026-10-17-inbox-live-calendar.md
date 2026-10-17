# Inbox live calendar Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline. Steps use checkbox syntax for tracking.

**Goal:** Check the conversation owner's live calendar, insert up to two proposed times, and create an invite only after an explicit booking action.

**Architecture:** A single owner-authenticated edge endpoint resolves tenancy from the prospect campaign and reads allowlisted provider calendars. A private booking ledger claims each prospect atomically before a provider write; ambiguous responses stay blocked. Existing message sending and Ops approval remain unchanged.

**Tech Stack:** React, TypeScript, Supabase Edge Functions/PostgreSQL, HubSpot Scheduler and Calendly availability.

**Spec:** Authorized task briefing in this session; this plan preserves the bounded requirements.

## Global Constraints
- Owner mapping comes only from explicit outreach_campaigns.client_id.
- Never book while inspecting or inserting availability; never auto-send a message or Slack.
- Protect existing bookings, including Dinos; no real attendee test bookings.
- Provider credentials remain server side. No client-supplied provider URLs.
- Show timezone explicitly; do not infer prospect timezone from country.

## Review Focus
- Concurrent booking clicks and retries must never create duplicate meetings.
- A timeout after POST must stay uncertain and block automatic retries.
- Stale availability must be checked again immediately before booking.
- Missing email, extra required questions, offline calendars and unsupported providers must preserve the owner link as fallback.
- Switching threads/timezones must not apply results from a previous conversation.

### Task 1: Provider availability and booking contract
**Files:** create `supabase/functions/inbox-calendar/calendar.ts` and `calendar.test.ts`.
**Interfaces:** ownerFor(client), availability(owner, secret, timezone, now), book(owner, secret, slot, identity, timezone), validateReceipt().
- [ ] Write provider tests covering allowlisting, exact instants, duration, offline/calendar-owner mismatch, extra required fields, stale times and uncertain receipts; run RED.
- [ ] Implement minimal HubSpot and Calendly adapters. Calendly booking uses owner link.
- [ ] Run provider tests GREEN.

### Task 2: Authenticated endpoint and durable booking guard
**Files:** create `supabase/functions/inbox-calendar/index.ts`, handler tests, `db/245_inbox_calendar.sql`; modify `supabase/config.toml`.
**Interfaces:** POST {prospect_id, action:'availability'|'book', timezone, start?, email?, request_id?, confirmed?}; response calendar with slots and booking receipt.
- [ ] Write RED tests for auth/tenancy, existing-booked refusal, claim collision, recheck before POST, uncertain POST and receipt recovery.
- [ ] Add service-only ledger/atomic claim and completion RPC; stamp call_booked_at only using verified HubSpot hs_createdate; queue unapproved Ops booking with real meeting ID.
- [ ] Implement endpoint using provider contract; uncertain claims never POST again.
- [ ] Run handler and SQL tests GREEN.

### Task 3: Conversation calendar panel
**Files:** create `src/lib/inboxCalendar.ts`, `src/d/dms/Calendar.tsx`, tests and `calendar.css`; modify `src/d/dms/Thread.tsx`.
**Interfaces:** compact expandable Calendar beside composer; onInsert(text) appends to current draft or reply; refresh and timezone input; explicit email/agreement checkbox and Book selected time action.
- [ ] Write RED tests for live load, timezone labels, one/two insertion, stale thread results, errors, existing booking and deliberate booking action.
- [ ] Implement panel following current inbox buttons/type/colors and both thread layouts.
- [ ] Run targeted tests, build and changed-file lint; run full suite once and report baseline failures.
- [ ] Independent review; fix material findings; open/register/merge PR with exact-head guard; deploy SQL/function and verify read-only live calls and published UI.
