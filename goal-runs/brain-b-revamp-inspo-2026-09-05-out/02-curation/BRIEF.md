# Curation brief — brain-b-revamp-inspo-2026-09-05

You curate 21st.dev references for one phone app: Ivan's inbox, a dark instrument-style workbench used ten times a day at 390 px. What exists today (look at these first, they are the AFTER of the last run): `../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/{feed,feed-grouped,ask-empty,ask-thread,turn-running,turn-error,link-preview,voice-note}.png`. Ivan's verdict on that run: "you clearly fail to perform a comprehensive design inspiration improvement". He wants a revamp that reads as new at a glance, with smooth motion, on a phone. Canon that stays: dark ground, the pistachio plate frame, lime as the single accent, no warm paper, no serif. Everything else is open.

Data: `../01-refs/references.json` (2,117 entries: user, slug, name, description, tags, queries, usage, preview_url, video_url, page_url), `../01-refs/by-surface.json` (a loose keyword classification, noisy: Button/Input/Table rank high by usage; do not trust it, use it as a starting pool only), `../01-refs/previews/<user>__<slug>.<png|webp>` (every preview).

For each of YOUR surfaces:
1. Build a candidate pool of up to 40: from by-surface.json plus your own grep over references.json by name/description/tags (think like a designer: for the feed, search notification, activity, timeline, list item, stack, inbox, card; for the thread, chat, message, bubble, ai, streaming, reasoning, markdown; etc.). Prefer usage ≥ 30 but include low-usage entries whose description is exactly on point.
2. LOOK at every candidate's preview with the Read tool (they are small). Reject anything that is a marketing block, a hero, a landing section, a dashboard table, or a desktop-only idiom. Reject visual skins that fight the canon (warm gradients, glassmorphism, neon) unless the MOVE underneath is worth porting.
3. Pick the top 5. For each write: name · author · usage · what the MOVE is (the transferable idea, one sentence: layout, motion or interaction, never the colours) · how it lands in the inbox (which element, what changes for Ivan) · risk (what could make it slop or fight the canon) · preview file path · video url.
4. Compose a contact sheet: an HTML page with the 5 picks as a grid (each: preview image scaled to 300 px wide, name/author/usage caption, the move in one line) plus, below, a second row of the 5 runners-up with captions only, rendered with Playwright (`/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs`) to `02-curation/sheet-<surface>.png` at 1400 wide.
5. Write `02-curation/<surface>.md` with the picks, the runners-up, and the pool size you looked at.
No em dashes. Do not touch `src/`. Never print or copy the API key.

## Pacing (added after three seats stalled on image-heavy turns)
Look at previews in batches of 6 per tool round at most, and after each batch append your one-line verdicts to `02-curation/notes-<surface>.md` before opening the next batch. Cap the pool at 24 per surface. Write the surface's final `.md` as soon as its picks are clear; render the contact sheet last. A seat that reads 40 images in one breath stalls and loses everything.
