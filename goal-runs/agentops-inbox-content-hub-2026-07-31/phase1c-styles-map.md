# Phase 1c — Styles system + Lead Magnet resources map

Repo: `/Users/ivanmanfredi/Desktop/personal-site` (read-only audit; no DB access — supabase-ivan MCP unauthenticated in this session, so all "row counts" below are grounded in code/comments only, never a live query).

## 0. Orientation — there are THREE overlapping "style" catalogs in this codebase

1. **`content_prompts` rows, `slug LIKE 'style-%'`** — carousel *layout* prompt pages (the actual Claude system prompt per layout). Read live by `StylesLive.tsx` (mounted) and `useStylePrompts.ts` (used only by the orphaned `StyleGalleryPanel.tsx`).
2. **`content_archetypes` table** — `kind='post_structure'` (7 rows) ∪ `kind='carousel_style'` (15 rows = the 9 carousel layouts + 6 single-image intents, same slugs). Feeds n8n's "Rotation Constraints" router AND the orphaned Style Gallery panel. No seed/migration file in repo — row contents are DB-only (`hooks/useContentArchetypes.ts:1-19` docstring is the only place the counts are recorded in code).
3. **`carousel_styles` table** — visual *identity kits* (palette/fonts/accent CSS), NOT layout archetypes. Open-ended/growing set (user can add new kits from reference images). Read by `useCarouselStyles.ts`.

**None of these is fixed at "8 carousel + 6 post image."** See §1.

## 1. Canonical style inventory — what the code actually shows

### Carousel layout archetypes
- **Live surface (`StylesLive.tsx`, mounted in `DemoShell.tsx:79`, file:line `components/dashboard-v2/sections/StylesLive.tsx:87-92`)**: queries `content_prompts` where `slug LIKE 'style-%' AND is_active=true`, no hardcoded count — whatever is active in the table renders. **The count is intentionally NOT fixed in code** (comment at `StylesLive.tsx:9-19`: "Round-3 verdict root-cause: 'styles don't update' … reads the canonical registry LIVE instead of a hardcoded catalogue").
- **Stale docstring** (`hooks/useContentPrompts.ts:6-8`, last touched 2026-07-02): "66 rows as of 2026-06-04 … 11 carousel layouts / 6 single-image styles." This is a comment, not enforced anywhere — could be stale.
- **Last hardcoded roster** — `components/dashboard/StyleGalleryPanel.tsx:66-90` (component is **orphaned**, see §1a below), 9 carousel layouts, each with a `content_prompts` promptSlug:
  1. Comic Explainer — `style-comic-explainer`
  2. Founder Process — `style-founder-process`
  3. Case Study — `style-case-study`
  4. Framework Walkthrough — `style-framework-walkthrough`
  5. Data-Driven — `style-data-driven`
  6. Before-After — `style-before-after`
  7. Myth-Busting — `style-myth-busting`
  8. Step-by-Step — `style-step-by-step`
  9. Educational Breakdown — `style-educational-breakdown`
  (`StyleGalleryPanel.tsx:67-79` header comment: "sourced from the ClickUp Asset Styles list 901325469493 — 15 styles," split 9 carousel + 6 single-image.)

### Post (single-image) styles
- Same file, `StyleGalleryPanel.tsx:84-89` — 6 single-image intents, **no dedicated prompt page** (blended into the main `post-generation` prompt, per comment `StyleGalleryPanel.tsx:81-83`):
  1. Framework Diagram
  2. Stat Card
  3. Concept Visual
  4. Lifestyle Photo
  5. Before/After
  6. Quote Card
- These are picked per-post via `carousel_drafts.taxonomy.image_style` (confirmed by `hooks/useStyleUsage.ts:6-9`: "how many published posts used each `taxonomy.image_style`").

**Verdict on "8 + 6":** code shows **9 carousel + 6 single-image = 15** as the last hardcoded/known roster (matches a ClickUp source list of 15), and a separate stale comment claims 11 carousel + 6 single-image live in `content_prompts` as of 2026-06-04. Neither is 8. The live surface (`StylesLive.tsx`) deliberately doesn't assert a count — whatever's `is_active` in `content_prompts` today is truth, and that number could only be confirmed with DB access (not available this session).

### 1a. `StyleGalleryPanel.tsx` is orphaned — not routed
Grep for its only two references confirms it's imported nowhere except itself and a comment in `ScheduledPostEditor.tsx:17` ("matches StyleGalleryPanel" re: upload size limit). `DemoShell.tsx` (the live dashboard-v2 shell) imports `StylesLive`, not `StyleGalleryPanel` (`DemoShell.tsx:9,79`). So the 9+6 static catalogue, the `carousel_styles` visual-kit gallery, and the LM-formats reference grid it also renders are **dead code paths today** — not reachable from the live dashboard.

### Text-post styles (bonus, no image)
`StyleGalleryPanel.tsx:109-129` — 6 hook patterns + 5 pillars, also static/orphaned.

## 2. Best available REAL preview per style

- **Carousel layouts**: `StylesLive.tsx` shows NO image preview at all — just slug/title/blurb/updated_at text rows (`StylesLive.tsx:183-224`). It deliberately dropped visuals when it dropped the hardcoded catalogue.
- **Best real preview source = `carousel_drafts`**: `status='published'` rows carry `image_urls` (referenced generically via `useContentLibrary.ts:72` `imageUrls` field) and `taxonomy.pillar` / presumably `taxonomy.image_style`/`.carousel_style` (not directly confirmed by file read — inferred from `useStyleUsage.ts` reading `taxonomy` + `image_urls` off the same table). `StylesLive.tsx`'s own pillar-taxonomy panel (`:114-145`) already queries `carousel_drafts` for `taxonomy, updated_at` on `status='published', updated_at > now()-30d` — the identical query shape, adding `slug`/`image_style` + `image_urls` to the select, would recover a real thumbnail per active style.
- **Orphaned `useStyleUsage.ts:16-24`** already does almost exactly this for single-image styles: `carousel_drafts` where `type='single_image', status='published'`, selecting `taxonomy, image_urls, created_at`, aggregated per `image_style` via `aggregateImageStyleUsage()` (`lib/styleUsage.ts`, not read in depth but is the existing "real preview" aggregator) — this is the best-available mechanism for a REAL rendered preview per single-image style; it's wired to the dead `StyleGalleryPanel`, not to `StylesLive`.
- **Carousel visual identity KITS** (`carousel_styles` table): each row carries `exemplar_urls text[]` (`useCarouselStyles.ts:8,21,34`) — reference images uploaded when the kit was created. That's the closest thing to an intentional "preview" asset per kit, distinct from a rendered post.
- Image hosting/thumbnailing mechanism used everywhere for previews: `driveThumbUrl()` (`lib/driveThumb.ts:9-14`) converts a `drive.google.com/file/d/<ID>/...` URL into `drive.google.com/thumbnail?id=<ID>&sz=w<size>` — implies carousel/LM cover assets are (at least sometimes) hosted on Google Drive, not Supabase storage. `versionedAssetUrl()` (`driveThumb.ts:21-25`) appends `?v=<updated_at>` as a cache-buster for stable-path re-renders (used for LM covers specifically).

## 3. Lead magnets — data model

- **Table**: `lm_drafts_v2` (confirmed columns via `hooks/useLeadMagnets.ts:98-100`: `id, topic, format, status, client_id, post_body, resource_html, resource_url, email_copy, cover_url, covers, video_url, og_url, slug, spec, qa, updated_at, agent_log, topic_strength, notes, source, description`).
- **Statuses** (`useLeadMagnets.ts:44-58`): canonical pipeline = `idea → generating → generating_assets → review → approved → scheduled → published`, plus `disqualified`/`error`. Legacy/alias values (`draft, ready, complete, pending, lm_review, generating_content`) folded via `LM_STATUS_ALIASES` at read time — the DB may still contain the old raw values.
- **Scoping (Ivan vs. client)**: column `client_id` (`lm_drafts_v2.client_id` → `LeadMagnetDraft.clientId`). **NULL = Ivan's own LM. Non-null = a client-board LM.**
  - `LeadMagnetStudioPanel.tsx:78-80`: `const drafts = rawDrafts.filter((d) => !d.clientId)` — explicit comment: "Client-owned LMs (client_id set) never belong on Ivan's approve queue — client boards own their own build/approve path."
  - `LmWorkSurface.tsx:75` (approve queue) and `:87-90` (`clientReviewCount`, muted-count-only, never actionable) apply the same `!d.clientId` filter.
  - **On these two surfaces the client-LM leak the memory ledger flags ("Studio leaks client LMs," `working-surface-07-18`) is NOT present in the current code** — both explicitly exclude `client_id`-set rows from the actionable queue. I did not find the leak site in the files I was scoped to read; it may live in a different surface (e.g. a table/search view, or the leak predates this filter). Flagging as UNKNOWN — did not locate the leak in `LeadMagnetStudioPanel.tsx`, `LeadMagnetEditor.tsx`, or `LmWorkSurface.tsx`.
- **Idea stage**: curator-scored candidates live in a separate table (`lm_idea_candidates`, referenced via `useLeadMagnetIdeas` / `decideIdea` / `LmIdeasPanel`, not opened in this pass) and are projected onto the board as synthetic `status='idea'` rows with an `ideaCandidateId` (`useLeadMagnets.ts` type at `:36-39`; wiring in `LeadMagnetStudioPanel.tsx:81-85,150-157`). Approving one calls `decideIdea(id,'approve')`, which presumably promotes it into a real `lm_drafts_v2` row (not verified — `ideaProjection.ts` not opened).
- **Live LM page URL**: `resource_url` column, surfaced as `draft.resourceUrl`. **No URL-construction code found in the front-end** — grepped the whole repo for `resources.ivanmanfredi.com` and found it only in unrelated internal-doc links (`CallScript.tsx`, `SalesScriptViewer.tsx`) and `lib/assessmentEmbed.ts:2` (`RESOURCES_BASE = 'https://resources.ivanmanfredi.com'`, used for the AI-readiness assessment embed, a different tool from LM pages). **The LM resource URL is written directly into `lm_drafts_v2.resource_url` by the n8n `lm-gen-v2` webhook pipeline (outside this repo) — the personal-site frontend only reads and displays it, never builds it.** Marking the exact path pattern (e.g. `resources.ivanmanfredi.com/<slug>/`) as UNKNOWN from this repo; would need the n8n workflow or a live example.
- **Editing the live page**: an "Edit resource" flow (`LeadMagnetStudioPanel.tsx:99-118`, `LeadMagnetEditor.tsx:86-105`) calls edge function `lm-edit-token-reveal` to get a one-time token, then opens `${resourceUrl}?edit=<token>` (or `&edit=` if the URL already has a query string) in a new tab — inline-edit mode lives on the hosted page itself, not in this dashboard.
- **How an LM attaches to a style / stands alone**: an LM is its own content shape (`format` ∈ the 10 canonical `FORMATS`: Checklist, Calculator, Interactive Assessment, Guide, AI Kit, N8N Workflow, Stack Picker, Annotated Architecture, Live AI Walkthrough, Skill Pack — `LeadMagnetStudioPanel.tsx:25-28`, mirrored in `LmWorkSurface.tsx:41-44` and as a richer catalogue with blurbs in orphaned `StyleGalleryPanel.tsx:132-143`). It does **not** carry a carousel/single-image style — it stands alone with its own `cover_url`/`covers[]` (Gemini-generated cover image, regenerable via `regenLMCover`/`lm-regen-cover-v2` webhook) and its own promo LinkedIn post (`post_body`) + email follow-up (`email_copy`) + two DM templates (`spec.dm_template_a/b`). Confirmed no `image_style`/`carousel_style` field on `lm_drafts_v2`'s selected columns.
- **Non-LM pollution**: `lm_drafts_v2` also holds non-lead-magnet rows (newsletter signups, `/start` funnel forms, a deprecated "Template" format) — filtered out everywhere via the `FORMATS_SET`/`isLmFormat()` allow-list (`LeadMagnetStudioPanel.tsx:21-29`, `LmWorkSurface.tsx:39-46`), shown only behind a "+N misclassified" toggle in the classic Studio panel.
- **hypertarget demo rows**: `useLeadMagnets.ts:101-102` explicitly excludes `source='hypertarget_demo'` rows ("traceability rows, not Ivan's ideas") from the whole hook's result set — a second, table-wide (not just Ivan-vs-client) filter.

## 4. Exhaustive list of tables / storage buckets / RPCs / edge functions / webhooks touched by the files read

**Supabase tables**
- `content_prompts` (style-% rows; also full prompt library incl. non-style prompts)
- `carousel_drafts` (published posts/carousels; `taxonomy`, `image_urls`, `status`, `type`, `updated_at`)
- `content_archetypes` (`post_structure` / `carousel_style` rows — canonical content-shape catalog, feeds n8n Rotation Constraints)
- `carousel_styles` (visual identity kits: `id, name, slug, kit_css, authoring_notes, exemplar_urls, status, is_default, created_at`)
- `lm_drafts_v2` (the lead-magnet table itself)
- `lm_idea_candidates` (referenced, not opened — curator LM ideas)
- `scheduled_posts` (LM promo post queue; `clickup_task_id, scheduled_at, posted_at, status`)

**Storage buckets** (seen repo-wide, not all LM/style-specific)
- `post-stills` — style reference-image uploads (`StyleGalleryPanel.tsx:512,517`, path prefix `style-refs/…`) and manual post-image uploads (`ScheduledPostEditor.tsx:45,47`, `lib/studioActions.ts:236`)
- `client-photos`, `recordings`, `originals` — unrelated to styles/LMs, seen in the same repo-wide grep, noted for completeness/exhaustiveness only

**RPCs**
- `operator_set_lm_active_cover` (`lib/studioActions.ts:523-524`, gated by `p_gate: OPERATOR_GATE = 'clientops'` — a string param, not a Postgres role/auth check as far as this file shows)

**Edge functions** (`supabase.functions.invoke(...)` / direct `fetch` to `.../functions/v1/...`)
- `lm-edit-token-reveal` — mints the one-time inline-edit token for the live LM page
- `lm-schedule` — `https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/lm-schedule` (does the `scheduled_posts` write with service role because `scheduled_posts` is anon-SELECT-only per RLS; also flips the draft status)

**n8n webhooks** (`lib/studioActions.ts`)
- `lm-gen-v2` (`https://n8n.ivanmanfredi.com/webhook/lm-gen-v2`) — used for all three LM generation phases: `phase:'content'` (generateLMContent), `phase:'assets'` (buildLMAssets), `phase:'repost'` (repostLeadMagnet, with a `secret`)
- `lm-regen-cover-v2` (`https://n8n.ivanmanfredi.com/webhook/lm-regen-cover-v2`) — cover-only regen, Gemini-based per `LeadMagnetEditor.tsx:252` tooltip
- `carousel-style-create` (`https://n8n.ivanmanfredi.com/webhook/carousel-style-create`, `StyleGalleryPanel.tsx:34-37`) — orphaned-surface-only: creates a new `carousel_styles` kit from uploaded reference images (Gemini-vision brief → Claude re-themes CSS)

## 5. Auth / keys used

- All front-end Supabase reads/writes go through the shared client in `lib/supabase.ts:3-6`: `VITE_SUPABASE_URL` (default `https://bjbvqvzbzczjbatgmccb.supabase.co`) + `VITE_SUPABASE_ANON_KEY` — a single anon-key client for every hook/component touched (`StylesLive`, `useLeadMagnets`, `useCarouselStyles`, `useContentArchetypes`, `useStylePrompts`, `useStyleUsage`).
- RLS is explicitly noted OFF for `carousel_styles` (`useCarouselStyles.ts:5`, "RLS is OFF on the table so anon reads work") and implicitly open for `content_prompts`/`carousel_drafts` (both read directly with the anon client, no error-handling special-cased for RLS beyond generic "no access" messaging in `StylesLive.tsx:176-179,237-240`).
- `scheduled_posts` is anon-SELECT-only (comment, `studioActions.ts:384-387`) — writes are proxied through the `lm-schedule` edge function running with the service role.
- Operator-gated actions (cover pin) pass a hardcoded string gate `'clientops'` (`studioActions.ts:513`) as an RPC parameter — this is an application-level gate string, not a Supabase auth/session check, as far as the read files show.
- Webhooks (`lm-gen-v2`, `lm-regen-cover-v2`, `carousel-style-create`) are called with no visible bearer token from the front end except `repostLeadMagnet`'s inline `secret: LM_REPOST_SECRET` (default fallback `'pn-1ee9c4f2a7'`, overridable via `VITE_LM_REPOST_SECRET`) — the other two calls appear to rely on the webhook URL itself being the "secret."

## UNKNOWNS (and where I looked)

1. **Exact live count/roster of `content_prompts` `style-%` rows today** — `StylesLive.tsx` queries live and renders whatever's there; I have no DB access this session (supabase-ivan MCP unauthenticated) to enumerate the actual rows. Looked at: `StylesLive.tsx`, `useStylePrompts.ts`, `useContentPrompts.ts` docstring (stale, dated 2026-06-04, says 11+6), `StyleGalleryPanel.tsx` hardcoded roster (says 9+6, last touched 07-14, itself orphaned). No migration/seed file enumerates these rows.
2. **Exact live rows in `content_archetypes`** (7 `post_structure` + 15 `carousel_style`) — only the docstring in `hooks/useContentArchetypes.ts:1-19` states counts; no seed/migration SQL found (`grep` across `supabase/migrations/*.sql` for `content_archetypes` found only an RLS-wave migration, no INSERT/seed).
3. **`lm-gen-v2` / `lm-regen-cover-v2` internals** (n8n side) — where `resource_url` is actually assembled into a `resources.ivanmanfredi.com/<slug>` path, and where cover/resource assets are physically stored (Drive vs. Supabase storage vs. some other CDN) — outside this repo, not read.
4. **Whether the "Studio leaks client LMs" hazard still applies anywhere** — the three surfaces read here (`LeadMagnetStudioPanel.tsx`, `LeadMagnetEditor.tsx`, `LmWorkSurface.tsx`) all correctly filter `!clientId` on the approve/board queues. Did not find the leak site; it may be in a table/search/export view not in this task's read list, or may already be fixed and the memory note stale.
5. **`lib/styleUsage.ts` (`aggregateImageStyleUsage`) internals** — referenced but not opened; would confirm exactly which `taxonomy` fields it keys on and confirm the "real preview per style" mechanism precisely.
6. **`lib/ideaProjection.ts` / `decideIdea()` internals** — not opened; would confirm exactly how an approved `lm_idea_candidates` row becomes a real `lm_drafts_v2` row.
7. **`lib/assessmentEmbed.ts` full contents** — only grepped for the `RESOURCES_BASE` constant; did not confirm whether this is a wholly separate tool from LM resource pages or shares infrastructure.

## Exhaustive list (tables / buckets / RPCs / edge functions / webhooks)

- Tables: `content_prompts`, `carousel_drafts`, `content_archetypes`, `carousel_styles`, `lm_drafts_v2`, `lm_idea_candidates`, `scheduled_posts`
- Storage buckets: `post-stills`, `client-photos`, `recordings`, `originals`
- RPCs: `operator_set_lm_active_cover`
- Edge functions: `lm-edit-token-reveal`, `lm-schedule`
- n8n webhooks: `lm-gen-v2` (phases: content / assets / repost), `lm-regen-cover-v2`, `carousel-style-create`
