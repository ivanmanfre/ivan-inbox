# Rich Email Editor Implementation Plan

> For agentic workers: use superpowers:executing-plans for the implementation steps.

**Goal:** Compose, preview, persist and send formatted email with a visible signature and an explicit reply target.
**Architecture:** Restricted structured documents render to safe HTML and plain text. Guarded database writes preserve draft metadata. The email dispatcher consumes only matching reviewed documents, and the existing plain email path stays available.
**Tech Stack:** React, TypeScript, Tiptap 3, Supabase/PostgreSQL, n8n/Resend.
**Spec:** docs/superpowers/specs/2026-10-26-rich-email-design.md

## Global constraints

- Preserve existing send confirmations, holds, CC, channel choices, schedule and duplicate-send checks.
- Existing sender identities provide the default signature.
- No real external send or booking as a test.
- Read the complete canonical n8n workflow protocol before workflow work.
- Bind rich content to exact source text and reject unsafe or stale content.

## Review focus

- Formatting-only edits must save even when plain text is unchanged.
- Custom link labels must keep their URL through save, preview and send.
- A new inbound must not silently change a draft's selected reply target.
- Existing signatures must not duplicate the new signature block.
- Rich content must survive both native and mirror/companion email delivery.

## Tasks

- [ ] Implement and test the restricted renderer, verified default signatures and Tiptap body editor. Model: gpt-6-sol. Owned: emailRichText.ts and RichEmailEditor component/tests/dependencies.
- [ ] Implement and test rich payload delivery in the existing email dispatcher. Model: gpt-6-sol. Owned: Send Messages workflow and rich dispatch tests. Pull and schema-check first; parent owns release.
- [ ] Wire rich composition through draft edits/autosave/approval, manual send, envelope hydration, preview and sent history. Add guarded database persistence with tests.
- [ ] Add exact Reply actions and visible reply context with latest/older distinction, target refresh and transport tests.
- [ ] Run focused tests/build, independent integration review and desktop/phone task checks. Merge, deploy, then verify the actual Daily Brief window.
